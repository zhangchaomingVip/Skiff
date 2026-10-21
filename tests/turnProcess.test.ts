import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ContentBlock, SessionState } from "../src/chat/types.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { parseMessages } from "../src/chat/parse.ts";
import { reduce } from "../src/chat/reducer.ts";
import { turnProcessPresentation, processBlocks, processCountLabel, type ProcessCounts } from "../src/chat/turnProcess.ts";

const user: ChatMessage = { id: "user", role: "user", blocks: [{ kind: "text", text: "检查项目" }] };
const thought = (text = "分析"): ContentBlock => ({ kind: "thinking", text });
const text = (text: string): ContentBlock => ({ kind: "text", text });
const call = (id: string, name = "bash"): ContentBlock => ({ kind: "tool", id, name, argsText: "{}", done: true });
const result = (id: string, isError = false): ContentBlock => ({ kind: "toolResult", id, name: "bash", text: `输出 ${id}`, isError });
const assistant = (id: string, blocks: ContentBlock[], streaming = false): ChatMessage => ({ id, role: "assistant", blocks, streaming });
const live = { running: true, activeTurnId: "turn:user" };

test("an empty live assistant exposes a single zero-count prelude before any token", () => {
	const { presentation, groups } = turnProcessPresentation([user, assistant("a", [], true)], live);
	assert.equal(groups.length, 1);
	assert.equal(presentation.get("a")!.head, groups[0]);
	assert.equal(groups[0].closed, false);
	assert.equal(processCountLabel(groups[0], true), "思考中 · 步骤 0");
});

test("thinking size and steps update during streaming, completion counts at a following block", () => {
	const messages = [user, assistant("a", [thought("推理".repeat(600))], true)];
	const first = turnProcessPresentation(messages, live).groups[0];
	assert.deepEqual(first.counts, { thinkingSegments: 0, thinkingChars: 1200, steps: 1 });
	assert.match(processCountLabel(first, true), /1,200 字/);
	messages[1] = assistant("a", [thought("推理".repeat(600)), call("one")], true);
	assert.equal(turnProcessPresentation(messages, live).groups[0].counts.thinkingSegments, 1);
	assert.equal(turnProcessPresentation(messages, live).groups[0].counts.steps, 2);
});

test("tool actions expose pending calls live and include non-command categories", () => {
	const blocks = [thought(), call("one"), call("two"), result("two")];
	let group = turnProcessPresentation([user, assistant("a", blocks)], live).groups[0];
	assert.match(processCountLabel(group), /执行 2 条命令/);
	assert.equal(group.pending, true);
	group = turnProcessPresentation([user, assistant("a", [...blocks, result("one"), call("read", "read"), result("read")])], live).groups[0];
	assert.deepEqual(group.counts, { thinkingSegments: 1, thinkingChars: 2, steps: 4 });
	assert.match(processCountLabel(group), /读取了 1 个文件 · 执行了 2 条命令/);
	assert.equal(group.pending, false);
});

test("all alternating process steps before the first reply collapse across message boundaries", () => {
	const messages = [user, ...Array.from({ length: 30 }, (_, index) => assistant(`a${index}`, [thought(), call(`${index}`), result(`${index}`)])), assistant("reply", [text("有效回答")])];
	const before = structuredClone(messages);
	const { groups, presentation } = turnProcessPresentation(messages);
	assert.equal(groups.length, 1);
	assert.deepEqual(groups[0].counts, { thinkingSegments: 30, thinkingChars: 60, steps: 60 });
	assert.match(processCountLabel(groups[0]), /执行了 30 条命令/);
	assert.equal(presentation.get("a0")!.head, groups[0]);
	assert.equal(presentation.get("a1")!.head, undefined);
	assert.deepEqual([...presentation.get("a29")!.hidden], [0, 1]);
	assert.equal(presentation.has("reply"), false);
	assert.deepEqual(messages, before);
});

test("text_start does not freeze the header; the first text token does, including whitespace", () => {
	const empty = [user, assistant("a", [thought(), text("")], true)];
	assert.equal(turnProcessPresentation(empty, live).groups[0].closed, false);
	for (const token of ["答", "\n"]) {
		const group = turnProcessPresentation([user, assistant("a", [thought(), text(token)], true)], live).groups[0];
		assert.equal(group.closed, true);
		assert.equal(group.counts.thinkingSegments, 1);
	}
});

