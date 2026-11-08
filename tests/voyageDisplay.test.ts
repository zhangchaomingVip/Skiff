import test from "node:test";
import assert from "node:assert/strict";
import { advanceVoyageDisplay, restoreVoyageDisplay } from "../src/chat/voyageDisplay.ts";
import type { ChatMessage } from "../src/chat/types.ts";
import { voyageProcessStats } from "../src/chat/voyageBento.ts";
import { summarizeUsage } from "../src/chat/usage.ts";

const known: Parameters<typeof advanceVoyageDisplay>[1] = {
	streaming: false, speed: 0, averageSpeed: 128, ttftMs: 1200, peakSpeed: 245,
	turn: { input: 34000, output: 2800, total: 36800, cacheRead: 32000, cacheWrite: 0 },
	context: 36800, limit: 200000, ratio: .184, contextSource: "last-request",
	telemetry: { turn: voyageProcessStats([]), session: voyageProcessStats([]), usage: summarizeUsage([]), usageKnown: true, composition: undefined, inputTrend: [2000] },
};
const pending: typeof known = {
	...known, streaming: true, speed: 0, averageSpeed: undefined, ttftMs: undefined, peakSpeed: 0,
	turn: { total: 0, output: 0 }, context: 1000, ratio: .005, contextSource: "local-estimate",
	telemetry: { ...known.telemetry, inputTrend: [2000, undefined] },
};

test("new turns retain coherent readings and their chart until current data arrives", () => {
	const previous = advanceVoyageDisplay(undefined, known, "chat-a/model", "turn-1");
	const waiting = advanceVoyageDisplay(previous, pending, "chat-a/model", "turn-2");
	for (const key of ["speed", "tokens", "cache", "context"] as const) assert.deepEqual(waiting[key], previous[key]);
	assert.deepEqual(waiting.retained, { speed: true, tokens: true, cache: true, context: true });
	assert.equal(pending.turn.total, 0); // Display retention never changes the current bill.
	assert.equal(pending.turn.input, undefined);
	assert.equal(waiting.tokens!.input + waiting.tokens!.output, waiting.tokens!.total);
});

test("speed resumes independently while usage waits; a real pause can still display zero", () => {
	const previous = advanceVoyageDisplay(undefined, known, "chat", "first");
	const waiting = advanceVoyageDisplay(previous, pending, "chat", "next");
	const answering = advanceVoyageDisplay(waiting, { ...pending, speed: 80, ttftMs: 500, peakSpeed: 80 }, "chat", "next");
	assert.equal(answering.speed?.value, 80);
	assert.equal(answering.speed?.ttftMs, 500);
	assert.equal(answering.retained.speed, false);
	assert.equal(answering.retained.tokens, true);
	const paused = advanceVoyageDisplay(answering, { ...pending, speed: 0, ttftMs: 500, peakSpeed: 80 }, "chat", "next");
	assert.equal(paused.speed?.value, 0);
	assert.equal(paused.retained.speed, false);
	const reported = advanceVoyageDisplay(paused, { ...known, turn: { input: 10000, output: 1000, total: 11000, cacheRead: 9000, cacheWrite: 0 }, context: 11000, ratio: .055, telemetry: { ...known.telemetry, inputTrend: [2000, 1000] } }, "chat", "next");
	assert.equal(reported.tokens?.total, 11000);
	assert.deepEqual(reported.tokens?.trend, [2000, 1000]);
	assert.equal(reported.cache?.read, 9000);
	assert.equal(reported.context?.used, 11000);
	assert(Object.values(reported.retained).every((value) => !value));
});

test("explicit zero usage replaces old values and transient missing usage retains the complete group", () => {
	const previous = advanceVoyageDisplay(undefined, known, "chat", "turn");
	const missing = advanceVoyageDisplay(previous, { ...pending, turn: { output: 20, total: 20 } }, "chat", "turn");
	assert.deepEqual(missing.tokens, previous.tokens);
	const inconsistent = advanceVoyageDisplay(previous, { ...pending, turn: { input: 34000, output: 20, total: 20 } }, "chat", "turn");
	assert.deepEqual(inconsistent.tokens, previous.tokens);
	const placeholder = advanceVoyageDisplay(previous, { ...pending, turn: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 } }, "chat", "next");
	assert.deepEqual(placeholder.tokens, previous.tokens);
	assert.deepEqual(placeholder.cache, previous.cache);
	const zero = advanceVoyageDisplay(previous, { ...known, averageSpeed: 0, turn: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 }, context: 0, ratio: 0, contextSource: "pi" }, "chat", "next");
	assert.equal(zero.speed?.value, 0);
	assert.equal(zero.tokens?.total, 0);
	assert.equal(zero.cache?.write, 0);
	assert.equal(zero.context?.used, 0);
	assert(Object.values(zero.retained).every((value) => !value));
});

test("conversation/model resets and explicit context clearing never resurrect a previous snapshot", () => {
	const previous = advanceVoyageDisplay(undefined, known, "chat/model-a", "turn");
	const empty = { ...pending, context: undefined, turn: {} };
	for (const identity of ["other-chat/model-a", "chat/model-b", "empty"]) {
		const next = advanceVoyageDisplay(previous, empty, identity, "next");
		assert.equal(next.speed, undefined);
		assert.equal(next.tokens, undefined);
		assert.equal(next.cache, undefined);
		assert.equal(next.context, undefined);
	}
	const cleared = advanceVoyageDisplay(previous, empty, "chat/model-a", "turn", true);
	assert.equal(cleared.context, undefined);
	assert.equal(cleared.retained.context, false);
	const resized = advanceVoyageDisplay(previous, { ...empty, limit: 1000000 }, "chat/model-a", "turn");
	assert.equal(resized.context, undefined);
});

test("ending without new metrics keeps the last reading explicitly marked as retained", () => {
	const previous = advanceVoyageDisplay(undefined, known, "chat", "turn");
	const stopped = advanceVoyageDisplay(previous, { ...pending, streaming: false }, "chat", "cancelled");
	assert.deepEqual(stopped.speed, previous.speed);
	assert.deepEqual(stopped.tokens, previous.tokens);
	assert.equal(stopped.retained.speed, true);
	assert.equal(stopped.retained.tokens, true);
});

test("reopening a waiting conversation restores its preceding reported turn without sampling output", () => {
	const messages: ChatMessage[] = [
		{ id: "first", role: "user", blocks: [] },
		{ id: "reply", role: "assistant", provider: "mock", model: "model-a", blocks: [], usage: { input: 2000, cacheRead: 32000, cacheWrite: 0, output: 2800, totalTokens: 36800 }, performance: { fingerprint: "saved", ttftMs: 1200, decodeMs: 1000, averageSpeed: 128, averageEstimated: false } },
		{ id: "next", role: "user", blocks: [] },
	];
	const restored = restoreVoyageDisplay(pending, messages, "chat", { id: "model-a", provider: "mock" });
	assert.equal(restored?.tokens?.total, 36800);
	assert.deepEqual(restored?.tokens?.trend, [2000]);
	assert.equal(restored?.speed?.value, 128);
	assert.equal(restored?.cache?.read, 32000);
	assert.equal(restored?.context?.used, 36800);
	assert.equal(restoreVoyageDisplay(pending, [], "chat"), undefined);
	assert.equal(restoreVoyageDisplay(pending, messages, "chat", { id: "model-b", provider: "mock" }), undefined);
});
