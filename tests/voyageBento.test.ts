import test from "node:test";
import assert from "node:assert/strict";
import { contextComposition, decodeTiming, formatLatency, turnInputPath, turnInputTrend, voyageProcessStats } from "../src/chat/voyageBento.ts";
import { processEvent } from "../src/chat/voyageTimeline.ts";
import { cacheSavingsRatio } from "../src/chat/cost.ts";
import type { ChatMessage } from "../src/chat/types.ts";

test("decode clock excludes TTFT, reasoning and tools and freezes after completion", () => {
	let timeline = processEvent(undefined, { type: "run_start", key: "decode", at: 1000 });
	assert.deepEqual(decodeTiming(timeline), {});
	timeline = processEvent(timeline, { type: "output_delta", at: 1380 });
	assert.deepEqual(decodeTiming(timeline), { ttftMs: 380, decodeMs: undefined });
	timeline = processEvent(timeline, { type: "tool_start", id: "read", name: "read", at: 2380 });
	timeline = processEvent(timeline, { type: "phase", phase: "thinking", at: 7380 });
	timeline = processEvent(timeline, { type: "output_delta", at: 9380 });
	timeline = processEvent(timeline, { type: "run_end", at: 11180, status: "completed" });
	assert.deepEqual(decodeTiming(timeline), { ttftMs: 380, decodeMs: 2800 });
	assert.deepEqual(decodeTiming({ ...timeline, at: 90000 }), { ttftMs: 380, decodeMs: 2800 });
	assert.deepEqual(decodeTiming(), {});
});

test("latency retains subsecond precision", () => {
	assert.equal(formatLatency(380), "380ms");
	assert.equal(formatLatency(2800), "2.8s");
	assert.equal(formatLatency(), "—");
});

test("input trend groups model steps by user turn and excludes cache reads and output", () => {
	const user = (id: string): ChatMessage => ({ id, role: "user", blocks: [] });
	const reply = (id: string, input: number, cacheWrite = 0): ChatMessage => ({ id, role: "assistant", blocks: [], usage: { input, cacheWrite, cacheRead: 90000, output: 5000, totalTokens: 999999 } });
	const messages = [reply("orphan", 800), user("u1"), reply("step1", 100, 30), reply("step2", 200, 20), user("u2"), user("u3"), reply("zero", 0), user("u4")];
	assert.deepEqual(turnInputTrend(messages), [350, undefined, 0, undefined]);
	assert.deepEqual(turnInputTrend([]), []);
	// Reply streaming cannot create new turn samples or add output to the input trend.
	const live: ChatMessage = { id: "live", role: "assistant", streaming: true, blocks: [{ kind: "text", text: "回答".repeat(200) }] };
	assert.deepEqual(turnInputTrend([...messages, live]), [350, undefined, 0, undefined]);
	assert.deepEqual(turnInputTrend([...messages, { ...live, usage: reply("usage", 50).usage }]), [350, undefined, 0, 50]);
});

test("turn curves preserve peaks, plateaus and decreases at their actual round positions", () => {
	const shape = turnInputPath([100, 400, 400, 200]);
	assert.equal(shape.points.length, 4);
	assert(shape.points[1].y < shape.points[0].y);
	assert.equal(shape.points[1].y, shape.points[2].y);
	assert(shape.points[3].y > shape.points[2].y);
	assert.match(shape.line, / C/);
	assert(shape.area.endsWith("Z"));
	assert.deepEqual(shape.markers.map((point) => point.turn), [4]);
	assert.equal(turnInputPath([42]).line, "");
	assert.equal(turnInputPath([42]).markers.length, 1);
	assert.equal(turnInputPath([0]).markers.length, 1);
	assert.equal(turnInputPath([0, 0]).points[0].y, turnInputPath([0, 0]).points[1].y);
	assert.notEqual(turnInputPath([0, 0]).line, "");
});

test("missing input rounds leave gaps rather than invented zero values or a compressed time axis", () => {
	const shape = turnInputPath([100, 200, undefined, 300, 400]);
	assert.deepEqual(shape.points.map((point) => point.turn), [1, 2, 4, 5]);
	assert.equal(shape.line.match(/M/g)?.length, 2);
	assert.equal(shape.area.match(/Z/g)?.length, 2);
	assert.equal(turnInputPath([100, undefined, 400]).line, "");
	assert.equal(turnInputPath([100, undefined, 400]).markers.length, 2);
	assert.equal(turnInputPath([100, 200, undefined]).markers.length, 0);
	assert.equal(turnInputPath([undefined, NaN, -1, Infinity]).points.length, 0);
	assert.equal(turnInputPath([]).line, "");
});

