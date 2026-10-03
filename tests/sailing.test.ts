import test from "node:test";
import assert from "node:assert/strict";
import { contextPressure, currentTurnStats, estimateOutputTokens, gaugePosition, outputSpeed, voyageStatus } from "../src/chat/sailing.ts";
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

test("gauge clamps at 300 tok/s and arrival takes priority over running", () => {
	assert.equal(-90 + gaugePosition(0) * 180, -90);
	assert.equal(-90 + gaugePosition(150) * 180, 0);
	assert.equal(-90 + gaugePosition(400) * 180, 90);
	assert.equal(voyageStatus(1, true), "已到港，建议新开会话");
	assert.equal(voyageStatus(.2, true), "航行中 running");
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
	assert.deepEqual(currentTurnStats(messages), { durationMs: 2000, output: 30, cost: .30000000000000004 });
	assert.deepEqual(currentTurnStats([...messages, { id: "next", role: "user", blocks: [] }]), {});
});
