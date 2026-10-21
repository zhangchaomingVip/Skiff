import test from "node:test";
import assert from "node:assert/strict";
import { parseMessages } from "../src/chat/parse.ts";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { forkEntry, forkTurn, groupTurns, turnContentTails, turnReplyText, turnDraft, userForTurn } from "../src/chat/turns.ts";
import { readTextFiles, appendTextFiles, splitAttachments } from "../src/chat/textAttachments.ts";
import { highlightCode } from "../src/chat/highlight.ts";
import { completedAtTooltip, formatCompletedAt, formatDuration } from "../src/chat/usage.ts";
import { DEFAULT_APPEND_PROMPT, loadAppendPrompt, saveAppendPrompt } from "../src/chat/prompt.ts";
import { isNotableThinking, shouldShowThinking } from "../src/chat/thinking.ts";
import { toolActionSummaries, toolCallSummary, toolKind, toolKindLabel, toolRunSummary, toolTarget, type ToolRunItem } from "../src/chat/toolRuns.ts";
import { PiRpc } from "../src/rpc/RpcClient.ts";
import { installMockPi } from "./mockPi.mjs";

test("turn copy includes every reply step once and excludes prompts, reasoning and tool output", () => {
	const messages = parseMessages([
		{ role: "user", content: "检查项目" },
		{ role: "assistant", content: [{ type: "thinking", thinking: "内部推理" }, { type: "text", text: "先读取文件。" }, { type: "toolCall", id: "read", name: "read", arguments: { path: "README.md" } }] },
		{ role: "toolResult", toolCallId: "read", toolName: "read", content: "工具输出" },
		{ role: "assistant", content: "" },
		{ role: "assistant", content: [{ type: "text", text: "检查完成。" }, { type: "text", text: "**结论**：正常。" }] },
	]);
	assert.equal(turnReplyText(messages), "先读取文件。\n\n检查完成。\n\n**结论**：正常。");
	assert.equal(turnReplyText([]), "");
});

test("turn footers stay on content when pi adds empty usage receipts", () => {
	const messages = parseMessages([
		{ role: "user", content: "检查间距" },
		{ role: "assistant", content: [{ type: "toolCall", id: "read", name: "read", arguments: { path: "README.md" } }] },
		{ role: "assistant", content: "" },
		{ role: "assistant", content: "完成" },
		{ role: "assistant", content: "  ", usage: { input: 123, output: 45, totalTokens: 168 } },
		{ role: "user", content: "继续" },
		{ role: "assistant", content: [{ type: "toolCall", id: "next", name: "read", arguments: { path: "src/App.tsx" } }] },
		{ role: "assistant", content: "" },
	]);
	const turns = groupTurns(messages);
	const tails = turnContentTails(messages, turns);
	assert.equal(tails.get(turns[0].turnId), 3);
	assert.equal(tails.get(turns[5].turnId), 6);
	assert.equal(messages[4].usage?.input, 123);
	assert.equal(tails.size, 2);
});

test("an empty assistant-only turn keeps an anchor for its receipt and actions", () => {
	const messages = parseMessages([{ role: "assistant", content: "", usage: { input: 1, output: 0, totalTokens: 1 } }]);
	const turns = groupTurns(messages);
	assert.equal(turnContentTails(messages, turns).get(turns[0].turnId), 0);
});

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

test("tool runs separate mixed actions and label each count with its unit", () => {
	const tool = (id: string, name: string, args: Record<string, unknown>): ToolRunItem["block"] => ({ kind: "tool", id, name, argsText: JSON.stringify(args), done: true });
	const ok = (name: string): ToolRunItem["result"] => ({ kind: "toolResult", name, text: "ok", isError: false });
	const read: ToolRunItem[] = [
		{ key: 0, block: tool("a", "read", { path: "src/App.tsx" }), result: ok("read") },
		{ key: 1, block: tool("b", "bash", { command: "npm run build" }), result: ok("bash") },
	];
	const finished = toolRunSummary(read);
	assert.equal(finished.kind, "other");
	assert.equal(finished.label, "read + bash · 读取了 1 个文件；执行了 1 条命令");
	assert.equal(finished.running, false);
	assert.equal(finished.steps, 2);
	const live = toolRunSummary([...read, { key: 2, block: tool("c", "edit", {}), result: undefined }]);
	assert.equal(live.kind, "other");
	assert.equal(toolRunSummary([{ key: 0, block: tool("cmd", "bash", { command: "pwd" }) }, { key: 1, block: tool("web", "web_search", { query: "docs" }) }]).kind, "other");
	assert.equal(live.label, "read + bash + edit · 读取了 1 个文件；编辑 1 个文件；执行了 1 条命令");
	assert.equal(live.running, true);
	assert.equal(toolKind("MULTI_EDIT"), "write");
	assert.equal(toolKindLabel("unknown-tool"), "unknown-tool");
	assert.equal(toolTarget(tool("d", "read", { path: "src/chat/parse.ts" })), "src/chat/parse.ts");
});

