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
			const text = String(block.text ?? "");
			if (text) blocks.push({ kind: "text", text });
		} else if (type === "image" && typeof block.data === "string" && typeof block.mimeType === "string" && /^image\/(png|jpeg|webp|gif)$/.test(block.mimeType)) {
			blocks.push({ kind: "image", data: block.data, mimeType: block.mimeType });
		} else if (type === "thinking" || type === "reasoning") {
			const text = String(block.thinking ?? block.text ?? "");
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
		}))
		.filter((m) => m.provider && m.id);
}

/** Restore the active pi branch, attaching tool results to their assistant turn. */
export function parseMessages(raw: unknown): ChatMessage[] {
	if (!Array.isArray(raw)) return [];
	const messages: ChatMessage[] = [];
	for (const [index, value] of raw.entries()) {
		if (!value || typeof value !== "object") continue;
		const message = value as Record<string, unknown>;
		if (message.role === "toolResult") {
			const assistant = [...messages].reverse().find((m) => m.blocks.some((b) => b.kind === "tool" && b.id === message.toolCallId)) ?? [...messages].reverse().find((m) => m.role === "assistant");
			assistant?.blocks.push(...parseBlocks([{ ...message, type: "toolResult" }]));
		} else if (message.role === "user" || message.role === "assistant") {
			messages.push({
				id: `history_${index}`, role: message.role, blocks: parseBlocks(message.content),
				provider: typeof message.provider === "string" ? message.provider : undefined,
				model: typeof message.model === "string" ? message.model : undefined,
				usage: message.usage as ChatMessage["usage"],
				stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
				durationMs: typeof message.durationMs === "number" ? message.durationMs : undefined,
				timestamp: parseTimestamp(message.timestamp),
			});
		}
	}
	return messages;
}
