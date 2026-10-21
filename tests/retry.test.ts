import test from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState, type SessionState } from "../src/chat/types.ts";

function failedAttempt(state: SessionState, errorMessage = "503 server busy"): SessionState {
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	return reduce(state, { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage } });
}

test("retry progress preserves the run, anchors all five attempts and clears transient errors on recovery", () => {
	let state = reduce(initialSessionState, { type: "agent_start", startedAt: 1000 });
	state = reduce(state, { type: "message_start", message: { role: "user", content: "work" } });
	const run = state.activeRun;
	for (let attempt = 1; attempt <= 5; attempt++) {
		state = failedAttempt(state);
		const failedMessage = state.messages[state.messages.length - 1];
		state = reduce(state, { type: "auto_retry_start", attempt, maxAttempts: 5, errorMessage: "503 server busy" });
		assert.equal(state.retrying, true);
		assert.equal(state.lastError, undefined);
		assert.equal(state.lastOutcome, undefined);
		assert.equal(state.activeRun, run);
		assert.equal(state.isStreaming, true);
		assert.equal(state.retryAttempts?.[attempt - 1].afterMessageId, failedMessage.id);
	}
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	state = reduce(state, { type: "message_end", message: { role: "assistant", content: "recovered", stopReason: "stop" } });
	state = reduce(state, { type: "auto_retry_end", success: true });
	state = reduce(state, { type: "agent_settled" });
	assert.equal(state.lastError, undefined);
	assert.equal(state.retrying, false);
	assert.equal(state.retryAttempts?.length, 5);
	assert.equal(state.messages.filter((message) => message.role === "user").length, 1);
});

test("exhaustion, cancellation and process exit terminate retry state; a new prompt resets progress", () => {
	let state = failedAttempt(initialSessionState);
	state = reduce(state, { type: "auto_retry_start", attempt: 5, maxAttempts: 5 });
	state = reduce(state, { type: "auto_retry_end", success: false, finalError: "503 still busy" });
	assert.equal(state.retrying, false);
	assert.equal(state.lastError, "503 still busy");
	state = reduce(state, { type: "prompt_start", promptId: "new", startedAt: 2000, message: { id: "new-user", role: "user", blocks: [] } });
	assert.deepEqual(state.retryAttempts, []);
	assert.equal(state.lastError, undefined);
	state = reduce(state, { type: "auto_retry_start", attempt: 1, maxAttempts: 5 });
	state = reduce(state, { type: "auto_retry_end", success: false, finalError: "Retry cancelled" });
	assert.equal(state.lastError, undefined);
	state = reduce(state, { type: "agent_settled" });
	assert.equal(state.retrying, false);
	state = reduce(state, { type: "auto_retry_start", attempt: 1, maxAttempts: 5 });
	state = reduce(state, { type: "bridge_exit", message: "pi exited" });
	assert.equal(state.retrying, false);
	assert.equal(state.lastError, "pi exited");
});

test("malformed retry events do not enter maintenance state", () => {
	for (const attempt of [0, -1, 6, 1.5, Infinity]) assert.equal(reduce(initialSessionState, { type: "auto_retry_start", attempt, maxAttempts: 5 }), initialSessionState);
});
