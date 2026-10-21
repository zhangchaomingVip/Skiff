import type { ChatMessage, ContentBlock } from "./types";
import { toolActionSummaries, type ToolRunItem } from "./toolRuns";

type Result = Extract<ContentBlock, { kind: "toolResult" }>;
export type ProcessBlock = { key: number; block: ContentBlock; result?: Result };
export type LocatedProcessBlock = ProcessBlock & { messageId: string; thinkingComplete: boolean };
export type ProcessCounts = { thinkingSegments: number; thinkingChars: number; steps: number };
export type TurnProcessGroup = {
	id: string;
	turnId: string;
	placement: "head" | "inline";
	entries: LocatedProcessBlock[];
	counts: ProcessCounts;
	closed: boolean;
	pending: boolean;
	error: boolean;
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
	const presentation = new Map<string, ProcessPresentation>();
	const groups: TurnProcessGroup[] = [];
	let turnId = "";
	let hasReply = false;
	let current: TurnProcessGroup | undefined;
	let head: TurnProcessGroup | undefined;
	const forMessage = (id: string) => {
		let value = presentation.get(id);
		if (!value) { value = { groups: new Map(), hidden: new Set() }; presentation.set(id, value); }
		return value;
	};
	const createGroup = (id: string, placement: TurnProcessGroup["placement"]): TurnProcessGroup => {
		const group: TurnProcessGroup = { id, turnId, placement, entries: [], counts: emptyCounts(), closed: false, pending: false, error: false };
		groups.push(group);
		return group;
	};
	for (const message of messages) {
		if (message.role === "user" || !turnId) {
			if (current) current.closed = true;
			turnId = `turn:${message.id}`;
			hasReply = false;
			current = undefined;
			head = undefined;
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
				if (current) current.closed = true;
				hasReply = true;
				current = undefined;
				continue;
			}
			if (!current) {
				current = createGroup(`${turnId}:inline:${message.id}:${entry.key}`, hasReply ? "inline" : "head");
				forMessage(message.id).groups.set(entry.key, current);
			}
			const thinkingComplete = block.kind === "thinking" && (!message.streaming || blocks.slice(index + 1).some((next) => next.block.kind !== "toolResult" && (next.block.kind !== "text" || next.block.text.length > 0)));
			current.entries.push({ ...entry, messageId: message.id, thinkingComplete });
			forMessage(message.id).hidden.add(entry.key);
		}
	}
	const active = activeTurnId ?? groups[groups.length - 1]?.turnId;
	for (const group of groups) {
		if (!running || group.turnId !== active) group.closed = true;
		group.counts = (group.closed ? frozenCounts.get(group.id) : undefined) ?? countProcess(group.entries);
		group.pending = group.entries.some((entry) => entry.block.kind === "tool" && !entry.result);
		group.error = group.entries.some((entry) => entry.result?.isError || (entry.block.kind === "toolResult" && entry.block.isError));
	}
	return { presentation, groups };
}

export function processCountLabel(group: Pick<TurnProcessGroup, "placement" | "counts" | "entries">, thinking = false): string {
	const { thinkingSegments, thinkingChars, steps } = group.counts;
	const format = (value: number) => value.toLocaleString("en-US");
	const tools: ToolRunItem[] = group.entries.flatMap(({ key, block, result }) => block.kind === "tool" ? [{ key, block, result }] : block.kind === "toolResult" ? [{ key, block: { kind: "tool", id: block.id ?? `result:${key}`, name: block.name, argsText: "{}", done: true }, result: block }] : []);
	const parts = [];
	if (thinkingSegments || thinkingChars) parts.push(thinking && !thinkingSegments ? `思考中（${format(thinkingChars)} 字）` : `思考了 ${format(thinkingSegments)} 段（${format(thinkingChars)} 字）`);
	parts.push(...toolActionSummaries(tools));
	if (!parts.length && thinking) parts.push("思考中");
	if (group.placement === "head") parts.push(`步骤 ${format(steps)}`);
	return parts.join(" · ");
}
