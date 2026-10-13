import test from "node:test";
import assert from "node:assert/strict";
import { advanceVoyageContext, currentTurnStats, estimateContextTokens } from "../src/chat/sailing.ts";
import type { ChatMessage } from "../src/chat/types.ts";

const user: ChatMessage = { id: "user", role: "user", blocks: [] };
const request = (id: string, input: number, cacheRead = 0, cacheWrite = 0): ChatMessage => ({
	id, role: "assistant", streaming: true, blocks: [],
	usage: { input, cacheRead, cacheWrite, output: 20, reasoning: 5, totalTokens: 999999 },
});

test("context uses the latest request while cumulative input remains separate", () => {
	const first = request("first", 100, 40, 10);
	first.blocks = [{ kind: "tool", id: "read", name: "read", argsText: "file", done: true }, { kind: "toolResult", id: "read", name: "read", text: "result", isError: false }];
	const second = request("second", 60, 15, 5);
	const messages = [user, first, second];
	const reading = advanceVoyageContext(undefined, "voyage", messages);
	assert.equal(reading.context, 100);
	assert.equal(reading.input, 230);
	assert.equal(reading.lastRequestInput, 80);
	assert.equal(reading.estimated, true);
	assert.equal(currentTurnStats(messages).input, 230);
	assert.equal(currentTurnStats(messages).reasoning, 10);
});

test("repeated usage is idempotent and a newer request can lower context", () => {
	const first = request("first", 100, 40, 10);
	const initial = advanceVoyageContext(undefined, "voyage", [user, first]);
	const repeated = advanceVoyageContext(initial, "voyage", [user, first, first]);
	assert.equal(repeated.context, 170);
	assert.equal(repeated.inputs.size, 1);
	const regressed = advanceVoyageContext(repeated, "voyage", [user, { ...request("first", 0), usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, totalTokens: 0 } }]);
	assert.equal(regressed.context, 170);
	const next = advanceVoyageContext(regressed, "voyage", [user, request("first", 1), request("second", 60, 15, 5)]);
	assert.equal(next.context, 100);
	assert.equal(next.input, 81);
	assert.equal(initial.inputs.get("first"), 150);
	const missing = advanceVoyageContext(next, "voyage", [user, { ...first, usage: undefined }]);
	assert.equal(missing.context, 100);
	assert.equal(missing.estimated, true);
});

test("new voyage keys reset usage and earlier user turns never enter the total", () => {
	const old = advanceVoyageContext(undefined, "old", [user, request("first", 500)]);
	const messages = [user, request("first", 500), { ...user, id: "next" }, request("second", 10, 2, 3)];
	const next = advanceVoyageContext(old, "next", messages);
	assert.equal(next.context, 35);
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
	assert.equal(exact.context, 40);
	assert.equal(exact.estimated, true);
});

test("a larger local estimate stays marked until reported input catches up", () => {
	const estimated = advanceVoyageContext(undefined, "voyage", [{ ...user, blocks: [{ kind: "text", text: "问题".repeat(100) }] }]);
	const exact = advanceVoyageContext(estimated, "voyage", [user, request("first", 10)]);
	assert.equal(exact.context, 30);
	assert.equal(exact.input, 10);
	assert.equal(exact.estimated, true);
	const caughtUp = advanceVoyageContext(exact, "voyage", [user, request("first", 200)]);
	assert.equal(caughtUp.context, 220);
	assert.equal(caughtUp.estimated, true);
});

test("reported input takes precedence over larger message content, including exact zero", () => {
	const messages: ChatMessage[] = [{ ...user, blocks: [{ kind: "text", text: "问题".repeat(100) }] }, request("first", 10)];
	assert.equal(advanceVoyageContext(undefined, "voyage", messages).context, 30);
	const zero = advanceVoyageContext(undefined, "zero", [user, { ...request("first", 0), usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, totalTokens: 0 } }]);
	assert.equal(zero.context, undefined);
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
		assert.equal(advanceVoyageContext(exact, "voyage", [user, invalid]).context, 70);
	}
});

test("pi context snapshot stays separate from the seven-request cumulative sample", () => {
	const rows = [[554, 29440, 0, 237], [456, 29952, 0, 192], [543, 30208, 0, 633], [718, 30720, 0, 193], [523, 31232, 0, 184], [314, 31744, 0, 154], [401, 32000, 0, 278]];
	const messages = [user, ...rows.map(([input, cacheRead, cacheWrite, output], index) => ({
		id: `request-${index}`, role: "assistant" as const, blocks: [],
		usage: { input, cacheRead, cacheWrite, output, totalTokens: input + cacheRead + cacheWrite + output },
	}))];
	const reading = advanceVoyageContext(undefined, "sample", messages, { tokens: 32679, contextWindow: 128000, source: "pi", estimated: true, version: 1 });
	assert.equal(reading.input, 218805);
	assert.equal(reading.lastRequestInput, 32401);
	assert.equal(reading.context, 32679);
	assert.equal(reading.source, "pi");
});

test("an explicit null pi snapshot does not resurrect the previous context", () => {
	const previous = advanceVoyageContext(undefined, "sample", [user, request("first", 50)]);
	const cleared = advanceVoyageContext(previous, "sample", [user, request("first", 50)], { tokens: null, contextWindow: 128000, source: "pi", estimated: false, version: 2 });
	assert.equal(cleared.context, undefined);
	assert.equal(cleared.source, "pi");
});
