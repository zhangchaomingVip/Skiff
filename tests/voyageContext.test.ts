import test from "node:test";
import assert from "node:assert/strict";
import { advanceVoyageContext, currentTurnStats, estimateContextTokens } from "../src/chat/sailing.ts";
import type { ChatMessage } from "../src/chat/types.ts";

const user: ChatMessage = { id: "user", role: "user", blocks: [] };
const request = (id: string, input: number, cacheRead = 0, cacheWrite = 0): ChatMessage => ({
	id, role: "assistant", streaming: true, blocks: [],
	usage: { input, cacheRead, cacheWrite, output: 20, reasoning: 5, totalTokens: 999999 },
});

test("context sums complete input across tool round trips, independently of output and totalTokens", () => {
	const first = request("first", 100, 40, 10);
	first.blocks = [{ kind: "tool", id: "read", name: "read", argsText: "file", done: true }, { kind: "toolResult", id: "read", name: "read", text: "result", isError: false }];
	const second = request("second", 60, 15, 5);
	const messages = [user, first, second];
	const reading = advanceVoyageContext(undefined, "voyage", messages);
	assert.equal(reading.context, 230);
	assert.equal(reading.input, 230);
	assert.equal(reading.estimated, false);
	assert.equal(currentTurnStats(messages).input, 230);
	assert.equal(currentTurnStats(messages).reasoning, 10);
});

test("repeated and smaller usage retain per-request maxima when a later request arrives", () => {
	const first = request("first", 100, 40, 10);
	const initial = advanceVoyageContext(undefined, "voyage", [user, first]);
	const repeated = advanceVoyageContext(initial, "voyage", [user, first, first]);
	assert.equal(repeated.context, 150);
	assert.equal(repeated.inputs.size, 1);
	const regressed = advanceVoyageContext(repeated, "voyage", [user, request("first", 0)]);
	assert.equal(regressed.context, 150);
	const next = advanceVoyageContext(regressed, "voyage", [user, request("first", 1), request("second", 60, 15, 5)]);
	assert.equal(next.context, 230);
	assert.equal(next.input, 230);
	assert.equal(initial.inputs.get("first"), 150);
	const missing = advanceVoyageContext(next, "voyage", [user, { ...first, usage: undefined }]);
	assert.equal(missing.context, 230);
	assert.equal(missing.estimated, false);
});

test("new voyage keys reset usage and earlier user turns never enter the total", () => {
	const old = advanceVoyageContext(undefined, "old", [user, request("first", 500)]);
	const messages = [user, request("first", 500), { ...user, id: "next" }, request("second", 10, 2, 3)];
	const next = advanceVoyageContext(old, "next", messages);
	assert.equal(next.context, 15);
	assert.equal(next.inputs.has("first"), false);
	assert.equal(advanceVoyageContext(next, "empty", []).context, undefined);
});

test("without usage, text, reasoning, tool arguments and tool results enter the estimate", () => {
	const messages: ChatMessage[] = [
		{ ...user, blocks: [{ kind: "text", text: "问题" }] },
		{ id: "first", role: "assistant", blocks: [
			{ kind: "thinking", text: "思考" }, { kind: "text", text: "abcd" },
			{ kind: "tool", id: "call", name: "read", argsText: "abcdefgh", done: true },
			{ kind: "toolResult", id: "call", name: "read", text: "工具结果", isError: false },
		] },
	];
	assert.equal(estimateContextTokens(messages), 11);
	const estimated = advanceVoyageContext(undefined, "voyage", messages);
	assert.equal(estimated.context, 11);
	assert.equal(estimated.input, undefined);
	assert.equal(estimated.estimated, true);
	assert.equal(advanceVoyageContext(estimated, "voyage", [user]).context, 11);
	const exact = advanceVoyageContext(estimated, "voyage", [...messages, request("second", 20)]);
	assert.equal(exact.context, 20);
	assert.equal(exact.estimated, false);
});

test("a larger local estimate stays marked until reported input catches up", () => {
	const estimated = advanceVoyageContext(undefined, "voyage", [{ ...user, blocks: [{ kind: "text", text: "问题".repeat(100) }] }]);
	const exact = advanceVoyageContext(estimated, "voyage", [user, request("first", 10)]);
	assert.equal(exact.context, 200);
	assert.equal(exact.input, 10);
	assert.equal(exact.estimated, true);
	const caughtUp = advanceVoyageContext(exact, "voyage", [user, request("first", 200)]);
	assert.equal(caughtUp.context, 200);
	assert.equal(caughtUp.estimated, false);
});

test("reported input takes precedence over larger message content, including exact zero", () => {
	const messages: ChatMessage[] = [{ ...user, blocks: [{ kind: "text", text: "问题".repeat(100) }] }, request("first", 10)];
	assert.equal(advanceVoyageContext(undefined, "voyage", messages).context, 10);
	const zero = advanceVoyageContext(undefined, "zero", [user, request("first", 0)]);
	assert.equal(zero.context, 0);
	assert.equal(zero.estimated, false);
});

test("invalid input channels fall back to estimation and cannot poison a retained reading", () => {
	for (const input of [NaN, Infinity, -1]) {
		const invalid = request("invalid", input);
		invalid.blocks = [{ kind: "text", text: "abcd" }];
		const reading = advanceVoyageContext(undefined, "voyage", [user, invalid]);
		assert.equal(reading.context, 1);
		assert.equal(reading.estimated, true);
		const exact = advanceVoyageContext(undefined, "voyage", [user, request("first", 50)]);
		assert.equal(advanceVoyageContext(exact, "voyage", [user, invalid]).context, 50);
	}
});