test("reply interruptions get separate inline groups anchored between text blocks", () => {
	const message = assistant("a", [thought("开头"), text("第一段"), thought("中间"), call("one"), result("one"), text("第二段"), call("two"), result("two"), text("结论")]);
	const { presentation, groups } = turnProcessPresentation([user, message]);
	assert.deepEqual(groups.map((group) => group.placement), ["head", "inline", "inline"]);
	assert.equal(groups[0].counts.thinkingChars, 2);
	assert.equal(presentation.get("a")!.groups.get(2), groups[1]);
	assert.equal(presentation.get("a")!.groups.get(6), groups[2]);
	assert.equal(processCountLabel(groups[1]), "思考了 1 段（2 字） · 执行了 1 条命令");
	for (const key of [1, 5, 8]) assert.equal(presentation.get("a")!.hidden.has(key), false);
});

test("frozen counters survive later result updates while status and process details stay live", () => {
	const messages = [user, assistant("a", [thought(), call("one"), text("第一段")], true)];
	const initial = turnProcessPresentation(messages, live).groups[0];
	const frozenCounts = new Map<string, ProcessCounts>([[initial.id, initial.counts]]);
	const next = [user, assistant("a", [...messages[1].blocks, result("one", true)], true), assistant("b", [thought("新思考"), call("two"), result("two"), text("后续正文")])];
	const { groups } = turnProcessPresentation(next, { ...live, frozenCounts });
	assert.deepEqual(groups[0].counts, initial.counts);
	assert.equal(groups[0].pending, false);
	assert.equal(groups[0].error, true);
	assert.equal(groups[0].entries[1].result?.text, "输出 one");
	assert.match(processCountLabel(groups[0]), /执行了 1 条命令（1 失败）/);
	assert.match(processCountLabel(groups[1]), /执行了 1 条命令/);
});

test("a group ID stays stable through streamed arguments, completions and further messages", () => {
	const first = [user, assistant("a", [thought(), call("one")], true)];
	const original = turnProcessPresentation(first, live).groups[0];
	const next = [user, assistant("a", [thought("更长"), call("one"), result("one"), text("正文")]), assistant("b", [thought(), call("two")], true)];
	const groups = turnProcessPresentation(next, live).groups;
	assert.equal(groups[0].id, original.id);
	assert.notEqual(groups[0].id, groups[1].id);
	assert.equal(groups[1].closed, false);
});

test("new user turns and assistant images preserve boundaries; orphan results remain inspectable", () => {
	const image: ContentBlock = { kind: "image", data: "image", mimeType: "image/png" };
	const { groups, presentation } = turnProcessPresentation([user, assistant("a", [thought(), image, result("orphan", true), text("结论")]), { ...user, id: "next" }, assistant("b", [call("two")])]);
	assert.deepEqual(groups.map((group) => group.placement), ["head", "inline", "head"]);
	assert.equal(groups[1].error, true);
	assert.equal(groups[1].entries[0].block.kind, "toolResult");
	assert.equal(presentation.get("a")!.hidden.has(1), false);
	assert.notEqual(groups[0].turnId, groups[2].turnId);
});

test("restored results pair out of order and empty usage receipts do not create additional summaries", () => {
	const restored = parseMessages([
		{ role: "user", content: "检查" },
		{ role: "assistant", content: [{ type: "thinking", thinking: "分析" }, { type: "toolCall", id: "one", name: "bash" }, { type: "toolCall", id: "two", name: "bash" }] },
		{ role: "toolResult", toolCallId: "two", name: "bash", content: "第二条输出" },
		{ role: "toolResult", toolCallId: "one", name: "bash", content: "第一条输出" },
		{ role: "assistant", content: "结论" },
		{ role: "assistant", content: "", usage: { input: 100, output: 5 } },
	]);
	const { groups } = turnProcessPresentation(restored);
	assert.equal(groups.length, 1);
	assert.match(processCountLabel(groups[0]), /执行了 2 条命令/);
	assert.equal(processBlocks(restored[1])[1].result?.text, "第一条输出");
});

