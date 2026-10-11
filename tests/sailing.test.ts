import test from "node:test";
import assert from "node:assert/strict";
import { averageOutputSpeed, contextPressure, contextReminder, currentTurnMessages, currentTurnStats, estimateOutputTokens, gaugePosition, outputSpeed, pendingToolCallId, sampleVoyage, startVoyage, turnOutput, visibleOutputUnits, voyagePhase, voyageStatus } from "../src/chat/sailing.ts";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState } from "../src/chat/types.ts";
import type { ChatMessage } from "../src/chat/types.ts";

test("live speed counts only the current turn's visible output", () => {
	const messages: ChatMessage[] = [
		{ id: "old", role: "assistant", blocks: [{ kind: "text", text: "old reply" }] },
		{ id: "user", role: "user", blocks: [{ kind: "text", text: "question" }] },
		{ id: "thinking", role: "assistant", blocks: [{ kind: "thinking", text: "思考" }, { kind: "text", text: "fast boat" }] },
	];
	assert.equal(estimateOutputTokens(messages), 5);
	assert.equal(outputSpeed([{ at: 500, tokens: 0 }, { at: 1000, tokens: 25 }], 1000), 50);
	assert.equal(outputSpeed([{ at: 500, tokens: 0 }, { at: 1000, tokens: 25 }], 5000), 0);
});

test("gauge clamps at 300 tok/s while activity remains independent of context", () => {
	assert.equal(-90 + gaugePosition(0) * 180, -90);
	assert.equal(-90 + gaugePosition(150) * 180, 0);
	assert.equal(-90 + gaugePosition(400) * 180, 90);
	assert.equal(voyageStatus("sailing", "response"), "航行中");
	assert.equal(voyageStatus("fishing", "response"), "等待响应");
	assert.equal(voyageStatus("moored", "thinking"), "已停泊");
});

const usage = (output: number) => ({ input: 0, cacheRead: 0, cacheWrite: 0, output, totalTokens: output });
const user: ChatMessage = { id: "user", role: "user", blocks: [], timestamp: 1000 };
const assistant: ChatMessage = { id: "answer", role: "assistant", blocks: [{ kind: "thinking", text: "思考" }, { kind: "text", text: "abcd" }], streaming: true };

test("average includes submission wait, tools and all assistant steps; incomplete usage keeps the text estimate", () => {
	const steps: ChatMessage[] = [assistant, { id: "tool", role: "assistant", blocks: [{ kind: "tool", id: "call", name: "read", argsText: "不计入".repeat(200), done: true }] }];
	assert.equal(visibleOutputUnits(steps), 3);
	assert.deepEqual(turnOutput(steps, true), { output: 3, estimated: true });
	const complete = steps.map((message, index) => ({ ...message, streaming: false, usage: usage((index + 1) * 20) }));
	assert.deepEqual(turnOutput(complete, false), { output: 60, estimated: false });
	assert.equal(averageOutputSpeed(turnOutput(complete, false).output, 6000), 10);
	assert.deepEqual(turnOutput([complete[0], steps[1]], false), { output: 3, estimated: true });
	assert.deepEqual(turnOutput([{ ...complete[0], usage: usage(NaN) }], false), { output: 3, estimated: true });
	assert.equal(averageOutputSpeed(0, 1000), 0);
	for (const duration of [undefined, 0, -1, NaN, Infinity]) assert.equal(averageOutputSpeed(10, duration), undefined);
	assert.equal(averageOutputSpeed(undefined, 1000), undefined);
	assert.equal(averageOutputSpeed(Infinity, 1000), undefined);
	assert.deepEqual(turnOutput([], false), { output: undefined, estimated: true });
});

test("sampler waits immediately, sails for output and handles the exact 800ms boundary and restart", () => {
	let sample = sampleVoyage(startVoyage("run", 1000, 1000), 0, 1100, true);
	assert.equal(sample.activity, "fishing");
	sample = sampleVoyage(sample, 2, 1200, true);
	assert.equal(sample.activity, "sailing");
	assert(sample.speed > 0 && sample.speed < 5);
	assert.equal(voyageStatus(sample.activity, voyagePhase([assistant])), "航行中");
	assert.equal(voyageStatus(sample.activity, voyagePhase([{ ...assistant, blocks: [{ kind: "thinking", text: "思考" }] }])), "思考中");
	const peak = sample.peak;
	sample = sampleVoyage(sample, 2, 1999, true);
	assert.equal(sample.activity, "sailing");
	sample = sampleVoyage(sample, 2, 2000, true);
	assert.equal(sample.activity, "fishing");
	assert.equal(sample.speed, 0);
	sample = sampleVoyage(sample, 2.25, 2100, true);
	assert.equal(sample.activity, "sailing");
	assert(sample.peak! >= peak!);
	assert.equal(sample.durationMs, 1100);
});

test("peak uses the smoothed 500ms window across steps, is uncapped and never corrected by usage", () => {
	let sample = startVoyage("run", 0, 0);
	for (let at = 100; at <= 1000; at += 100) sample = sampleVoyage(sample, at, at, true);
	assert(sample.peak! > 300);
	assert.equal(outputSpeed([{ at: 0, tokens: 0 }, { at: 500, tokens: 100 }, { at: 600, tokens: 105 }], 600), 20);
	const peak = sample.peak;
	sample = sampleVoyage(sample, 1000, 1800, true);
	assert.equal(sample.peak, peak);
	sample = sampleVoyage(sample, 1001, 1900, true);
	assert.equal(sample.peak, peak);
	const settled = sampleVoyage(sample, 100000, 2000, false);
	assert.equal(settled.peak, peak);
	assert.equal(settled.activity, "moored");
	assert.equal(settled.durationMs, 2000);
	assert.equal(sampleVoyage(settled, 200000, 9000, false), settled);
	const next = sampleVoyage(startVoyage("next", 3000, 3000), 0, 3100, true);
	assert.equal(next.peak, 0);
	assert.equal(next.activity, "fishing");
});

