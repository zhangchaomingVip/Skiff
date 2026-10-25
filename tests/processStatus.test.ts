import test from "node:test";
import assert from "node:assert/strict";
import { advanceProcessClock, processActivity, processElapsedLabel, processStatus, toolActivityLabel } from "../src/chat/processStatus.ts";
import { turnProcessPresentation } from "../src/chat/turnProcess.ts";
import type { ChatMessage, ContentBlock } from "../src/chat/types.ts";

const user: ChatMessage = { id: "user", role: "user", blocks: [] };
const tool = (id: string, name = "read", args = {}): Extract<ContentBlock, { kind: "tool" }> => ({ kind: "tool", id, name, argsText: JSON.stringify(args), done: true });
const result = (id: string, isError = false): ContentBlock => ({ kind: "toolResult", id, name: "read", text: "output", isError });
const groupFor = (blocks: ContentBlock[], running = true) => turnProcessPresentation([user, { id: "assistant", role: "assistant", blocks, streaming: running }], { running }).groups[0];

test("live labels show concrete activity and retain progress between actions", () => {
	const group = groupFor([{ kind: "thinking", text: "分析" }, tool("one"), result("one"), tool("two", "bash", { command: "npm test --token sample-secret" })]);
	assert.equal(processStatus(group, true).label, "正在并行运行 2 个工具（1/2）");
	const thought = groupFor([...group.entries.flatMap((entry) => entry.result ? [entry.block, entry.result] : [entry.block]), result("two"), { kind: "thinking", text: "重试分析" }]);
	assert.equal(processStatus(thought, true).label, "正在思考");
	assert.doesNotMatch(processStatus(thought, true).label, /字|段/);
});

test("visible narration is not repeated in status and still suppresses generic waiting", () => {
	const narration = "目录里有三个文件，接下来检查它们的内容，并核对项目说明和配置文件。";
	const blocks: ContentBlock[] = [{ kind: "text", text: `${narration}\n第二行保留在正文里。` }, tool("one")];
	const working = processStatus(groupFor(blocks), true);
	assert.equal(working.modelLabel, undefined);
	assert.equal(working.detailLabel, "正在读取文件");
	assert.equal(working.label, "正在读取文件");
	const waiting = processStatus(groupFor([...blocks, result("one")]), true);
	assert.equal(waiting.detailLabel, "读取了 1 个文件");
	assert.equal(waiting.label, "读取了 1 个文件");
	assert.equal(waiting.modelLabel, undefined);
	assert.equal(waiting.active, true);
	assert.equal(waiting.visible, true);
	assert.equal(processStatus(groupFor([tool("one"), result("one")]), true).label, "读取了 1 个文件");
	assert.equal(processStatus(groupFor([]), true).label, "正在思考");
});

test("collapsed thinking keeps prose in details and prioritizes concrete activity", () => {
	const firstLine = "先核对模型配置与请求参数，确认不同协议的映射行为，再检查历史消息恢复与实时事件的顺序。";
	const thinking: ContentBlock = { kind: "thinking", text: `**${firstLine}**\n更多推理细节。` };
	const preview = `${firstLine} 更多推理细节。`;
	const working = processStatus(groupFor([thinking, tool("one")]), true);
	assert.equal(working.modelLabel, undefined);
	assert.equal(working.detailLabel, "正在读取文件");
	const waiting = processStatus(groupFor([thinking, tool("one"), result("one")]), true);
	assert.equal(waiting.label, "读取了 1 个文件");
	assert.equal(waiting.detailLabel, "读取了 1 个文件");
	const active = processStatus(groupFor([thinking]), true);
	assert.equal(active.detailLabel, "正在思考");
	assert.equal(active.label, "正在思考");
	assert.doesNotMatch(active.label, /字|段/);
});

test("thinking placeholder yields to the first content without reappearing after tools", () => {
	for (const blocks of [[], [{ kind: "thinking", text: "" }]] as ContentBlock[][]) {
		assert.equal(processStatus(groupFor(blocks), true).label, "正在思考");
	}
	const thinking: ContentBlock = { kind: "thinking", text: "核对配置" };
	for (const blocks of [[thinking], [thinking, tool("one"), result("one")]]) {
		const status = processStatus(groupFor(blocks), true);
		assert.match(status.label, /正在思考|读取了 1 个文件/);
		assert.doesNotMatch(status.label, /字|段/);
		assert.equal(status.active, true);
		assert.equal(status.visible, true);
	}
	const reply = turnProcessPresentation([user, { id: "reply", role: "assistant", blocks: [{ kind: "text", text: "首个正文片段" }], streaming: true }], { running: true }).groups[0];
	assert.equal(processStatus(reply, true).visible, false);
});

