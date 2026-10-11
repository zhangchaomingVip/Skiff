import test from "node:test";
import assert from "node:assert/strict";
import { advanceTimeline, startTimeline, type VoyageTimeline } from "../src/chat/voyageTimeline.ts";
import { sampleVoyage, startVoyage, visibleReplyUnits } from "../src/chat/sailing.ts";
import type { ChatMessage, ContentBlock } from "../src/chat/types.ts";

const call = (id: string): ContentBlock => ({ kind: "tool", id, name: "read", argsText: "src/main.ts", done: true });
const result = (id: string, text = "done", isError = false): ContentBlock => ({ kind: "toolResult", id, name: "read", text, isError });
const message = (...blocks: ContentBlock[]): ChatMessage[] => [{ id: "step", role: "assistant", streaming: true, blocks }];
const thinking = message({ kind: "thinking", text: "思考" });
const advance = (timeline: VoyageTimeline, now: number, messages: ChatMessage[], running = true) => advanceTimeline(timeline, { key: timeline.key, now, messages, running });

test("submission wait and thinking → tool → thinking accumulate independent monotonic clocks", () => {
	let timeline = advance(startTimeline("run", 1000, 0), 1000, []);
	assert.deepEqual([timeline.durationMs, timeline.thinkingMs, timeline.toolMs], [1000, 0, 0]);
	timeline = advance(timeline, 2000, thinking);
	timeline = advance(timeline, 4000, message(call("a")));
	assert.deepEqual([timeline.durationMs, timeline.thinkingMs, timeline.toolMs], [4000, 2000, 0]);
	timeline = advance(timeline, 7000, [...message(call("a"), result("a")), { ...thinking[0], id: "second" }]);
	timeline = advance(timeline, 8000, [...message(call("a"), result("a")), { ...thinking[0], id: "second" }]);
	assert.deepEqual([timeline.durationMs, timeline.thinkingMs, timeline.toolMs], [8000, 3000, 3000]);
	timeline = advance(timeline, 9000, [], false);
	assert.deepEqual([timeline.durationMs, timeline.thinkingMs, timeline.toolMs], [9000, 4000, 3000]);
	assert.equal(advance(timeline, 99000, thinking, false), timeline);
});

test("4999/5000ms threshold, independent parallel calls, completion-order log and batch wall clock", () => {
	let timeline = advance(startTimeline("run", 0), 0, message(call("a")));
	timeline = advance(timeline, 1000, message(call("a"), call("b")));
	timeline = advance(timeline, 4999, message(call("a"), call("b")));
	assert.equal(timeline.tools[0].showDuration, false);
	timeline = advance(timeline, 5000, message(call("a"), call("b")));
	assert.equal(timeline.tools[0].showDuration, true);
	assert.equal(timeline.tools[1].showDuration, false);
	timeline = advance(timeline, 5500, message(call("a"), call("b"), result("b")));
	assert.equal(timeline.tools[1].durationMs, 4500);
	timeline = advance(timeline, 7000, message(call("a"), call("b"), result("b"), result("a")));
	assert.equal(timeline.toolMs, 7000);
	assert.equal(timeline.batches.length, 1);
	assert.equal(timeline.batches[0].endedAt, 7000);
	assert.deepEqual(timeline.tools.map((tool) => tool.completionOrder), [2, 1]);
	timeline = advance(timeline, 9000, message(call("a"), call("b"), result("b"), result("a")));
	assert.deepEqual(timeline.tools.map((tool) => tool.durationMs), [7000, 4500]);
	assert.equal(timeline.toolMs, 7000);
});

test("consecutive batches exclude idle gaps and repeated IDs/results cannot reopen a terminal call", () => {
	let timeline = advance(startTimeline("run", 0), 0, message(call("a")));
	timeline = advance(timeline, 1000, message(call("a"), result("a")));
	timeline = advance(timeline, 2000, message(call("a"), result("a"), call("b")));
	timeline = advance(timeline, 3000, message(call("a"), result("a"), call("b"), result("b"), call("a"), result("a", "error", true)));
	assert.equal(timeline.toolMs, 2000);
	assert.equal(timeline.batches.length, 2);
	assert.equal(timeline.tools.length, 2);
	assert.equal(timeline.tools[0].status, "completed");
});

