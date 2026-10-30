import type { ChatMessage, ContentBlock } from "./types";
import { toolActionSummaries, type ToolRunItem } from "./toolRuns";
import { formatElapsedSeconds } from "./usage";

type Result = Extract<ContentBlock, { kind: "toolResult" }>;
export type ProcessBlock = { key: number; block: ContentBlock; result?: Result };
export type LocatedProcessBlock = ProcessBlock & { messageId: string; thinkingComplete: boolean };
export type ProcessCounts = { thinkingSegments: number; thinkingChars: number; steps: number };
export type TurnProcessGroup = {
	id: string;
	turnId: string;
	placement: "head" | "inline";
	entries: LocatedProcessBlock[];
	narrationTexts: string[];
	counts: ProcessCounts;
	closed: boolean;
	advanced: boolean;
	pending: boolean;
	error: boolean;
	terminal?: boolean;
	activeKind?: ContentBlock["kind"];
};
export type ProcessPresentation = { head?: TurnProcessGroup; groups: Map<number, TurnProcessGroup>; hidden: Set<number> };

/** Keep the existing result matching and orphan-result ordering in the rendering layer. */
export function processBlocks(message: ChatMessage): ProcessBlock[] {
	const results = message.blocks.filter((block): block is Result => block.kind === "toolResult");
	const matched = new Set<Result>();
	const rendered: ProcessBlock[] = [];
	message.blocks.forEach((block, key) => {
		if (block.kind === "toolResult") return;
		const result = block.kind === "tool" ? results.find((entry) => !matched.has(entry) && (entry.id ? entry.id === block.id : entry.name === block.name)) : undefined;
		if (result) matched.add(result);
		rendered.push({ key, block, result });
	});
	results.forEach((result, index) => { if (!matched.has(result)) rendered.push({ key: message.blocks.length + index, block: result }); });
	return rendered;
}

const emptyCounts = (): ProcessCounts => ({ thinkingSegments: 0, thinkingChars: 0, steps: 0 });

/** A text block is process narration only when the next assistant step calls a tool. */
function narrationKeys(messages: ChatMessage[]): Set<string> {
	const keys = new Set<string>();
	let previousText: string | undefined;
	for (const message of messages) {
		if (message.role === "user") { previousText = undefined; continue; }
		for (const [key, block] of message.blocks.entries()) {
			if (block.kind === "tool" && previousText) keys.add(previousText);
			previousText = block.kind === "text" && block.text.length ? `${message.id}:${key}` : undefined;
		}
	}
	return keys;
}

/** Reasoning and step totals freeze at reply boundaries; tool outcomes remain live. */
function countProcess(entries: LocatedProcessBlock[]): ProcessCounts {
	const counts = emptyCounts();
	for (const entry of entries) {
		if (entry.block.kind === "thinking") {
			if (entry.thinkingComplete) counts.thinkingSegments++;
			counts.thinkingChars += entry.block.text.trim().length;
			counts.steps++;
		} else if (entry.block.kind === "tool") {
			counts.steps++;
		}
	}
	return counts;
}

/** Split at visible reply boundaries without modifying messages, transport, usage or copy content. */
export function turnProcessPresentation(messages: ChatMessage[], { running = false, activeTurnId, frozenCounts = new Map() }: { running?: boolean; activeTurnId?: string; frozenCounts?: ReadonlyMap<string, ProcessCounts> } = {}) {
	const narration = narrationKeys(messages);
	const presentation = new Map<string, ProcessPresentation>();
	const groups: TurnProcessGroup[] = [];
	let turnId = "";
	let hasReply = false;
	let current: TurnProcessGroup | undefined;
	let head: TurnProcessGroup | undefined;
	let pendingNarration: string | undefined;
	const forMessage = (id: string) => {
		let value = presentation.get(id);
		if (!value) { value = { groups: new Map(), hidden: new Set() }; presentation.set(id, value); }
		return value;
	};
	const createGroup = (id: string, placement: TurnProcessGroup["placement"]): TurnProcessGroup => {
		const group: TurnProcessGroup = { id, turnId, placement, entries: [], narrationTexts: [], counts: emptyCounts(), closed: false, advanced: false, pending: false, error: false };
		groups.push(group);
		return group;
	};
	for (const message of messages) {
		if (message.role === "user" || !turnId) {
			if (current) { current.closed = true; current.advanced = true; }
			turnId = `turn:${message.id}`;
			hasReply = false;
			current = undefined;
			head = undefined;
			pendingNarration = undefined;
		}
		if (message.role !== "assistant") continue;
		if (!head) {
			head = createGroup(`${turnId}:head`, "head");
			current = head;
			forMessage(message.id).head = head;
		}
		const blocks = processBlocks(message);
		for (const [index, entry] of blocks.entries()) {
			const { block } = entry;
			// text_start contains no token yet. The first received token closes the prelude.
			if (block.kind === "text" || block.kind === "image") {
				if (block.kind === "text" && !block.text.length) continue;
				pendingNarration = block.kind === "text" && narration.has(`${message.id}:${entry.key}`) ? block.text : undefined;
				// The first narrated text can precede the prelude's first tool. Keep
				// that empty head group as its anchor, while rendering text normally.
				if (current && !(current === head && !current.entries.length && pendingNarration)) {
					current.closed = true;
					current.advanced = true;
					current = undefined;
				}
				hasReply = true;
				continue;
			}
			if (!current) {
				current = createGroup(`${turnId}:inline:${message.id}:${entry.key}`, hasReply ? "inline" : "head");
				forMessage(message.id).groups.set(entry.key, current);
			}
			if (block.kind === "tool" && pendingNarration) {
				current.narrationTexts.push(pendingNarration);
				pendingNarration = undefined;
			}
			const thinkingComplete = block.kind === "thinking" && (!message.streaming || blocks.slice(index + 1).some((next) => next.block.kind !== "toolResult" && (next.block.kind !== "text" || next.block.text.length > 0)));
			current.entries.push({ ...entry, messageId: message.id, thinkingComplete });
			forMessage(message.id).hidden.add(entry.key);
		}
	}
	const active = activeTurnId ?? groups[groups.length - 1]?.turnId;
	const tails = new Map(groups.map((group) => [group.turnId, group.id]));
	for (const group of groups) {
		group.terminal = tails.get(group.turnId) === group.id;
		if (!running || group.turnId !== active) group.closed = true;
		group.counts = (group.closed ? frozenCounts.get(group.id) : undefined) ?? countProcess(group.entries);
		group.pending = group.entries.some((entry) => entry.block.kind === "tool" && !entry.result);
		group.error = group.entries.some((entry) => entry.result?.isError || (entry.block.kind === "toolResult" && entry.block.isError));
	}
	return { presentation, groups };
}

