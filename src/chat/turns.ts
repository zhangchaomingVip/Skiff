import type { ChatMessage, ImageAttachment } from "./types";
import type { PiRpc } from "../rpc/RpcClient";
import { parseBlocks } from "./parse";
import { splitAttachments, type TextAttachment } from "./textAttachments";

export interface TurnInfo {
	/** The user prompt and all assistant messages answering it share this id. */
	turnId: string;
	/** First assistant message of the turn: it renders the single process fold. */
	head: boolean;
	/** Reasoning and tool blocks across the whole turn, shown as `N 步`. */
	stepCount: number;
	/** Measured live when the run settles, or derived from the prompt/reply timestamps. */
	durationMs?: number;
}

/**
 * pi streams one agent run as several consecutive assistant messages (each with its own
 * reasoning and tool call). They are one turn and must fold together. A user message
 * starts a new turn.
 */
export function groupTurns(messages: ChatMessage[]): TurnInfo[] {
	const ids: string[] = [];
	let current = "";
	messages.forEach((message, index) => {
		if (message.role === "user" || !current) current = `turn:${message.id}`;
		ids[index] = current;
	});
	const steps = new Map<string, number>();
	const measured = new Map<string, number>();
	const started = new Map<string, number>();
	const finished = new Map<string, number>();
	messages.forEach((message, index) => {
		const id = ids[index];
		steps.set(id, (steps.get(id) ?? 0) + message.blocks.filter((block) => block.kind === "thinking" || block.kind === "tool").length);
		if (message.role === "user" && typeof message.timestamp === "number") started.set(id, message.timestamp);
		if (message.role === "assistant") {
			if (typeof message.durationMs === "number") measured.set(id, message.durationMs);
			if (typeof message.timestamp === "number") finished.set(id, message.timestamp);
		}
	});
	return messages.map((message, index) => {
		const id = ids[index];
		const head = message.role === "assistant" && (index === 0 || messages[index - 1].role === "user");
		const start = started.get(id);
		const end = finished.get(id);
		const durationMs = measured.get(id) ?? (start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined);
		// Only the head carries the fold summary; it renders the header for the whole turn.
		return { turnId: id, head, stepCount: head ? (steps.get(id) ?? 0) : 0, durationMs: head ? durationMs : undefined };
	});
}

export function userForTurn(messages: ChatMessage[], id: string): ChatMessage | undefined {
	const index = messages.findIndex((message) => message.id === id);
	if (index < 0) return undefined;
	return messages.slice(0, index + 1).reverse().find((message) => message.role === "user");
}

export function turnDraft(message: ChatMessage): { text: string; images: ImageAttachment[]; files: TextAttachment[] } {
	const { text, attachments } = splitAttachments(message.blocks.filter((b) => b.kind === "text").map((b) => b.text).join("\n\n"));
	return {
		text,
		images: message.blocks.filter((b) => b.kind === "image").map((b, index) => ({ ...b, id: crypto.randomUUID(), type: "image", name: `图片 ${index + 1}` })),
		files: attachments.map((attachment) => ({ id: crypto.randomUUID(), name: attachment.name, text: attachment.content })),
	};
}

/** Fork before the chosen user turn; pi preserves the original session file. */
interface Entry { id: string; parentId: string | null; type: string; message?: { role: string; content: unknown } }

export function forkEntry(messages: ChatMessage[], id: string, entries: Entry[], leafId: string | null): string {
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const branch: Entry[] = [];
	const visited = new Set<string>();
	let cursor = leafId;
	while (cursor && !visited.has(cursor)) {
		visited.add(cursor);
		const entry = byId.get(cursor);
		if (!entry) throw new Error("无法定位当前会话分支。");
		if (entry.type === "message" && entry.message?.role === "user") branch.push(entry);
		cursor = entry.parentId;
	}
	branch.reverse();
	const users = messages.filter((message) => message.role === "user");
	// Compaction may remove early turns from get_messages; visible users are a suffix.
	const visible = branch.slice(-users.length);
	const user = userForTurn(messages, id);
	const choice = visible[users.findIndex((message) => message.id === user?.id)];
	if (!choice || visible.length !== users.length || visible.some((entry, index) => JSON.stringify(parseBlocks(entry.message?.content)) !== JSON.stringify(users[index].blocks))) throw new Error("聊天历史已变化，请重新载入后再操作。");
	return choice.id;
}

export async function forkTurn(rpc: PiRpc, messages: ChatMessage[], id: string): Promise<boolean> {
	const { entries, leafId } = await rpc.request<{ entries: Entry[]; leafId: string | null }>({ type: "get_entries" });
	const result = await rpc.request<{ cancelled: boolean }>({ type: "fork", entryId: forkEntry(messages, id, entries, leafId) });
	return !result.cancelled;
}