test("file totals count calls even for repeated paths, missing arguments and multi-file tools", () => {
	const call = (key: number, name: string, argsText: string, isError = false): ToolRunItem => ({ key, block: { kind: "tool", id: String(key), name, argsText, done: true }, result: { kind: "toolResult", name, text: "done", isError } });
	assert.equal(toolRunSummary([call(0, "bash", "{}"), call(1, "bash", "{}"), call(2, "bash", "{}")]).label, "bash · 执行了 3 条命令");
	assert.equal(toolRunSummary([call(0, "write", '{"path":"src/App.tsx"}'), call(1, "edit", '{"path":"src/App.tsx"}')]).label, "write + edit · 编辑了 2 个文件");
	assert.equal(toolRunSummary([call(0, "read", '{"path":"a.txt"}'), call(1, "read", '{"path":"a.txt"}')]).label, "read · 读取了 2 个文件");
	assert.equal(toolRunSummary([call(0, "write", '{"path":"a.txt"}'), call(1, "edit", '{"file_path":"b.txt"}')]).label, "write + edit · 编辑了 2 个文件");
	assert.equal(toolRunSummary([call(0, "write", '{"path":"a.txt"}')]).label, "write · 编辑了 1 个文件");
	assert.equal(toolRunSummary([call(0, "apply_patch", '{"path":"a.txt"}')]).label, "apply_patch · 编辑了 1 个文件");
	for (const args of ["{", "null", "{}", '{"path":42}']) {
		assert.equal(toolRunSummary([call(0, "edit", args)]).label, "edit · 编辑了 1 个文件");
		assert.equal(toolTarget(call(0, "edit", args).block), undefined);
	}
	const failed = toolRunSummary([call(0, "edit", '{"path":"a.txt"}', true)]);
	assert.equal(failed.label, "edit · 编辑了 1 个文件（1 失败）");
	assert.equal(failed.error, true);
	assert.equal(toolRunSummary([call(0, "custom", "{}")]).label, "custom · 调用了 1 次工具");
});

test("tool failures stay next to their action using the same units as the action total", () => {
	const call = (key: number, name: string, path: string, isError?: boolean): ToolRunItem => ({ key, block: { kind: "tool", id: String(key), name, argsText: JSON.stringify({ path }), done: true }, result: isError === undefined ? undefined : { kind: "toolResult", name, text: "done", isError } });
	const items = [call(0, "read", "a.md", false), call(1, "read", "b.md", true), call(2, "search", "", false), call(3, "bash", "", true), call(4, "custom", "", false)];
	assert.deepEqual(toolActionSummaries(items), ["读取了 2 个文件（1 失败）", "执行了 2 条命令（1 失败）", "调用了 1 次工具"]);
	assert.deepEqual(toolActionSummaries([call(0, "read", "a.md", true), call(1, "read", "a.md", true)]), ["读取了 2 个文件（2 失败）"]);
	assert.deepEqual(toolActionSummaries([call(0, "read", "a.md", true), call(1, "read", "b.md")]), ["读取 2 个文件（1 失败）"]);
	assert.deepEqual(toolActionSummaries([]), []);
});

