import type { ChatMessage, ContentBlock, ModelInfo } from "./types";

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** `toolResult` payloads vary; try the common shapes. */
function extractResultText(block: Record<string, unknown>): string {
	const { content, text, output, result } = block;
	if (typeof text === "string") return text;
	if (typeof output === "string") return output;
	if (typeof result === "string") return result;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") {
					return String((part as Record<string, unknown>).text);
				}
				return typeof part === "string" ? part : "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return safeJson(block);
}

/** pi stores `timestamp` in ms; tolerate seconds and ISO strings from other sources. */
function parseTimestamp(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
	if (typeof value === "string") { const parsed = Date.parse(value); return Number.isNaN(parsed) ? undefined : parsed; }
	return undefined;
}

/** Map a pi message `content` (string or content-block array) to render blocks. */
export function parseBlocks(content: unknown): ContentBlock[] {
	if (typeof content === "string") return content ? [{ kind: "text", text: content }] : [];
	if (!Array.isArray(content)) return [];

	const blocks: ContentBlock[] = [];
	for (const raw of content) {
		if (!raw || typeof raw !== "object") continue;
		const block = raw as Record<string, unknown>;
		const type = String(block.type ?? "");

		if (type === "text") {
			if (typeof block.reasoning_content === "string" && block.reasoning_content) blocks.push({ kind: "thinking", text: block.reasoning_content });
			const text = String(block.text ?? "");
			if (text) blocks.push({ kind: "text", text });
		} else if (type === "image" && typeof block.data === "string" && typeof block.mimeType === "string" && /^image\/(png|jpeg|webp|gif)$/.test(block.mimeType)) {
			blocks.push({ kind: "image", data: block.data, mimeType: block.mimeType });
		} else if (type === "thinking" || type === "reasoning" || type === "reasoning_content") {
			const text = String(block.thinking ?? block.reasoning_content ?? block.text ?? "");
			if (text) blocks.push({ kind: "thinking", text });
		} else if (type === "toolCall" || type === "tool_call" || type === "toolcall") {
			const args = block.arguments ?? block.input ?? block.args;
			blocks.push({
				kind: "tool",
				id: String(block.id ?? block.toolCallId ?? ""),
				name: String(block.name ?? block.toolName ?? "tool"),
				argsText: args === undefined ? "" : safeJson(args),
				done: true,
			});
		} else if (type === "toolResult" || type === "tool_result") {
			blocks.push({
				kind: "toolResult",
				id: typeof block.toolCallId === "string" ? block.toolCallId : typeof block.id === "string" ? block.id : undefined,
				name: String(block.name ?? block.toolName ?? "result"),
				text: extractResultText(block),
				isError: Boolean(block.isError),
				diff: typeof (block.details as Record<string, unknown> | undefined)?.diff === "string" ? String((block.details as Record<string, unknown>).diff) : undefined,
			});
		}
	}
	return blocks;
}

/** Some compatible providers place reasoning beside content rather than in it. */
export function parseMessageBlocks(message: Record<string, unknown>): ContentBlock[] {
	const blocks = parseBlocks(message.content);
	const reasoning = message.reasoning_content;
	return typeof reasoning === "string" && reasoning && !blocks.some((block) => block.kind === "thinking")
		? [{ kind: "thinking", text: reasoning }, ...blocks]
		: blocks;
}

/** Normalise the `models` array from `get_available_models`. */
export function parseModels(raw: unknown): ModelInfo[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
		.map((m) => ({
			provider: String(m.provider ?? ""),
			id: String(m.id ?? ""),
			name: typeof m.name === "string" ? m.name : undefined,
			contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : undefined,
			maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : undefined,
			reasoning: typeof m.reasoning === "boolean" ? m.reasoning : undefined,
			input: Array.isArray(m.input) ? m.input.filter((value): value is string => typeof value === "string") : undefined,
			cost: m.cost && typeof m.cost === "object" ? m.cost as ModelInfo["cost"] : undefined,
			currency: m.currency === "USD" ? "USD" as const : "CNY" as const,
		}))
		.filter((m) => m.provider && m.id);
}

/** Providers may reuse call IDs after compaction; the latest call owns its result. */
export function toolResultMessageIndex(messages: ChatMessage[], toolCallId: unknown): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].blocks.some((block) => block.kind === "tool" && block.id === toolCallId)) return index;
	}
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "assistant") return index;
	}
	return -1;
}

export interface SessionEntries {
	entries: { id: string; parentId: string | null; type: string; message?: Record<string, unknown> }[];
	leafId: string | null;
}

/** pi omits retry failures from model context; recover diagnostics from the active raw branch. */
function withHistoryErrors(raw: unknown[], history?: SessionEntries): unknown[] {
	if (!history || !Array.isArray(history.entries)) return raw;
	const timestamps = raw.flatMap((value) => value && typeof value === "object" ? [parseTimestamp((value as Record<string, unknown>).timestamp)].filter((time): time is number => time !== undefined) : []);
	if (!timestamps.length) return raw;
	const start = timestamps.reduce((earliest, time) => Math.min(earliest, time), Infinity);
	const entries = new Map(history.entries.map((entry) => [entry.id, entry]));
	const seen = new Set<string>();
	const errors: Record<string, unknown>[] = [];
	let cursor = history.leafId;
	while (cursor && !seen.has(cursor)) {
		seen.add(cursor);
		const entry = entries.get(cursor);
		if (!entry) break;
		const message = entry.message;
		const time = parseTimestamp(message?.timestamp);
		if (entry.type === "message" && message?.role === "assistant" && typeof message.errorMessage === "string" && message.errorMessage && time !== undefined && time >= start) errors.push(message);
		cursor = entry.parentId;
	}
	const merged = [...raw];
	for (const message of errors.reverse()) {
		const time = parseTimestamp(message.timestamp)!;
		if (merged.some((value) => value && typeof value === "object" && parseTimestamp((value as Record<string, unknown>).timestamp) === time && (value as Record<string, unknown>).errorMessage === message.errorMessage)) continue;
		const index = merged.findIndex((value) => value && typeof value === "object" && (parseTimestamp((value as Record<string, unknown>).timestamp) ?? -Infinity) > time);
		merged.splice(index < 0 ? merged.length : index, 0, message);
	}
	return merged;
}

/** Restore the active pi branch, attaching tool results to their assistant turn. */
export function parseMessages(raw: unknown, history?: SessionEntries): ChatMessage[] {
	if (!Array.isArray(raw)) return [];
	const messages: ChatMessage[] = [];
	for (const [index, value] of withHistoryErrors(raw, history).entries()) {
		if (!value || typeof value !== "object") continue;
		const message = value as Record<string, unknown>;
		if (message.role === "toolResult") {
			const assistant = messages[toolResultMessageIndex(messages, message.toolCallId)];
			assistant?.blocks.push(...parseBlocks([{ ...message, type: "toolResult" }]));
		} else if (message.role === "user" || message.role === "assistant") {
			messages.push({
				entryId: typeof message.entryId === "string" ? message.entryId : undefined,
				id: `history_${index}`, role: message.role, blocks: message.role === "assistant" ? parseMessageBlocks(message) : parseBlocks(message.content),
				provider: typeof message.provider === "string" ? message.provider : undefined,
				model: typeof message.model === "string" ? message.model : undefined,
				usage: message.usage as ChatMessage["usage"],
				stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
				errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : undefined,
				durationMs: typeof message.durationMs === "number" ? message.durationMs : undefined,
				timestamp: parseTimestamp(message.timestamp),
			});
		}
	}
	return messages;
}
