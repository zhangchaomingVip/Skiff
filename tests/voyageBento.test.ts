import test from "node:test";
import assert from "node:assert/strict";
import { decodeTiming, formatLatency, smoothTokenPath } from "../src/chat/voyageBento.ts";
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

test("latency retains subsecond precision and token curves do not invent samples", () => {
	assert.equal(formatLatency(380), "380ms");
	assert.equal(formatLatency(2800), "2.8s");
	assert.equal(formatLatency(), "—");
	assert.equal(smoothTokenPath([]).line, "");
	assert.equal(smoothTokenPath([0, NaN, -1]).line, "");
	const shape = smoothTokenPath([2, 10, 3, 0, 8]);
	assert.match(shape.line, / Q/);
	assert.ok(!shape.line.includes("NaN"));
	assert.ok(shape.area.endsWith("L100,32 L0,32 Z"));
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