test("discovery and directory tools join commands while expanded details preserve the underlying action", () => {
	const call = (key: number, name: string, args: Record<string, unknown>, isError = false): ToolRunItem => ({ key, block: { kind: "tool", id: String(key), name, argsText: JSON.stringify(args), done: true }, result: { kind: "toolResult", name, text: "skills/demo/SKILL.md\nskills/other/SKILL.md", isError } });
	const glob = call(0, "glob", { pattern: "**/SKILL.md", path: "." });
	assert.equal(toolRunSummary([glob]).label, "glob · 执行了 1 条命令");
	assert.equal(toolRunSummary([glob]).kind, "command");
	assert.equal(toolCallSummary(glob).label, "glob · 查找了 1 次文件");
	assert.equal(toolTarget(glob.block), "**/SKILL.md");
	assert.equal(toolKind("GLOB"), "find");
	assert.equal(toolKindLabel("find"), "查找文件");
	for (const name of ["ls", "list", "tree"]) {
		assert.equal(toolKind(name), "list");
		assert.equal(toolRunSummary([call(0, name, { path: "skills" })]).label, `${name} · 执行了 1 条命令`);
		assert.equal(toolCallSummary(call(0, name, { path: "skills" })).label, `${name} · 列举了 1 次目录`);
	}
	assert.deepEqual(toolActionSummaries([glob, call(1, "find", { pattern: "*.ts" }, true), call(2, "ls", { path: "." }), call(3, "read", { path: "skills/demo/SKILL.md" }), call(4, "edit", { path: "src/App.tsx" }), call(5, "grep", { pattern: "Settings", path: "src" }), call(6, "bash", { command: "pwd" })]), ["读取了 1 个文件", "编辑了 1 个文件", "执行了 5 条命令（1 失败）"]);
	assert.equal(toolRunSummary([{ ...glob, result: undefined }]).label, "glob · 执行 1 条命令");
	assert.equal(toolTarget(call(0, "grep", { pattern: "Settings", path: "src" }).block), "Settings");
});

test("summary action order stays fixed regardless of source order or streamed results", () => {
	const items: ToolRunItem[] = ["web_search", "bash", "edit", "read", "write", "grep"].map((name, key) => ({ key, block: { kind: "tool", id: String(key), name, argsText: "{", done: true } }));
	assert.deepEqual(toolActionSummaries(items), ["读取 1 个文件", "编辑 2 个文件", "执行 2 条命令", "联网搜索 1 次"]);
	const settled = items.map((item) => ({ ...item, result: { kind: "toolResult" as const, name: item.block.name, text: "ok", isError: false } }));
	assert.deepEqual(toolActionSummaries(settled.reverse()), ["读取了 1 个文件", "编辑了 2 个文件", "执行了 2 条命令", "联网搜索了 1 次"]);
});

test("local grep and find count as commands, separately from web searches and their failures", () => {
	const items: ToolRunItem[] = ["grep", "find", "rg", "web_search", "WEB_SEARCH"].map((name, key) => ({ key, block: { kind: "tool", id: String(key), name, argsText: '{"pattern":"TODO","path":"src"}', done: true }, result: { kind: "toolResult", name, text: "ok", isError: key === 0 || key === 3 } }));
	assert.deepEqual(toolActionSummaries(items), ["执行了 3 条命令（1 失败）", "联网搜索了 2 次（1 失败）"]);
	assert.equal(toolCallSummary(items[0]).label, "grep · 搜索了 1 次（1 失败）");
	assert.equal(toolRunSummary([items[0]]).kind, "command");
	assert.equal(toolKindLabel("web_search"), "联网搜索");
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

test("the append prompt defaults to empty and keeps an explicit clear across reloads", () => {
	const store = new Map<string, string>();
	const previous = (globalThis as { localStorage?: unknown }).localStorage;
	(globalThis as { localStorage?: unknown }).localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
	try {
		assert.equal(DEFAULT_APPEND_PROMPT, "");
		assert.equal(loadAppendPrompt(), DEFAULT_APPEND_PROMPT);
		saveAppendPrompt("自定义旁白指令");
		assert.equal(loadAppendPrompt(), "自定义旁白指令");
		saveAppendPrompt("");
		assert.equal(store.get("skiff.prompt.append"), "");
		assert.equal(loadAppendPrompt(), "");
		saveAppendPrompt("  \n\t");
		assert.equal(store.get("skiff.prompt.append"), "");
		assert.equal(loadAppendPrompt(), "");
		saveAppendPrompt("  自定义多行指令\n第二行  ");
		assert.equal(loadAppendPrompt(), "  自定义多行指令\n第二行  ");
	} finally {
		(globalThis as { localStorage?: unknown }).localStorage = previous;
	}
});

test("turn header shows duration + steps and the footer shows the completion clock", () => {
	const infos = groupTurns(parseMessages([
		{ role: "user", content: "go", timestamp: 1_700_000_000_000 },
		{ role: "assistant", content: [{ type: "thinking", thinking: "a" }], timestamp: 1_700_000_046_000 },
	]));
	assert.equal(infos[1].stepCount, 1);
	assert.equal(infos[1].durationMs, 46000);
	assert.equal(formatDuration(infos[1].durationMs!), "46s");
	assert.equal(formatCompletedAt(new Date(2026, 9, 2, 23, 15).getTime()), "23:15");
	assert.equal(completedAtTooltip(new Date(2026, 9, 13, 12, 31).getTime()), "2026-10-13 周二 12:31");
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