test("real reducer events expose live counts without changing the session schema", () => {
	let state: SessionState = { ...initialSessionState, messages: [user], isStreaming: true };
	const send = (event: Parameters<typeof reduce>[1]) => { state = reduce(state, event); };
	const delta = (type: string, contentIndex: number, extra = {}) => send({ type: "message_update", assistantMessageEvent: { type, contentIndex, ...extra } });
	send({ type: "message_start", message: { role: "assistant" } });
	delta("thinking_start", 0); delta("thinking_delta", 0, { delta: "实时思考" });
	assert.equal(turnProcessPresentation(state.messages, live).groups[0].counts.thinkingChars, 4);
	delta("thinking_end", 0); delta("toolcall_start", 1, { id: "tool", toolName: "bash" });
	delta("toolcall_end", 1);
	send({ type: "message_end", message: { role: "toolResult", toolCallId: "tool", name: "bash", content: "ok" } });
	assert.deepEqual(turnProcessPresentation(state.messages, live).groups[0].counts, { thinkingSegments: 1, thinkingChars: 4, steps: 2 });
	delta("text_delta", 2, { delta: "正文" });
	assert.equal(turnProcessPresentation(state.messages, live).groups[0].closed, true);
});

test("optional active IDs and resuming a prelude keep counters live until actual reply content", () => {
	const messages = [user, assistant("a", [thought("开始")], true)];
	assert.equal(turnProcessPresentation(messages, { running: true }).groups[0].closed, false);
	const stopped = turnProcessPresentation(messages).groups[0];
	const frozenCounts = new Map([[stopped.id, stopped.counts]]);
	const resumed = turnProcessPresentation([user, assistant("a", [thought("继续分析")], true)], { ...live, frozenCounts }).groups[0];
	assert.equal(resumed.counts.thinkingChars, 4);
	assert.equal(resumed.closed, false);
});

test("thinking-only groups omit zero tool actions and tool-only groups omit zero thinking", () => {
	const { groups } = turnProcessPresentation([user, assistant("a", [thought("分析一下"), text("正文"), { kind: "tool", id: "read", name: "read", argsText: '{"path":"skills/README.md"}', done: true }, result("read"), text("回答")])]);
	assert.equal(processCountLabel(groups[0]), "思考了 1 段（4 字） · 步骤 1");
	assert.equal(processCountLabel(groups[1]), "读取了 1 个文件");
});

test("mixed actions and failures aggregate across messages without branding successful actions failed", () => {
	const read = (id: string, path: string): ContentBlock => ({ kind: "tool", id, name: "read", argsText: JSON.stringify({ path }), done: true });
	const { groups } = turnProcessPresentation([user,
		assistant("a", [read("a", "a.md"), result("a"), read("b", "b.md"), result("b", true)]),
		assistant("b", [call("s", "search"), result("s"), call("c"), result("c"), text("完成")]),
	]);
	assert.equal(processCountLabel(groups[0]), "读取了 2 个文件（1 失败） · 执行了 2 条命令 · 步骤 4");
});

test("reasoning uses a compact count and size phrase without a redundant process prefix", () => {
	const { groups } = turnProcessPresentation([user, assistant("a", [
		thought("分析".repeat(14)), text("正文"), thought("分析".repeat(14)),
		call("read", "read"), result("read"), call("edit", "edit"), result("edit"),
		call("web", "web_search"), result("web"), text("结论"),
	])]);
	assert.equal(processCountLabel(groups[0]), "思考了 1 段（28 字） · 步骤 1");
	assert.equal(processCountLabel(groups[1]), "思考了 1 段（28 字） · 读取了 1 个文件 · 编辑了 1 个文件 · 联网搜索了 1 次");
	assert.doesNotMatch(processCountLabel(groups[1]), /思考过程|段思考/);
	const liveGroup = turnProcessPresentation([user, assistant("a", [thought("分析".repeat(600))], true)], live).groups[0];
	assert.equal(processCountLabel(liveGroup, true), "思考中（1,200 字） · 步骤 1");
});

test("orphan failures remain visible in collapsed process summaries", () => {
	const { groups } = turnProcessPresentation([user, assistant("a", [text("正文"), { kind: "toolResult", id: "orphan", name: "read", text: "无法读取", isError: true }])]);
	assert.equal(processCountLabel(groups[1]), "读取了 1 个文件（1 失败）");
});

test("file discovery joins commands in process summaries without inflating file-read totals", () => {
	const { groups } = turnProcessPresentation([user, assistant("a", [
		text("先查找技能说明文件。"),
		{ kind: "tool", id: "glob", name: "glob", argsText: '{"pattern":"**/SKILL.md"}', done: true },
		{ kind: "toolResult", id: "glob", name: "glob", text: "skills/demo/SKILL.md\nskills/other/SKILL.md", isError: false },
		text("找到了说明文件。"),
	])]);
	assert.equal(processCountLabel(groups[1]), "执行了 1 条命令");
});