test("completed tools retain a nonempty summary while the model prepares its next response", () => {
	const narration: ContentBlock = { kind: "text", text: "现在并行调用 grep 和 find，核对内容与文件名。" };
	const blocks = [narration, tool("grep", "grep"), tool("find", "find")];
	const working = processStatus(groupFor([...blocks, result("grep")]), true);
	assert.equal(working.visible, true);
	assert.equal(working.label, "正在并行运行 2 个工具（1/2）");
	const completed = [...blocks, result("grep"), result("find")];
	const waiting = processStatus(groupFor(completed), true);
	assert.equal(waiting.label, "搜索了 1 次 · 查找了 1 个文件");
	assert.equal(waiting.visible, true);
	const settled = processStatus(groupFor(completed, false), false);
	assert.equal(settled.visible, true);
	assert.match(settled.label, /搜索了 1 次 · 查找了 1 个文件/);
	assert.equal(waiting.label, settled.label);
	const shortThinking: ContentBlock = { kind: "thinking", text: "核对配置" };
	assert.equal(processStatus(groupFor([shortThinking]), true).label, "正在思考");
	assert.equal(processStatus(groupFor([shortThinking], false), false).visible, true);
});

test("process rows remain visible from tool execution through waiting, next thinking and final text", () => {
	const live = { running: true, activeTurnId: "turn:user" };
	const earlier: ChatMessage = { id: "earlier", role: "assistant", blocks: [tool("previous"), result("previous"), { kind: "text", text: "第一批检查已经完成。" }] };
	const timeline = (...messages: ChatMessage[]) => turnProcessPresentation([user, earlier, ...messages], live).groups;
	const narration: ContentBlock = { kind: "text", text: "接下来检查配置文件，随后运行项目中的验证命令。" };
	const first: ChatMessage = { id: "first", role: "assistant", blocks: [narration, tool("one")], streaming: true };
	const working = timeline(first)[1];
	const finished = { ...first, blocks: [...first.blocks, result("one")] };
	const waiting = timeline(finished)[1];
	const next: ChatMessage = { id: "next", role: "assistant", blocks: [{ kind: "thinking", text: "继续核对" }], streaming: true };
	const thinking = timeline(finished, next)[1];
	const reply: ChatMessage = { id: "reply", role: "assistant", blocks: [{ kind: "text", text: "检查完成。" }], streaming: true };
	const finalGroups = timeline(finished, { ...next, streaming: false }, reply);
	const answered = finalGroups[1];
	assert.equal(working.placement, "inline");
	assert.equal(processStatus(finalGroups[0], true).label, processStatus(timeline(first)[0], true).label);
	for (const group of [working, waiting, thinking, answered]) {
		assert.equal(group.id, working.id);
		const status = processStatus(group, true);
		assert.equal(status.visible, true);
		assert.ok(status.label.trim());
		assert.doesNotMatch(status.label, /接下来检查配置文件/);
	}
	assert.equal(processStatus(waiting, true).label, "读取了 1 个文件");
	assert.match(processStatus(thinking, true).label, /正在思考/);
	assert.match(processStatus(answered, true).label, /读取了 1 个文件/);
});

test("empty settled rows disappear while terminal outcomes remain visible without leading separators", () => {
	const empty = groupFor([], false);
	assert.equal(processStatus(empty, false).visible, false);
	assert.equal(processStatus(empty, false).label, "");
	for (const [outcome, expected] of [["error", "模型响应失败"], ["manual", "已停止"], ["aborted", "已停止"], ["length", "输出已达长度上限"]]) {
		const status = processStatus(empty, false, outcome);
		assert.equal(status.label, expected);
		assert.equal(status.visible, true);
	}
	const reply = turnProcessPresentation([user, { id: "reply", role: "assistant", blocks: [{ kind: "text", text: "直接回答" }] }]).groups[0];
	assert.equal(processStatus(reply, false).visible, false);
});

test("parallel denominator survives out-of-order completions and a single remaining tool", () => {
	const calls = Array.from({ length: 5 }, (_, index) => tool(String(index)));
	for (const completed of [0, 1, 2, 4]) {
		const group = groupFor([...calls, ...[4, 1, 0, 3].slice(0, completed).map((id) => result(String(id), id === 1))]);
		assert.match(processActivity(group).label, new RegExp(`5 个工具（${completed}/5）`));
		assert.equal(processStatus(group, true).error, completed > 1);
	}
});

