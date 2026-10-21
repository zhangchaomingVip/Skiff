import test from "node:test";
import assert from "node:assert/strict";
import { advanceProcessClock, processActivity, processElapsedLabel, processStatus, toolActivityLabel } from "../src/chat/processStatus.ts";
import { turnProcessPresentation } from "../src/chat/turnProcess.ts";
import type { ChatMessage, ContentBlock } from "../src/chat/types.ts";

const user: ChatMessage = { id: "user", role: "user", blocks: [] };
const tool = (id: string, name = "read", args = {}): Extract<ContentBlock, { kind: "tool" }> => ({ kind: "tool", id, name, argsText: JSON.stringify(args), done: true });
const result = (id: string, isError = false): ContentBlock => ({ kind: "toolResult", id, name: "read", text: "output", isError });
const groupFor = (blocks: ContentBlock[], running = true) => turnProcessPresentation([user, { id: "assistant", role: "assistant", blocks, streaming: running }], { running }).groups[0];

test("live labels show only the current action or batch progress", () => {
	const group = groupFor([{ kind: "thinking", text: "分析" }, tool("one"), result("one"), tool("two", "bash", { command: "npm test --token sample-secret" })]);
	assert.equal(processStatus(group, true).label, "正在并行运行 2 个工具（1/2）");
	const thought = groupFor([...group.entries.flatMap((entry) => entry.result ? [entry.block, entry.result] : [entry.block]), result("two"), { kind: "thinking", text: "重试分析" }]);
	assert.equal(processStatus(thought, true).label, "正在思考");
	assert.doesNotMatch(processStatus(thought, true).label, /字|段|失败|读取了/);
});

test("parallel denominator survives out-of-order completions and a single remaining tool", () => {
	const calls = Array.from({ length: 5 }, (_, index) => tool(String(index)));
	for (const completed of [0, 1, 2, 4]) {
		const group = groupFor([...calls, ...[4, 1, 0, 3].slice(0, completed).map((id) => result(String(id), id === 1))]);
		assert.match(processActivity(group).label, new RegExp(`5 个工具（${completed}/5）`));
		assert.doesNotMatch(processStatus(group, true).label, /失败/);
	}
});

test("intermediate failures stay in details; successful recovery clears collapsed failure signals", () => {
	const group = groupFor([tool("bad"), result("bad", true), tool("retry"), result("retry"), { kind: "text", text: "已解决" }]);
	assert.equal(group.error, true);
	for (const [running, outcome] of [[true, undefined], [false, "stop"]] as const) {
		const state = processStatus(group, running, outcome);
		assert.equal(state.error, false);
		assert.doesNotMatch(state.label, /失败/);
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
	assert.equal(processStatus(group, true).label, "读取了 1 个文件 · 步骤 1");
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
	assert.match(processStatus(initial, true).label, /^先检查配置文件/);
	const next: ChatMessage = { id: "next", role: "assistant", blocks: [{ kind: "text", text: secondText }], streaming: true };
	const afterText = turnProcessPresentation([user, first, next], live).groups[0];
	assert.equal(afterText.pending, true);
	assert.equal(afterText.advanced, true);
	assert.equal(processStatus(afterText, true).label, "读取了 1 个文件 · 步骤 1");
	assert.equal(processStatus(afterText, true).modelLabel, undefined);
	const frozenCounts = new Map([[afterText.id, afterText.counts]]);
	const withTool = turnProcessPresentation([user, { ...first, blocks: [...first.blocks, result("one")] }, { ...next, blocks: [...next.blocks, tool("two", "bash")] }], { ...live, frozenCounts }).groups;
	assert.equal(withTool[0].pending, false);
	assert.deepEqual(withTool[0].counts, afterText.counts);
	assert.equal(processStatus(withTool[0], true).label, "读取了 1 个文件 · 步骤 1");
	assert.match(processStatus(withTool[1], true).label, /^继续运行测试命令/);
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
	assert.match(processStatus(groupFor([tool("missing")], false), false, "error").label, /工具执行失败/);
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
	assert.doesNotMatch(state.label, /（1 失败）/);
});

test("settled earlier segments keep their summaries while the latest segment reports final failure", () => {
	const groups = turnProcessPresentation([user,
		{ id: "first", role: "assistant", blocks: [tool("bad"), result("bad", true), { kind: "text", text: "改用另一条路径" }] },
		{ id: "retry", role: "assistant", blocks: [tool("retry"), result("retry"), { kind: "text", text: "已恢复" }] },
		{ id: "last", role: "assistant", blocks: [{ kind: "thinking", text: "继续分析" }], stopReason: "error" },
	]).groups;
	assert.equal(processStatus(groups[0], false, "error").label, processStatus(groups[0], true).label);
	assert.doesNotMatch(processStatus(groups[0], false, "error").label, /（1 失败）/);
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
