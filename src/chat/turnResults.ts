import type { ChatMessage } from "./types";
import { processBlocks } from "./turnProcess";
import { toolTarget } from "./toolRuns";

/** One structured file outcome rendered as a result card row. */
export interface FileOp {
	op: "create" | "edit" | "delete";
	path: string;
	/** Present only when the tool result carried a structured diff; never inferred. */
	additions?: number;
	removals?: number;
}

const OP_BY_TOOL: Record<string, FileOp["op"]> = {
	write: "create", create: "create", write_file: "create",
	edit: "edit", multi_edit: "edit", multiedit: "edit", apply_patch: "edit", patch: "edit", str_replace: "edit", str_replace_editor: "edit", edit_file: "edit",
	delete: "delete", remove: "delete", delete_file: "delete",
};

function diffCounts(diff?: string): { additions: number; removals: number } | undefined {
	if (!diff) return undefined;
	// Unified diff headers (+++ path / --- path) are metadata, not changed lines.
	const additions = diff.split("\n").filter((line) => /^\+(?!\+\+)/.test(line)).length;
	const removals = diff.split("\n").filter((line) => /^-(?!--)/.test(line)).length;
	return additions || removals ? { additions, removals } : undefined;
}

/** Structured file outcomes of one turn; sources are tool results only, never reply prose. */
export function turnFileOps(messages: ChatMessage[]): FileOp[] {
	const byPath = new Map<string, FileOp>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const { block, result } of processBlocks(message)) {
			if (block.kind !== "tool" || !result || result.isError) continue;
			const op = OP_BY_TOOL[block.name.toLowerCase()];
			if (!op) continue;
			const path = toolTarget(block);
			if (!path || /^(?:[a-z]+:)?\/\//i.test(path)) continue;
			const counts = diffCounts(result.diff);
			const existing = byPath.get(path);
			if (existing) {
				existing.op = op;
				// A deletion carries no line counts; drop any accumulated from earlier edits.
				if (op === "delete") {
					delete existing.additions;
					delete existing.removals;
				} else if (counts) {
					existing.additions = (existing.additions ?? 0) + counts.additions;
					existing.removals = (existing.removals ?? 0) + counts.removals;
				}
			} else {
				byPath.set(path, { op, path, ...(counts ?? {}) });
			}
		}
	}
	return [...byPath.values()];
}