test("unrelated later successes never clear collapsed failure signals", () => {
	const group = groupFor([tool("bad"), result("bad", true), tool("retry"), result("retry"), { kind: "text", text: "已解决" }]);
	assert.equal(group.error, true);
	for (const [running, outcome] of [[true, undefined], [false, "stop"]] as const) {
		const state = processStatus(group, running, outcome);
		assert.equal(state.error, true);
		assert.match(state.label, /有调用失败/);
		assert.match(state.label, /读取了 2 个文件/);
	}
	assert.equal(group.entries[0].result?.isError, true);
});

test("a following reply freezes its process row before the turn finishes", () => {
	const narration: ContentBlock = { kind: "text", text: "第一批完成，接下来核对剩余的配置与测试。" };
	const messages: ChatMessage[] = [user,
		{ id: "work", role: "assistant", blocks: [narration, tool("read"), result("read")] },
		{ id: "answer", role: "assistant", blocks: [{ kind: "text", text: "全部演示完毕，仓库已经恢复原样。" }], stopReason: "stop" },
	];
	const group = turnProcessPresentation(messages).groups[0];
	assert.equal(group.advanced, true);
	assert.equal(processStatus(group, true).label, "读取了 1 个文件");
	const completed = processStatus(group, false, "stop");
	assert.equal(completed.modelLabel, undefined);
	assert.equal(completed.label, processStatus(group, true).label);
	assert.doesNotMatch(completed.label, /第一批完成/);
	assert.equal(processStatus(group, false).modelLabel, undefined);
	assert.equal(processStatus(group, false, "length").label, completed.label);
	assert.equal(processStatus(group, false, "error").label, completed.label);
	assert.deepEqual(group.entries.map((entry) => entry.block.kind), ["tool"]);
	assert.deepEqual(group.narrationTexts, [narration.text]);
});

test("each narrated segment settles when the next content starts, including while its tool is pending", () => {
	const firstText = "先检查配置文件，确定后续修改的范围和顺序。";
	const secondText = "继续运行测试命令，确认刚才的修改已经生效。";
	const first: ChatMessage = { id: "first", role: "assistant", blocks: [{ kind: "text", text: firstText }, tool("one")], streaming: true };
	const live = { running: true, activeTurnId: "turn:user" };
	const initial = turnProcessPresentation([user, first], live).groups[0];
	assert.equal(processStatus(initial, true).label, "正在读取文件");
	const next: ChatMessage = { id: "next", role: "assistant", blocks: [{ kind: "text", text: secondText }], streaming: true };
	const afterText = turnProcessPresentation([user, first, next], live).groups[0];
	assert.equal(afterText.pending, true);
	assert.equal(afterText.advanced, true);
	assert.equal(processStatus(afterText, true).label, "读取了 1 个文件 · 等待结果");
	assert.equal(processStatus(afterText, true).modelLabel, undefined);
	const frozenCounts = new Map([[afterText.id, afterText.counts]]);
	const withTool = turnProcessPresentation([user, { ...first, blocks: [...first.blocks, result("one")] }, { ...next, blocks: [...next.blocks, tool("two", "bash")] }], { ...live, frozenCounts }).groups;
	assert.equal(withTool[0].pending, false);
	assert.deepEqual(withTool[0].counts, afterText.counts);
	assert.equal(processStatus(withTool[0], true).label, "读取了 1 个文件");
	assert.equal(processStatus(withTool[1], true).label, "正在运行命令");
	assert.equal(processStatus(withTool[0], false, "stop").label, processStatus(withTool[0], true).label);
	assert.equal(first.blocks[0].kind, "text");
	assert.equal(next.blocks[0].kind, "text");
});

test("a stopped tool sequence settles to counts even without final reply", () => {
	const group = groupFor([{ kind: "text", text: "先读取配置文件，确认各模型的连接状态。" }, tool("read")], false);
	assert.match(processStatus(group, false, "stop").label, /^读取了 1 个文件/);
	assert.equal(processStatus(group, false, "stop").modelLabel, undefined);
});

