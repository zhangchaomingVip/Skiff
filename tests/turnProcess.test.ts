import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage, ContentBlock, SessionState } from "../src/chat/types.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { parseMessages } from "../src/chat/parse.ts";
import { reduce } from "../src/chat/reducer.ts";
import { aggregateTurnProcess, turnDurationLabel, turnProcessPresentation, processBlocks, processCountLabel, type ProcessCounts } from "../src/chat/turnProcess.ts";
import { latestThinkingLabel, processStepLabel } from "../src/chat/processStepLabel.ts";
import { processStatus } from "../src/chat/processStatus.ts";

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
	assert.equal(processCountLabel(groups[0], true), "");
});

test("thinking size and steps update during streaming, completion counts at a following block", () => {
	const messages = [user, assistant("a", [thought("推理".repeat(600))], true)];
	const first = turnProcessPresentation(messages, live).groups[0];
	assert.deepEqual(first.counts, { thinkingSegments: 0, thinkingChars: 1200, steps: 1 });
	assert.match(processCountLabel(first, true), /正在思考/);
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
	assert.match(processCountLabel(group), /执行 2 条命令 · 读取 1 个文件/);
	assert.equal(group.pending, false);
});

test("all alternating process steps before the first reply collapse across message boundaries", () => {
	const messages = [user, ...Array.from({ length: 30 }, (_, index) => assistant(`a${index}`, [thought(), call(`${index}`), result(`${index}`)])), assistant("reply", [text("有效回答")])];
	const before = structuredClone(messages);
	const { groups, presentation } = turnProcessPresentation(messages);
	assert.equal(groups.length, 1);
	assert.deepEqual(groups[0].counts, { thinkingSegments: 30, thinkingChars: 60, steps: 60 });
	assert.match(processCountLabel(groups[0]), /执行 30 条命令/);
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

test("reply interruptions keep every text visible while labeling following tool groups", () => {
	const message = assistant("a", [thought("开头"), text("第一段"), thought("中间"), call("one"), result("one"), text("第二段"), call("two"), result("two"), text("结论")]);
	const { presentation, groups } = turnProcessPresentation([user, message]);
	assert.deepEqual(groups.map((group) => group.placement), ["head", "inline", "inline"]);
	assert.equal(groups[0].counts.thinkingChars, 2);
	assert.equal(presentation.get("a")!.groups.get(2), groups[1]);
	assert.equal(presentation.get("a")!.groups.get(6), groups[2]);
	assert.equal(processCountLabel(groups[1]), "执行 1 条命令");
	assert.deepEqual(groups[2].narrationTexts, ["第二段"]);
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
	assert.match(processCountLabel(groups[0]), /执行 1 条命令（1 失败）/);
	assert.match(processCountLabel(groups[1]), /执行 1 条命令/);
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
	assert.match(processCountLabel(groups[0]), /执行 2 条命令/);
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
	const { groups } = turnProcessPresentation([user, assistant("a", [thought("分析一下"), text("正文"), thought("继续"), { kind: "tool", id: "read", name: "read", argsText: '{"path":"skills/README.md"}', done: true }, result("read"), text("回答")])]);
	assert.equal(processCountLabel(groups[0]), "查看思考过程");
	assert.equal(processCountLabel(groups[1]), "读取 1 个文件");
});

test("mixed actions and failures aggregate across messages without branding successful actions failed", () => {
	const read = (id: string, path: string): ContentBlock => ({ kind: "tool", id, name: "read", argsText: JSON.stringify({ path }), done: true });
	const { groups } = turnProcessPresentation([user,
		assistant("a", [read("a", "a.md"), result("a"), read("b", "b.md"), result("b", true)]),
		assistant("b", [call("s", "search"), result("s"), call("c"), result("c"), text("完成")]),
	]);
	assert.equal(processCountLabel(groups[0]), "调用 4 次工具");
});

test("reasoning omits counts and yields to tools in compact summaries", () => {
	const { groups } = turnProcessPresentation([user, assistant("a", [
		thought("分析".repeat(14)), text("正文"), thought("分析".repeat(14)),
		call("read", "read"), result("read"), call("edit", "edit"), result("edit"),
		call("web", "web_search"), result("web"), text("结论"),
	])]);
	assert.equal(processCountLabel(groups[0]), "查看思考过程");
	assert.equal(processCountLabel(groups[1]), "调用 3 次工具");
	assert.doesNotMatch(processCountLabel(groups[1]), /思考过程|段思考/);
	const liveGroup = turnProcessPresentation([user, assistant("a", [thought("分析".repeat(600))], true)], live).groups[0];
	assert.equal(processCountLabel(liveGroup, true), "正在思考…");
});

test("orphan failures remain visible in collapsed process summaries", () => {
	const { groups } = turnProcessPresentation([user, assistant("a", [text("正文"), { kind: "toolResult", id: "orphan", name: "read", text: "无法读取", isError: true }])]);
	assert.equal(processCountLabel(groups[1]), "读取 1 个文件（1 失败）");
});

test("file discovery preserves its own category without inflating file-read totals", () => {
	const { groups } = turnProcessPresentation([user, assistant("a", [
		text("先查找技能说明文件。"),
		{ kind: "tool", id: "glob", name: "glob", argsText: '{"pattern":"**/SKILL.md"}', done: true },
		{ kind: "toolResult", id: "glob", name: "glob", text: "skills/demo/SKILL.md\nskills/other/SKILL.md", isError: false },
		text("找到了说明文件。"),
	])]);
	assert.equal(processCountLabel(groups[0]), "查找 1 个文件");
});

test("tool-adjacent narration stays in the reply without also labeling its process group", () => {
	const messages = [user,
		assistant("a", [thought("先检查项目中的配置和测试入口，明确后续修改范围。"), text("读取配置文件和现有测试，确认设置入口的行为。")]),
		assistant("b", [call("read", "read"), result("read"), text("第一段正文说明。"), text("再次核对错误分支和现有提示文案。"), call("test"), result("test"), text("最终给用户的完整回答。")]),
	];
	const before = structuredClone(messages);
	const { presentation, groups } = turnProcessPresentation(messages);
	assert.deepEqual(groups.map((group) => group.placement), ["head", "inline", "inline"]);
	assert.deepEqual(groups.map((group) => group.entries.map((entry) => entry.block.kind)), [["thinking"], ["tool"], ["tool"]]);
	assert.equal(processStepLabel(groups[1]), undefined);
	assert.equal(processStepLabel(groups[2]), undefined);
	assert.equal(processStepLabel(groups[0]), "先检查项目中的配置和测试入口，明确后续修改范围。");
	assert.match(processStatus(groups[1], false).label, /读取了 1 个文件/);
	assert.equal(presentation.get("a")!.hidden.has(1), false);
	assert.equal(presentation.get("b")!.hidden.has(2), false);
	assert.equal(presentation.get("b")!.hidden.has(3), false);
	assert.equal(presentation.get("b")!.hidden.has(6), false);
	assert.deepEqual(messages, before);
});

test("streaming text becomes narration only after its following tool call arrives", () => {
	const unfinished = [user, assistant("a", [text("检查配置文件并确认当前模型的连接方式。")], true)];
	assert.equal(turnProcessPresentation(unfinished, live).groups[0].entries.length, 0);
	const completed = [user, assistant("a", [...unfinished[1].blocks, call("read", "read")], true)];
	const { groups, presentation } = turnProcessPresentation(completed, live);
	assert.deepEqual(groups[0].entries.map((entry) => entry.block.kind), ["tool"]);
	assert.equal(presentation.get("a")!.hidden.has(0), false);
	assert.equal(processStatus(groups[0], true).label, "正在读取文件");
});

test("an intervening raw result prevents a false narration match", () => {
	const blocks = [text("这是正文，后面还有一个孤立的工具结果。"), { kind: "toolResult", id: "orphan", name: "read", text: "旧结果", isError: false } as ContentBlock, call("next")];
	const { groups, presentation } = turnProcessPresentation([user, assistant("a", blocks)]);
	assert.equal(presentation.get("a")!.hidden.has(0), false);
	assert.equal(groups[0].entries.length, 0);
});

test("short, meta and code-heavy narration falls through to thinking and mechanical counts", () => {
	const thoughtText = "先核对配置加载与失败回退的实际路径，随后修正相应逻辑。\n\n更多推理细节。";
	const withThinking = turnProcessPresentation([user, assistant("a", [thought(thoughtText), text("好的，我来处理这个问题。"), call("one")])]).groups[0];
	assert.equal(processStepLabel(withThinking), thoughtText.replace(/\s+/g, " "));
	const mechanical = turnProcessPresentation([user, assistant("a", [thought("分析"), text("src/chat/reducer.ts /foo/bar baz/qux"), call("one")])]).groups[1];
	assert.equal(processStepLabel(mechanical), undefined);
	assert.equal(processStatus(mechanical, false).label, `${processCountLabel(mechanical, false, true, true)} · 未收到工具结果`);
	const englishMeta = turnProcessPresentation([user, assistant("a", [text("Let me think about the next step."), call("one")])]).groups[0];
	assert.equal(processStepLabel(englishMeta), undefined);
});

test("long thinking stays available while tools take priority in summaries", () => {
	const reasoning = "先核对模型配置与请求参数，确认不同协议的映射行为。然后检查历史消息恢复和实时事件的顺序，定位可能丢失旁白的环节。";
	const group = turnProcessPresentation([user, assistant("a", [thought(reasoning), call("read", "read"), result("read")])]).groups[0];
	assert.equal(processStepLabel(group), reasoning);
	assert.match(processStatus(group, false).label, /读取了 1 个文件/);
	assert.equal(group.counts.steps, 2);
});

test("model labels join cleaned prose lines and reject bare section headings", () => {
	const source = "### 3. write （创建文件）**核对 `settings.json` 的读取方式**，并检查回退规则。\n第二行的正文也进入摘要。";
	const messages = [user, assistant("a", [thought(source), call("one")], true)];
	const before = structuredClone(messages);
	const group = turnProcessPresentation(messages, live).groups[0];
	const label = processStepLabel(group)!;
	assert.equal(label, "核对 settings.json 的读取方式，并检查回退规则。 第二行的正文也进入摘要。");
	assert.doesNotMatch(label, /[#*`]|3\. write|\n/);
	assert.match(label, /^核对 settings\.json/);
	assert.deepEqual(messages, before);
	for (const heading of ["### 0. bash", "3. write（创建文件）", "## `read`", "嗯，先看看仓库里有哪些测试。", "{\"path\":\"src/config.json\"}", "src/chat/reducer.ts /foo/bar baz/qux", "settings.json", "npm test --coverage"]) {
		const rejected = turnProcessPresentation([user, assistant("a", [thought(heading), call("one")], true)], live).groups[0];
		assert.equal(processStepLabel(rejected), undefined, heading);
		assert.equal(processStatus(rejected, true).label, "正在运行命令");
	}
});

test("multiline thinking includes list content after its introduction and preserves the original", () => {
	const source = "The user wants me to:\r\n1. Clean up (**demo.txt**)\r\n2. Then build a small project.\r\n\r\nIdeas:\r\n- Generate ASCII art\r\n- Create a small game";
	const messages = [user, assistant("a", [thought(source)], true)];
	const before = structuredClone(messages);
	const group = turnProcessPresentation(messages, live).groups[0];
	assert.equal(processStepLabel(group), "The user wants me to: Clean up (demo.txt) Then build a small project. Ideas: Generate ASCII art Create a small game");
	assert.equal(processStatus(group, true).detailLabel, "正在思考");
	assert.deepEqual(messages, before);
	const partial = turnProcessPresentation([user, assistant("a", [thought("The user wants me to:")], true)], live).groups[0];
	assert.ok(processStepLabel(group)!.startsWith(processStepLabel(partial)!));
	const shortIntro = turnProcessPresentation([user, assistant("b", [thought("计划：\n1. 核对配置并检查测试结果。")], true)], live).groups[0];
	assert.equal(processStepLabel(shortIntro), "计划： 核对配置并检查测试结果。");
});

test("multiline previews omit fenced code and raw command lines", () => {
	const source = ["接下来核对项目配置，确认需要调整的内容。", "```ts", "const secret = config.value;", "~~~", "do not display this code", "```", "npm test --coverage", "随后运行测试并核对结果。", "~~~sh", "hidden code", "~~~"].join("\n");
	const group = turnProcessPresentation([user, assistant("a", [thought(source)], true)], live).groups[0];
	assert.equal(processStepLabel(group), "接下来核对项目配置，确认需要调整的内容。 随后运行测试并核对结果。");
});

test("reasoning_content variants normalize into ordered thinking steps in history and live completion", () => {
	const raw = { role: "assistant", reasoning_content: "先检查请求顺序，再定位工具调用的归属。", content: [{ type: "text", text: "读取配置文件并核对协议设置。", reasoning_content: "先检查请求顺序，再定位工具调用的归属。" }, { type: "toolCall", id: "one", name: "read" }, { type: "text", text: "完成回答" }] };
	const restored = parseMessages([{ role: "user", content: "检查" }, raw]);
	assert.deepEqual(restored[1].blocks.map((block) => block.kind), ["thinking", "text", "tool", "text"]);
	const restoredGroups = turnProcessPresentation(restored).groups;
	assert.equal(processStepLabel(restoredGroups[0]), "先检查请求顺序，再定位工具调用的归属。");
	assert.equal(processStepLabel(restoredGroups[1]), undefined);
	let state: SessionState = { ...initialSessionState, messages: [user] };
	state = reduce(state, { type: "message_end", message: { role: "assistant", reasoning_content: "先检查请求顺序，再定位工具调用的归属。", content: [{ type: "toolCall", id: "two", name: "read" }] } });
	assert.deepEqual(state.messages[1].blocks.map((block) => block.kind), ["thinking", "tool"]);
	assert.deepEqual(parseMessages([{ role: "assistant", content: [{ type: "reasoning_content", reasoning_content: "先检查配置与请求参数。" }, { type: "text", text: "完成回答" }] }])[0].blocks.map((block) => block.kind), ["thinking", "text"]);
});


test("one stable aggregate collects ordered narration and leaves only post-tool reply outside", () => {
	const messages = [user, assistant("a", [thought("先检查配置与现有行为。"), text("中间正文"), call("one"), result("one"), text("步骤二"), thought("随后检查测试与清理路径。"), call("two"), result("two", true), text("最终回答")])];
	const { groups, presentation } = aggregateTurnProcess(messages);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].id, "turn:user:head");
	assert.deepEqual(groups[0].entries.map((entry) => entry.block.kind), ["thinking", "text", "tool", "text", "thinking", "tool"]);
	assert.equal(groups[0].error, true);
	assert.equal(groups[0].activeKind, "text");
	assert.equal(presentation.get("a")!.groups.size, 0);
	for (const index of [1, 4]) assert.equal(presentation.get("a")!.hidden.has(index), true);
	assert.equal(presentation.get("a")!.hidden.has(8), false);
	const liveGroup = aggregateTurnProcess(messages.slice(0, 2), { running: true }).groups[0];
	assert.equal(liveGroup.id, groups[0].id);
	assert.equal(liveGroup.closed, false);
});

test("duration labels prefer measured runtime and mark historical estimates without guessing missing data", () => {
	const prompt = { ...user, timestamp: 1000 };
	const reply = { ...assistant("a", [text("回答")]), timestamp: 91000, durationMs: 12500 };
	assert.equal(turnDurationLabel([prompt, reply]), "用时 13 秒");
	assert.equal(turnDurationLabel([prompt, { ...reply, durationMs: undefined }]), "用时约 90 秒");
	assert.equal(turnDurationLabel([user, assistant("a", [])]), "用时未记录");
	assert.equal(turnDurationLabel([prompt, { ...reply, durationMs: undefined, timestamp: 0 }]), "用时未记录");
});

test("latest thinking previews never reuse the first block or leak code and tool arguments", () => {
	const group = aggregateTurnProcess([user, assistant("a", [thought("先检查模型配置和现有设置入口。"), thought("随后核对草稿恢复与保存失败分支。")])]).groups[0];
	assert.equal(latestThinkingLabel(group), "随后核对草稿恢复与保存失败分支。");
	const latest = group.entries[group.entries.length - 1];
	for (const raw of ['{"path":"secret/config.json"}', "```ts\nconst token = secret;\n```", "npm test --token secret", "src/chat/reducer.ts /foo/bar baz/qux"]) {
		assert.equal(latestThinkingLabel({ entries: [group.entries[0], { ...latest, block: { kind: "thinking", text: raw } }] }), undefined);
	}
	assert.equal(latestThinkingLabel({ entries: [...group.entries, { ...latest, block: call("one") }] }), undefined);
});


test("appending prose inside one thinking block moves the live preview to its latest meaningful fragment", () => {
	const first = "先检查配置文件和历史消息的保存方式。";
	const last = "随后核对错误分支并验证计时器清理。";
	for (const separator of ["\n\n", ""]) {
		const group = aggregateTurnProcess([user, assistant("a", [thought(first + separator + last)])]).groups[0];
		assert.equal(latestThinkingLabel(group), last);
	}
});


test("aggregate narration crosses messages and thinking but never user turns or usage-only tails", () => {
	const messages = [user, assistant("a", [text("one"), text("two"), thought("reason")]), assistant("b", [text("three"), call("one"), result("one"), text("answer"), text("answer two")]), assistant("usage", []), { ...user, id: "next" }, assistant("next-a", [text("next narration"), call("next")])];
	const { groups, presentation } = aggregateTurnProcess(messages);
	assert.deepEqual(groups[0].entries.map((entry) => entry.block.kind), ["text", "text", "thinking", "text", "tool"]);
	assert.equal(presentation.get("a")!.hidden.has(0), true);
	assert.equal(presentation.get("b")!.hidden.has(3), false);
	assert.equal(presentation.get("b")!.hidden.has(4), false);
	assert.equal(groups[1].entries[0].messageId, "next-a");
	const plain = aggregateTurnProcess([user, assistant("a", [text("one"), text("two")]), assistant("b", [text("three")]), assistant("usage", [])]);
	assert.equal(plain.groups[0].entries.length, 0);
	assert.equal(plain.presentation.get("a")!.hidden.size, 0);
	const liveText = [user, assistant("a", [text("visible until evidence")], true)];
	assert.equal(aggregateTurnProcess(liveText, live).presentation.get("a")!.hidden.size, 0);
	const migrated = aggregateTurnProcess([user, assistant("a", [text("visible until evidence"), thought("reason"), call("missing")], true)], live);
	assert.equal(migrated.groups[0].id, aggregateTurnProcess(liveText, live).groups[0].id);
	assert.equal(migrated.groups[0].pending, true);
	assert.deepEqual(migrated.groups[0].entries.map((entry) => entry.block.kind), ["text", "thinking", "tool"]);
});