const cached: ChatMessage = { id: "answer", role: "assistant", blocks: [], usage: { input: 2000, cacheRead: 32000, cacheWrite: 0, output: 1000, reasoning: 0, totalTokens: 35000 }, routeSnapshot: {
	offerId: "mock/model", routeId: "mock", providerKey: "mock", familyId: "mock", familyName: "Mock", modelId: "model", relayId: "mock", relayName: "Mock",
	currency: "USD", inputCost: 2, outputCost: 4, cacheReadCost: .2,
} };

test("cache savings compare actual prices including output, preserve snapshots and reject unknown pricing", () => {
	// Full price .072; cached price .0144: 80% saved, distinct from the 94% hit rate.
	assert.ok(Math.abs(cacheSavingsRatio([cached], [])! - .8) < 1e-12);
	assert.equal(cacheSavingsRatio([{ ...cached, routeSnapshot: undefined }], []), undefined);
	assert.equal(cacheSavingsRatio([{ ...cached, streaming: true }], []), undefined);
	assert.equal(cacheSavingsRatio([cached, { ...cached, routeSnapshot: { ...cached.routeSnapshot!, currency: "CNY" } }], []), undefined);
	assert.equal(cacheSavingsRatio([{ ...cached, usage: { ...cached.usage!, input: 34000, cacheRead: 0 } }], []), 0);
	assert.ok(Math.abs(cacheSavingsRatio([{ ...cached, routeSnapshot: undefined }], [], { id: "model", provider: "mock", currency: "USD", cost: { input: 2, output: 4, cacheRead: .2 } })! - .8) < 1e-12);
});

test("process totals count model steps, deduplicate tool results and exclude idle time between turns", () => {
	const messages: ChatMessage[] = [
		{ id: "u1", role: "user", timestamp: 0, blocks: [] },
		{ id: "a1", role: "assistant", blocks: [{ kind: "tool", id: "read", name: "read", argsText: "{}", done: true }] },
		{ id: "r1", role: "assistant", blocks: [{ kind: "toolResult", id: "read", name: "read", text: "ok", isError: false }] },
		{ id: "a2", role: "assistant", blocks: [{ kind: "text", text: "done" }], durationMs: 2000, performance: { fingerprint: "test", ttftMs: 500, decodeMs: 1000, averageSpeed: 100, averageEstimated: false } },
		{ id: "u2", role: "user", timestamp: 100000, blocks: [] },
		{ id: "a3", role: "assistant", blocks: [{ kind: "tool", id: "read", name: "read", argsText: "{}", done: true }], durationMs: 4000, performance: { fingerprint: "test2", ttftMs: 1500, decodeMs: 3000, averageSpeed: 200, averageEstimated: true } },
		{ id: "r2", role: "assistant", blocks: [{ kind: "toolResult", id: "read", name: "read", text: "failed", isError: true }] },
	];
	const stats = voyageProcessStats(messages);
	assert.equal(stats.turns, 2);
	assert.equal(stats.steps, 3);
	assert.equal(stats.calls, 2);
	assert.equal(stats.succeeded, 1);
	assert.equal(stats.failed, 1);
	assert.equal(stats.durationMs, 6000);
	assert.equal(stats.avgTtftMs, 1000);
	assert.equal(stats.averageSpeed, 175); // Time-weighted, not the arithmetic mean of 100 and 200.
	assert.equal(voyageProcessStats([]).avgTtftMs, undefined);
	assert.equal(voyageProcessStats([{ id: "old", role: "user", blocks: [] }]).durationMs, undefined);
});

test("live lifecycle statuses reconcile with transcript calls without counting them twice", () => {
	let timeline = processEvent(undefined, { type: "run_start", key: "calls", at: 0 });
	timeline = processEvent(timeline, { type: "tool_start", id: "read", name: "read", at: 500 });
	timeline = processEvent(timeline, { type: "tool_complete", id: "read", success: false, at: 1000 });
	const stats = voyageProcessStats([{ id: "a", role: "assistant", blocks: [{ kind: "tool", id: "read", name: "read", argsText: "{}", done: true }] }], timeline);
	assert.equal(stats.calls, 1);
	assert.equal(stats.failed, 1);
	assert.equal(stats.unresolved, 0);
});

test("context composition reconciles to the current window and bounds compacted transcript estimates", () => {
	const messages: ChatMessage[] = [{ id: "context", role: "assistant", blocks: [{ kind: "text", text: "航行".repeat(50) }, { kind: "toolResult", name: "read", text: "结果".repeat(25), isError: false }] }];
	assert.deepEqual(contextComposition(messages, 200), { overhead: 50, conversation: 100, toolResults: 50, scaled: false });
	const compacted = contextComposition(messages, 60)!;
	assert.deepEqual(compacted, { overhead: 0, conversation: 40, toolResults: 20, scaled: true });
	assert.equal(contextComposition(messages), undefined);
	assert.deepEqual(contextComposition(messages, 0), { overhead: 0, conversation: 0, toolResults: 0, scaled: true });
});
