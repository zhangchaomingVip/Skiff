import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ContentBlock } from "../src/chat/types.ts";
import { turnFileOps } from "../src/chat/turnResults.ts";

const call = (id: string, name: string, args: Record<string, unknown>): ContentBlock => ({ kind: "tool", id, name, argsText: JSON.stringify(args), done: true });
const done = (id: string, name: string, text: string, extra: Partial<Extract<ContentBlock, { kind: "toolResult" }>> = {}): ContentBlock => ({ kind: "toolResult", id, name, text, isError: false, ...extra });
const assistant = (id: string, blocks: ContentBlock[]): ChatMessage => ({ id, role: "assistant", blocks });

test("file changes derive from write and edit results with diff counts", () => {
	const messages = [
		assistant("a", [
			call("w", "write", { path: "notes.md", content: "x" }),
			done("w", "write", "ok"),
			call("e", "edit", { path: "src/App.tsx", oldText: "a", newText: "b" }),
			done("e", "edit", "ok", { diff: "-const a = 1;\n+const b = 2;\n+const c = 3;" }),
		]),
	];
	assert.deepEqual(turnFileOps(messages), [
		{ op: "create", path: "notes.md" },
		{ op: "edit", path: "src/App.tsx", additions: 2, removals: 1 },
	]);
});

test("failed results, unpaired calls and non-file tools are excluded", () => {
	const messages = [
		assistant("a", [
			call("bad", "edit", { path: "a.ts" }),
			done("bad", "edit", "boom", { isError: true, diff: "-a\n+b" }),
			call("cmd", "bash", { command: "rm -rf build" }),
			done("cmd", "bash", "removed"),
			call("read", "read", { path: "c.ts" }),
			done("read", "read", "content"),
		]),
		assistant("b", [call("lonely", "write", { path: "b.ts" })]),
	];
	assert.deepEqual(turnFileOps(messages), []);
});

test("repeated operations on one path merge into the latest op with summed counts", () => {
	const messages = [
		assistant("a", [
			call("w", "write", { path: "notes.md" }),
			done("w", "write", "ok", { diff: "+one\n+two" }),
			call("e1", "edit", { path: "notes.md" }),
			done("e1", "edit", "ok", { diff: "+x" }),
			call("e2", "edit", { path: "notes.md" }),
			done("e2", "edit", "ok"),
		]),
	];
	assert.deepEqual(turnFileOps(messages), [{ op: "edit", path: "notes.md", additions: 3, removals: 0 }]);
});

test("deletions are reported without diff data", () => {
	const messages = [
		assistant("a", [call("d", "delete", { path: "tmp/old.txt" }), done("d", "delete", "removed")]),
	];
	assert.deepEqual(turnFileOps(messages), [{ op: "delete", path: "tmp/old.txt" }]);
});

test("a delete after edits drops accumulated line counts", () => {
	const messages = [
		assistant("a", [
			call("e", "edit", { path: "notes.md" }),
			done("e", "edit", "ok", { diff: "+x\n-y" }),
			call("d", "delete", { path: "notes.md" }),
			done("d", "delete", "removed"),
		]),
	];
	assert.deepEqual(turnFileOps(messages), [{ op: "delete", path: "notes.md" }]);
});

test("unified diff headers are not counted as changed lines", () => {
	const messages = [
		assistant("a", [
			call("e", "edit", { path: "src/App.tsx" }),
			done("e", "edit", "ok", { diff: "--- a/src/App.tsx\n+++ b/src/App.tsx\n-const a = 1;\n+const b = 2;\n+const c = 3;" }),
		]),
	];
	assert.deepEqual(turnFileOps(messages), [{ op: "edit", path: "src/App.tsx", additions: 2, removals: 1 }]);
});

test("plain answers produce no cards", () => {
	assert.deepEqual(turnFileOps([
		{ id: "u", role: "user", blocks: [{ kind: "text", text: "解释一下" }] },
		assistant("a", [{ kind: "text", text: "这是解释。" }]),
	]), []);
});