test("failure, timeout, cancellation, bridge exit and absent results settle once; late results stay frozen", () => {
	let timeline = advance(startTimeline("run", 0), 0, message(call("a"), call("b")));
	timeline = advance(timeline, 6000, message(call("a"), call("b"), result("a", "Permission denied", true), result("b", "timed out", true)));
	assert.deepEqual(timeline.tools.map((tool) => tool.status), ["failed", "timeout"]);
	for (const unresolvedStatus of ["interrupted", "failed", "timeout", "missing"] as const) {
		const open = advance(startTimeline("run", 0), 0, message(call("pending")));
		const settled = advanceTimeline(open, { key: "run", now: 7000, messages: message(call("pending")), running: false, unresolvedStatus });
		assert.equal(settled.tools[0].status, unresolvedStatus);
		assert.equal(settled.tools[0].endedAt, 7000);
		assert.equal(settled.batches[0].endedAt, 7000);
		assert.equal(advance(settled, 10000, message(call("pending"), result("pending")), false), settled);
	}
});

test("missing timestamps/IDs, anonymous results, clock rollback and cross-run isolation have stable fallbacks", () => {
	let timeline = advance(startTimeline("run", 1000, NaN), 1000, message(call(""), call("b")));
	timeline = advance(timeline, 2000, message(call(""), call("b"), { kind: "toolResult", name: "read", text: "ambiguous", isError: false }));
	assert(timeline.tools.every((tool) => tool.status === "running"));
	const rolledBack = advance(timeline, 500, message(call(""), call("b")));
	assert.equal(rolledBack.at, 2000);
	assert.equal(rolledBack.toolMs, timeline.toolMs);
	assert.equal(advanceTimeline(timeline, { key: "old-run", now: 8000, messages: [], running: false }), timeline);
	assert.equal(startTimeline("next", 3000).tools.length, 0);
	let anonymous = advance(startTimeline("anonymous", 0), 0, message(call("")));
	anonymous = advance(anonymous, 1000, message(call(""), { kind: "toolResult", name: "read", text: "done", isError: false }));
	assert.equal(anonymous.tools[0].status, "completed");
	assert.equal(advance(anonymous, Infinity, []).at, 1000);
});

test("only current-turn visible reply increments speed; tools/thinking gate it immediately and usage cannot raise peak", () => {
	const messages: ChatMessage[] = [{ id: "old", role: "assistant", blocks: [{ kind: "text", text: "old" }] }, { id: "user", role: "user", blocks: [] }, ...thinking];
	assert.equal(visibleReplyUnits(messages), 0);
	let sample = sampleVoyage(startVoyage("run", 0, 0), 0, 100, true, false);
	assert.equal(sample.speed, 0);
	sample = sampleVoyage(sample, 0, 200, true, false);
	assert.equal(sample.peak, 0);
	sample = sampleVoyage(sample, 4, 300, true, true);
	assert(sample.speed > 0);
	const peak = sample.peak;
	sample = sampleVoyage(sample, 4, 400, true, false);
	assert.equal(sample.speed, 0);
	assert.equal(sample.activity, "fishing");
	assert.equal(sample.peak, peak);
	const usageCorrection = message({ kind: "text", text: "abcd" });
	usageCorrection[0].usage = { input: 0, output: 10000, cacheRead: 0, cacheWrite: 0, totalTokens: 10000 };
	assert.equal(visibleReplyUnits(usageCorrection), 1);
	const settled = sampleVoyage(sample, 4, 500, false);
	assert.equal(settled.peak, peak);
	assert.equal(sampleVoyage(settled, 400, 10000, false), settled);
});

test("a provisional streamed call adopts pi's late ID without a duplicate row or a restarted clock", () => {
	let timeline = advance(startTimeline("run", 0), 0, message(call("")));
	const rowId = timeline.tools[0].id;
	timeline = advance(timeline, 5000, message({ ...call("confirmed"), argsText: "updated arguments" } as ContentBlock));
	assert.equal(timeline.tools.length, 1);
	assert.equal(timeline.tools[0].id, rowId);
	assert.equal(timeline.tools[0].callId, "confirmed");
	assert.equal(timeline.tools[0].durationMs, 5000);
	timeline = advance(timeline, 6000, message(call("confirmed"), result("confirmed")));
	assert.equal(timeline.tools[0].status, "completed");
	assert.equal(timeline.tools[0].durationMs, 6000);
	assert.deepEqual(timeline.batches[0].toolIds, [rowId]);
});