export function processCountLabel(group: Pick<TurnProcessGroup, "placement" | "counts" | "entries">, thinking = false, includeFailures = true, settled = false): string {
	const tools: ToolRunItem[] = group.entries.flatMap(({ key, block, result }) => block.kind === "tool" ? [{ key, block, result }] : block.kind === "toolResult" ? [{ key, block: { kind: "tool", id: block.id ?? `result:${key}`, name: block.name, argsText: "{}", done: true }, result: block }] : []);
	const parts = toolActionSummaries(includeFailures ? tools : tools.map((item) => ({ ...item, result: item.result && { ...item.result, isError: false } })), settled);
	if (!parts.length && group.entries.some((entry) => entry.block.kind === "thinking")) parts.push(thinking ? "正在思考…" : "查看思考过程");
	return parts.join(" · ");
}

/** One stable disclosure owns thinking, tools and prose proven to precede a tool. */
export function aggregateTurnProcess(messages: ChatMessage[], options: { running?: boolean; activeTurnId?: string } = {}) {
	const presentation = new Map<string, ProcessPresentation>();
	const byTurn = new Map<string, TurnProcessGroup>();
	const turnMessages = new Map<string, ChatMessage[]>();
	let currentTurn = "";
	for (const message of messages) {
		if (message.role === "user" || !currentTurn) currentTurn = `turn:${message.id}`;
		if (message.role !== "assistant") continue;
		const list = turnMessages.get(currentTurn) ?? [];
		list.push(message);
		turnMessages.set(currentTurn, list);
	}
	const active = options.activeTurnId ?? [...turnMessages.keys()][turnMessages.size - 1];
	for (const [turnId, assistants] of turnMessages) {
		const entries = assistants.flatMap((message) => processBlocks(message).map((entry) => ({ ...entry, messageId: message.id, thinkingComplete: !message.streaming || message.blocks.slice(entry.key + 1).some((block) => block.kind !== "toolResult" && (block.kind !== "text" || block.text.length > 0)) })));
		let lastTool = -1;
		entries.forEach((entry, index) => { if (entry.block.kind === "tool") lastTool = index; });
		const processEntries = entries.filter((entry, index) => entry.block.kind !== "image" && (entry.block.kind !== "text" || index < lastTool));
		const turn: TurnProcessGroup = { id: `${turnId}:head`, turnId, placement: "head", entries: processEntries, narrationTexts: [], counts: countProcess(processEntries), closed: !options.running || turnId !== active, advanced: false, terminal: true, pending: processEntries.some((entry) => entry.block.kind === "tool" && !entry.result), error: processEntries.some((entry) => entry.result?.isError || (entry.block.kind === "toolResult" && entry.block.isError)), activeKind: [...entries].reverse().find((entry) => entry.block.kind !== "toolResult" && (entry.block.kind !== "text" || entry.block.text.length > 0))?.block.kind };
		byTurn.set(turnId, turn);
		for (const message of assistants) {
			presentation.set(message.id, { head: message === assistants[0] ? turn : undefined, groups: new Map(), hidden: new Set(processEntries.filter((entry) => entry.messageId === message.id).map((entry) => entry.key)) });
		}
	}
	return { presentation, groups: [...byTurn.values()] };
}

/** Measured runtime wins. Timestamps only describe an approximate historical interval. */
export function turnDurationLabel(messages: ChatMessage[]): string {
	const measured = [...messages].reverse().find((message) => message.role === "assistant" && typeof message.durationMs === "number" && Number.isFinite(message.durationMs) && message.durationMs >= 0)?.durationMs;
	const start = messages.find((message) => message.role === "user")?.timestamp;
	const end = [...messages].reverse().find((message) => message.role === "assistant")?.timestamp;
	const estimated = measured === undefined && start !== undefined && end !== undefined && Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : undefined;
	const duration = measured ?? estimated;
	return duration === undefined ? "用时未记录" : `用时${measured === undefined ? "约" : ""} ${formatElapsedSeconds(Math.round(duration / 1000))}`;
}
