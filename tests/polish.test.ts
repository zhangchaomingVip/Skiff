import test from "node:test";
import assert from "node:assert/strict";
import { parseMessages } from "../src/chat/parse.ts";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { forkEntry, forkTurn, groupTurns, turnDraft, userForTurn } from "../src/chat/turns.ts";
import { readTextFiles, appendTextFiles, splitAttachments } from "../src/chat/textAttachments.ts";
import { highlightCode } from "../src/chat/highlight.ts";
import { formatCompletedAt, formatDuration } from "../src/chat/usage.ts";
import { isNotableThinking, shouldShowThinking } from "../src/chat/thinking.ts";
import { toolKind, toolKindLabel, toolRunSummary, toolTarget, type ToolRunItem } from "../src/chat/toolRuns.ts";
import { PiRpc } from "../src/rpc/RpcClient.ts";
import { installMockPi } from "./mockPi.mjs";

test("tool IDs pair out-of-order results with the correct assistant in live and restored history", () => {
	const calls = [
		{ role: "assistant", content: [{ type: "toolCall", id: "edit-1", name: "edit", arguments: {} }] },
		{ role: "assistant", content: [{ type: "toolCall", id: "edit-2", name: "edit", arguments: {} }] },
	];
	const result = { role: "toolResult", toolCallId: "edit-1", toolName: "edit", content: [{ type: "text", text: "ok" }], details: { diff: "-old\n+new" } };
	const restored = parseMessages([...calls, result]);
	const live = reduce({ ...initialSessionState, messages: parseMessages(calls) }, { type: "message_end", message: result });
	for (const messages of [restored, live.messages]) {
		assert.equal(messages[0].blocks[1].kind, "toolResult");
		assert.equal(messages[0].blocks[1].id, "edit-1");
		assert.equal(messages[0].blocks[1].diff, "-old\n+new");
		assert.equal(messages[1].blocks.length, 1);
	}
});

test("completed messages keep object identity while a later reply streams", () => {
	let state = { ...initialSessionState, messages: parseMessages([{ role: "user", content: "first" }, { role: "assistant", content: "done" }]) };
	const completed = state.messages[1];
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	for (let i = 0; i < 200; i++) state = reduce(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "token " } });
	assert.equal(state.messages[1], completed);
	assert.equal(state.messages[2].blocks[0].text.length, 1200);
});

test("settled runs attach their duration to the last assistant message only", () => {
	let state = { ...initialSessionState, messages: parseMessages([{ role: "user", content: "first" }, { role: "assistant", content: "done" }]) };
	state = reduce(state, { type: "turn_duration", durationMs: 4200 });
	assert.equal(state.messages[1].durationMs, 4200);
	assert.equal(state.messages[0].durationMs, undefined);
});

test("pi finish reason survives both live and restored messages", () => {
	assert.equal(parseMessages([{ role: "assistant", content: "partial", stopReason: "length" }])[0].stopReason, "length");
	const live = reduce({ ...initialSessionState, messages: parseMessages([{ role: "user", content: "hi" }]) }, { type: "message_end", message: { role: "assistant", content: "partial", stopReason: "length" } });
	assert.equal(live.messages.at(-1)?.stopReason, "length");
});

