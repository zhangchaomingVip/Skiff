import test from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState, type ChatMessage, type SessionState } from "../src/chat/types.ts";
import { currentTurnStats } from "../src/chat/sailing.ts";
import { groupTurns } from "../src/chat/turns.ts";

function startTurn(state: SessionState, startedAt: number): SessionState {
	state = reduce(state, { type: "agent_start", startedAt });
	return reduce(state, { type: "message_start", message: { role: "user" } });
}

test("run timing survives reasoning, tool waits, multiple steps and duplicate starts", () => {
	let state = startTurn(initialSessionState, 1000);
	const run = state.activeRun;
	assert.equal(run?.turnId, `turn:${state.messages[0].id}`);
	state = reduce(state, { type: "message_start", message: { role: "assistant", timestamp: 1200 } });
	state = reduce(state, { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
	state = reduce(state, { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "tool", name: "read", arguments: {} }] } });
	assert.equal(state.isStreaming, true);
	state = reduce(state, { type: "message_end", message: { role: "toolResult", toolCallId: "tool", toolName: "read", content: [{ type: "text", text: "ok" }] } });
	state = reduce(state, { type: "agent_start", startedAt: 4000 });
	state = reduce(state, { type: "message_start", message: { role: "assistant", timestamp: 5000 } });
	assert.equal(state.activeRun, run);
	assert.equal(state.messages.every((message) => message.durationMs === undefined), true);
});

for (const type of ["agent_end", "agent_settled", "bridge_exit"]) {
	test(`${type} freezes the current turn once and finalizes streamed content`, () => {
		let state = startTurn(initialSessionState, 1000);
		state = reduce(state, { type: "message_start", message: { role: "assistant", timestamp: 1200 } });
		state = reduce(state, { type: "message_start", message: { role: "assistant", timestamp: 4000 } });
		state = reduce(state, { type, durationMs: 6200, completedAt: 7200, message: "pi exited" });
		assert.equal(state.isStreaming, false);
		assert.equal(state.activeRun, undefined);
		assert.equal(state.messages.every((message) => !message.streaming), true);
		assert.equal(state.messages[1].durationMs, undefined);
		assert.equal(state.messages[2].durationMs, 6200);
		assert.equal(state.messages[2].timestamp, 7200);
		assert.equal(currentTurnStats(state.messages).durationMs, 6200);
		assert.equal(groupTurns(state.messages)[1].durationMs, 6200);
		if (type === "bridge_exit") assert.equal(state.lastError, "pi exited");
		const final = state.messages[2];
		state = reduce(state, { type: "agent_settled", durationMs: 9999, completedAt: 10999 });
		assert.equal(state.messages[2], final);
	});
}

test("a new run without an assistant never overwrites the preceding turn", () => {
	let state = startTurn(initialSessionState, 1000);
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	state = reduce(state, { type: "agent_end", durationMs: 2000, completedAt: 3000 });
	const previous = state.messages[1];
	state = reduce(state, { type: "agent_start", startedAt: 4000 });
	assert.equal(state.activeRun?.turnId, undefined);
	state = reduce(state, { type: "agent_end", durationMs: 500, completedAt: 4500 });
	assert.equal(state.messages[1], previous);
	state = startTurn(state, 5000);
	state = reduce(state, { type: "bridge_exit", durationMs: 300, completedAt: 5300, message: "pi exited" });
	assert.equal(state.messages[1], previous);
	state = reduce(state, { type: "turn_duration", durationMs: 9999 });
	assert.equal(state.messages[1], previous);
});

test("an assistant-only run can settle without a user timestamp", () => {
	let state = reduce(initialSessionState, { type: "agent_start", startedAt: 1000 });
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	assert.equal(state.activeRun?.turnId, `turn:${state.messages[0].id}`);
	state = reduce(state, { type: "agent_end", durationMs: 2000 });
	assert.equal(state.messages[0].durationMs, 2000);
});

function submit(state: SessionState, id = "send"): SessionState {
	const message: ChatMessage = { id: `pending_${id}`, role: "user", timestamp: 1000, blocks: [{ kind: "text", text: "hello" }, { kind: "image", data: "image-data", mimeType: "image/png" }] };
	return reduce(state, { type: "prompt_start", promptId: id, startedAt: 1000, message });
}

test("submission displays text and images without adding optimistic messages to history or usage", () => {
	const state = submit(initialSessionState);
	assert.equal(state.messages, initialSessionState.messages);
	assert.equal(state.isStreaming, true);
	assert.deepEqual(state.activeRun, { startedAt: 1000, turnId: "turn:pending_send", promptId: "send" });
	assert.equal(state.pendingPrompt?.userMessage?.blocks.length, 2);
	assert.deepEqual(currentTurnStats(state.messages), {});
});

test("pi confirmation replaces the optimistic user and keeps the send-time origin through a pure-text reply", () => {
	let state = submit(initialSessionState);
	state = reduce(state, { type: "agent_start", startedAt: 4000 });
	assert.equal(state.activeRun?.startedAt, 1000);
	state = reduce(state, { type: "message_start", message: { role: "user", content: "hello", timestamp: 4000 } });
	assert.equal(state.messages.length, 1);
	assert.equal(state.messages[0].id, "pending_send");
	assert.equal(state.pendingPrompt?.userMessage, undefined);
	assert.equal(state.activeRun?.turnId, "turn:pending_send");
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	assert.equal(state.pendingPrompt, undefined);
	state = reduce(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "reply" } });
	assert.equal(groupTurns(state.messages)[1].stepCount, 0);
	state = reduce(state, { type: "agent_end", durationMs: 6000, completedAt: 7000 });
	assert.equal(state.messages[1].durationMs, 6000);
	assert.equal(state.pendingPrompt, undefined);
	assert.equal(state.activeRun, undefined);
});

test("failed or cancelled submissions clear only their own ephemeral state", () => {
	const first = submit(initialSessionState, "first");
	const cancelled = reduce(first, { type: "prompt_cancel", promptId: "first" });
	assert.equal(cancelled.messages, initialSessionState.messages);
	assert.equal(cancelled.activeRun, undefined);
	assert.equal(cancelled.pendingPrompt, undefined);
	assert.equal(cancelled.isStreaming, false);
	const next = submit(cancelled, "next");
	assert.equal(reduce(next, { type: "prompt_cancel", promptId: "first" }), next);
});

test("settling before confirmation removes optimistic rows without overwriting the preceding turn", () => {
	let state = startTurn(initialSessionState, 100);
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	state = reduce(state, { type: "agent_end", durationMs: 500 });
	const previous = state.messages[1];
	for (const type of ["agent_end", "agent_settled", "bridge_exit"]) {
		const finished = reduce(submit(state), { type, durationMs: 5000 });
		assert.equal(finished.messages[1], previous);
		assert.equal(finished.pendingPrompt, undefined);
		assert.equal(finished.activeRun, undefined);
	}
});