test("unconfirmed submissions exclude the previous turn and cancellation/failure settle once", () => {
	const messages = [user, { ...assistant, streaming: false, usage: usage(100), durationMs: 1000 }];
	for (const end of ["prompt_cancel", "agent_end", "bridge_exit"]) {
		let state = reduce({ ...initialSessionState, messages }, { type: "prompt_start", promptId: "next", startedAt: 4000, message: { ...user, id: "pending" } });
		assert.deepEqual(currentTurnMessages(state.messages, state.activeRun), []);
		let sample = sampleVoyage(startVoyage("next", 4000, state.activeRun?.startedAt), visibleOutputUnits(currentTurnMessages(state.messages, state.activeRun)), 4500, true);
		state = reduce(state, { type: end, promptId: "next", message: "failed" });
		sample = sampleVoyage(sample, 0, 4600, state.isStreaming);
		assert.equal(sample.activity, "moored");
		assert.equal(sample.peak, 0);
		assert.equal(sample.durationMs, 600);
	}
	assert.deepEqual(currentTurnMessages([...messages, { ...user, id: "pending" }, assistant], { startedAt: 4000, turnId: "turn:pending" }), [assistant]);
});

test("tool results determine tool wait; missing information falls back to response wait", () => {
	const tool: ChatMessage = { id: "tool", role: "assistant", blocks: [{ kind: "tool", id: "call", name: "read", argsText: "", done: true }] };
	assert.equal(voyageStatus("fishing", voyagePhase([tool])), "工具执行中");
	assert.equal(pendingToolCallId([tool]), "call");
	assert.equal(voyagePhase([{ ...tool, blocks: [...tool.blocks, { kind: "toolResult", id: "call", name: "read", text: "done", isError: false }] }]), "response");
	assert.equal(pendingToolCallId([{ ...tool, blocks: [...tool.blocks, { kind: "toolResult", id: "call", name: "read", text: "done", isError: false }] }]), undefined);
	const next = { ...tool, blocks: [...tool.blocks, { kind: "toolResult", id: "call", name: "read", text: "done", isError: false }, { kind: "tool", id: "next", name: "sleep", argsText: "", done: true }] };
	assert.equal(pendingToolCallId([next]), "next");
	assert.equal(voyagePhase([]), "response");
});

test("history restores the average from usage and timing without inventing a peak", () => {
	const messages = [user, { ...assistant, streaming: false, usage: usage(20), timestamp: 3000 }];
	assert.equal(averageOutputSpeed(turnOutput(currentTurnMessages(messages), false).output, currentTurnStats(messages).durationMs), 10);
	assert.equal(startVoyage("history", 10000).peak, undefined);
	assert.equal(averageOutputSpeed(turnOutput([assistant], false).output, undefined), undefined);
});

test("context reminders use actual ratios and retain 80/95 color semantics", () => {
	assert.equal(contextReminder(899, 1000), undefined);
	assert.equal(contextReminder(899.99, 1000), undefined);
	assert.equal(contextReminder(900, 1000), "上下文已使用 90.0%，建议新开会话。");
	assert.equal(contextReminder(950, 1000), "上下文已使用 95.0%，建议新开会话。");
	assert.equal(contextPressure(.95), "warning");
	assert.equal(contextReminder(1000, 1000), "上下文已达到上限，建议新开会话。");
	assert.equal(contextReminder(1000.01, 1000), "上下文已超出上限（100.0%），建议新开会话。");
	assert.equal(contextReminder(1100, 1000), "上下文已超出上限（110.0%），建议新开会话。");
	assert.equal(contextReminder(900, 2000), undefined);
	for (const invalid of [undefined, NaN, Infinity, -1]) assert.equal(contextReminder(invalid, 1000), undefined);
	for (const invalid of [undefined, NaN, Infinity, -1, 0]) assert.equal(contextReminder(1000, invalid), undefined);
});

test("context warning thresholds and current-turn records use only the latest prompt", () => {
	assert.deepEqual([.79, .8, .95, .951].map(contextPressure), ["normal", "warning", "warning", "critical"]);
	const usage = (output: number, cost: number) => ({ input: 0, cacheRead: 0, cacheWrite: 0, output, totalTokens: output, cost: { total: cost } });
	const messages: ChatMessage[] = [
		{ id: "old", role: "assistant", blocks: [], usage: usage(99, 9) },
		{ id: "user", role: "user", blocks: [], timestamp: 1000 },
		{ id: "step", role: "assistant", blocks: [], usage: usage(10, .1) },
		{ id: "final", role: "assistant", blocks: [], usage: usage(20, .2), durationMs: 2000 },
	];
	assert.deepEqual(currentTurnStats(messages), { durationMs: 2000, output: 30, cost: { totals: {}, unconfigured: true } });
	assert.deepEqual(currentTurnStats([...messages, { id: "next", role: "user", blocks: [] }]), {});
});