test("text attachments reject binary/invalid UTF-8, enforce limits and preserve embedded fences", async () => {
	const files = await readTextFiles([new File(["log\n```\nend"], "run.log")], 0);
	assert.match(appendTextFiles("inspect", files), /````text\nlog\n```\nend\n````/);
	await assert.rejects(readTextFiles([new File(["\0"], "binary")], 0), /二进制/);
	await assert.rejects(readTextFiles([new File([new Uint8Array([255])], "invalid")], 0));
	await assert.rejects(readTextFiles([new File(["text"], "x")], 4), /最多/);
	await assert.rejects(readTextFiles([new File([new Uint8Array(512 * 1024 + 1)], "large")], 0), /512 KiB/);
});

test("text attachments round-trip through the prompt and split back for display", async () => {
	const files = await readTextFiles([new File(["log\n```\nend"], "run.log")], 0);
	const parsed = splitAttachments(appendTextFiles("inspect", files));
	assert.equal(parsed.text, "inspect");
	assert.equal(parsed.attachments.length, 1);
	assert.equal(parsed.attachments[0].name, "run.log");
	assert.equal(parsed.attachments[0].content, "log\n```\nend");
	assert.deepEqual(splitAttachments("plain text"), { text: "plain text", attachments: [] });
});

test("syntax highlighting escapes input and only handles registered languages", () => {
	assert.match(highlightCode("const x = '<b>'", "typescript") ?? "", /hljs-keyword/);
	assert.match(highlightCode("const x = '<b>'", "ts") ?? "", /&lt;b&gt;/);
	assert.equal(highlightCode("plain", "text"), undefined);
	assert.equal(highlightCode("plain", "not-a-real-language"), undefined);
});

test("tool runs collapse into one Codex-style phrase with a dominant category icon", () => {
	const tool = (id: string, name: string, args: Record<string, unknown>): ToolRunItem["block"] => ({ kind: "tool", id, name, argsText: JSON.stringify(args), done: true });
	const ok = (name: string): ToolRunItem["result"] => ({ kind: "toolResult", name, text: "ok", isError: false });
	const read: ToolRunItem[] = [
		{ key: 0, block: tool("a", "read", { path: "src/App.tsx" }), result: ok("read") },
		{ key: 1, block: tool("b", "bash", { command: "npm run build" }), result: ok("bash") },
	];
	const finished = toolRunSummary(read);
	assert.equal(finished.kind, "read");
	assert.equal(finished.label, "读取了文件运行了命令");
	assert.equal(finished.running, false);
	assert.equal(finished.steps, 2);
	const live = toolRunSummary([...read, { key: 2, block: tool("c", "edit", {}), result: undefined }]);
	assert.equal(live.kind, "write");
	assert.equal(live.label, "读取文件运行命令编辑文件");
	assert.equal(live.running, true);
	assert.equal(toolKind("MULTI_EDIT"), "write");
	assert.equal(toolKindLabel("unknown-tool"), "unknown-tool");
	assert.equal(toolTarget(tool("d", "read", { path: "src/chat/parse.ts" })), "src/chat/parse.ts");
});

test("consecutive assistant messages between user prompts fold as one turn", () => {
	const infos = groupTurns(parseMessages([
		{ role: "user", content: "start" },
		{ role: "assistant", content: [{ type: "thinking", thinking: "a" }, { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls" } }, { type: "text", text: "reply 1" }] },
		{ role: "assistant", content: [{ type: "thinking", thinking: "b" }, { type: "text", text: "reply 2" }] },
		{ role: "user", content: "again" },
		{ role: "assistant", content: [{ type: "thinking", thinking: "c" }] },
	]));
	assert.deepEqual(infos.map((info) => info.stepCount), [0, 3, 0, 0, 1]);
	assert.deepEqual(infos.map((info) => info.head), [false, true, false, false, true]);
	assert.equal(infos[1].turnId, infos[2].turnId);
	assert.notEqual(infos[2].turnId, infos[4].turnId);
});

test("turn header shows duration + steps and the footer shows the completion clock", () => {
	const infos = groupTurns(parseMessages([
		{ role: "user", content: "go", timestamp: 1_700_000_000_000 },
		{ role: "assistant", content: [{ type: "thinking", thinking: "a" }], timestamp: 1_700_000_046_000 },
	]));
	assert.equal(infos[1].stepCount, 1);
	assert.equal(infos[1].durationMs, 46000);
	assert.equal(formatDuration(infos[1].durationMs!), "46s");
	assert.equal(formatCompletedAt(new Date(2026, 9, 2, 23, 15).getTime()), "星期五23:15");
});

test("short reasoning is hidden once a turn settles but stays visible while streaming", () => {
	assert.equal(isNotableThinking("先检查现有交互，再验证边界情况。"), false);
	assert.equal(isNotableThinking("推理".repeat(80)), true);
	assert.equal(isNotableThinking("先读文件\n再验证边界"), true);
	assert.equal(shouldShowThinking("先检查现有交互。", true), true);
	assert.equal(shouldShowThinking("先检查现有交互。", false), false);
	assert.equal(shouldShowThinking("推理".repeat(80), false), true);
});

test("regeneration forks before the correct repeated or image-only prompt and preserves the original", async () => {
	globalThis.window = globalThis;
	installMockPi(window);
	const rpc = new PiRpc("polish");
	await rpc.start();
	try {
		for (const message of ["repeat", "repeat", ""]) {
			await rpc.request({ type: "prompt", message, images: message ? [] : [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }] });
			await rpc.request({ type: "abort" });
		}
		const original = (await rpc.request<{ sessionFile: string }>({ type: "get_state" })).sessionFile;
		const messages = parseMessages((await rpc.request<{ messages: unknown }>({ type: "get_messages" })).messages);
		const user = userForTurn(messages, messages.at(-1)!.id)!;
		assert.equal(turnDraft(user).images.length, 1);
		assert.equal(await forkTurn(rpc, messages, user.id), true);
		assert.equal(parseMessages((await rpc.request<{ messages: unknown }>({ type: "get_messages" })).messages).length, 2);
		await rpc.request({ type: "switch_session", sessionPath: original });
		assert.equal(parseMessages((await rpc.request<{ messages: unknown }>({ type: "get_messages" })).messages).length, 3);
		await assert.rejects(forkTurn(rpc, messages.map((m, i) => i === 2 ? { ...m, blocks: [{ kind: "text", text: "changed" }] } : m), messages[2].id), /历史已变化/);
	} finally { await rpc.stop(); }
});

test("fork selection follows the active branch and handles compacted earlier history", () => {
	const entries = [
		{ id: "old", parentId: null, type: "message", message: { role: "user", content: "old" } },
		{ id: "active", parentId: "old", type: "message", message: { role: "user", content: "repeat" } },
		{ id: "abandoned", parentId: "old", type: "message", message: { role: "user", content: "repeat" } },
	];
	const messages = parseMessages([{ role: "user", content: "repeat" }]);
	assert.equal(forkEntry(messages, messages[0].id, entries, "active"), "active");
});