test("terminal failures identify tools or model response, and stopped work never claims success", () => {
	const failed = processStatus(groupFor([tool("bad"), result("bad", true)], false), false, "error");
	assert.equal(failed.error, true);
	assert.match(failed.label, /读取了 1 个文件（1 失败）/);
	assert.match(processStatus(groupFor([tool("missing")], false), false, "error").label, /未收到工具结果/);
	assert.match(processStatus(groupFor([{ kind: "thinking", text: "分析" }], false), false, "error").label, /模型响应失败/);
	for (const outcome of ["manual", "aborted"]) {
		const stopped = processStatus(groupFor([], false), false, outcome);
		assert.equal(stopped.error, false);
		assert.equal(stopped.complete, false);
		assert.match(stopped.label, /已停止/);
	}
});

test("a later model failure does not relabel a recovered tool attempt as a final tool failure", () => {
	const group = turnProcessPresentation([user,
		{ id: "first", role: "assistant", blocks: [tool("bad"), result("bad", true)] },
		{ id: "retry", role: "assistant", blocks: [tool("retry"), result("retry")] },
		{ id: "last", role: "assistant", blocks: [{ kind: "thinking", text: "继续分析" }], stopReason: "error" },
	]).groups[0];
	const state = processStatus(group, false, "error");
	assert.match(state.label, /模型响应失败/);
	assert.match(state.label, /（1 失败）/);
});

test("settled earlier segments keep their summaries while the latest segment reports final failure", () => {
	const groups = turnProcessPresentation([user,
		{ id: "first", role: "assistant", blocks: [tool("bad"), result("bad", true), { kind: "text", text: "改用另一条路径" }] },
		{ id: "retry", role: "assistant", blocks: [tool("retry"), result("retry"), { kind: "text", text: "已恢复" }] },
		{ id: "last", role: "assistant", blocks: [{ kind: "thinking", text: "继续分析" }], stopReason: "error" },
	]).groups;
	assert.equal(processStatus(groups[0], false, "error").label, processStatus(groups[0], true).label);
	assert.match(processStatus(groups[0], false, "error").label, /（1 失败）/);
	assert.equal(groups.length, 3);
	assert.equal(processStatus(groups[1], false, "error").error, false);
	assert.match(processStatus(groups[2], false, "error").label, /模型响应失败/);
});

test("stalled actions including pure thinking show total action time only after ten seconds without progress", () => {
	const first = processActivity(groupFor([{ kind: "thinking", text: "分析" }]));
	let clock = advanceProcessClock(undefined, first, 1000);
	assert.equal(processElapsedLabel(clock, 10_999), "");
	assert.equal(processElapsedLabel(clock, 11_000), " · 已运行 10 秒");
	const progressed = processActivity(groupFor([{ kind: "thinking", text: "分析更多" }]));
	clock = advanceProcessClock(clock, progressed, 12_000);
	assert.equal(processElapsedLabel(clock, 12_001), "");
	assert.equal(processElapsedLabel(clock, 22_000), " · 已运行 21 秒");
	clock = advanceProcessClock(clock, processActivity(groupFor([tool("next")])), 23_000);
	assert.equal(processElapsedLabel(clock, 33_000), " · 已运行 10 秒");
	assert.equal(processElapsedLabel(clock, 93_000), " · 已运行 1 分 10 秒");
});

test("status targets allow human actions while keeping command secrets, queries and prompts private", () => {
	assert.equal(toolActivityLabel(tool("read", "read", { path: "src/components/MessageList.tsx" })), "正在读取 MessageList.tsx");
	assert.equal(toolActivityLabel(tool("run", "bash", { command: "TOKEN=private node script.js" })), "正在运行命令");
	assert.equal(toolActivityLabel(tool("run", "bash", { command: "npm test --password private --token private" })), "正在运行 npm test");
	assert.equal(toolActivityLabel(tool("run", "bash", { command: "curl https://name:private@example.com" })), "正在运行命令");
	assert.equal(toolActivityLabel(tool("search", "web_search", { query: "password=private" })), "正在联网搜索");
	assert.equal(toolActivityLabel(tool("agent", "subagent", { agent: "reviewer", task: "token=private" })), "正在调用子代理 reviewer");
	assert.equal(toolActivityLabel(tool("agent", "subagent", { agent: "sk-secret-credentials" })), "正在调用子代理");
	assert.equal(toolActivityLabel(tool("read", "read", { path: "https://example.com/file?token=private" })), "正在读取文件");
	assert.equal(toolActivityLabel({ ...tool("partial", "read"), argsText: '{"path":"token=' }), "正在读取文件");
});
