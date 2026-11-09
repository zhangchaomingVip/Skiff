import test from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState, type SessionState } from "../src/chat/types.ts";
import { parseMessages } from "../src/chat/parse.ts";
import { supersededReplyIds, turnReplyText } from "../src/chat/turns.ts";

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
		assert.equal(state.retryAttempts?.[attempt - 1].status, "retrying");
		if (attempt > 1) assert.equal(state.retryAttempts?.[attempt - 2].status, "retried");
		assert.equal(failedMessage.errorMessage, "503 server busy");
	}
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	state = reduce(state, { type: "message_end", message: { role: "assistant", content: "recovered", stopReason: "stop" } });
	state = reduce(state, { type: "auto_retry_end", success: true });
	state = reduce(state, { type: "agent_settled" });
	assert.equal(state.lastError, undefined);
	assert.equal(state.retrying, false);
	assert.equal(state.retryAttempts?.length, 5);
	assert.equal(state.retryAttempts?.[4].status, "recovered");
	assert.equal(state.messages.filter((message) => message.role === "user").length, 1);
});

test("exhaustion, cancellation and process exit terminate retry state; a new prompt resets progress", () => {
	let state = failedAttempt(initialSessionState);
	state = reduce(state, { type: "auto_retry_start", attempt: 5, maxAttempts: 5 });
	state = reduce(state, { type: "auto_retry_end", success: false, finalError: "503 still busy" });
	assert.equal(state.retrying, false);
	assert.equal(state.lastError, "503 still busy");
	assert.equal(state.retryAttempts?.[0].status, "failed");
	state = reduce(state, { type: "prompt_start", promptId: "new", startedAt: 2000, message: { id: "new-user", role: "user", blocks: [] } });
	assert.deepEqual(state.retryAttempts, []);
	assert.equal(state.lastError, undefined);
	state = reduce(state, { type: "auto_retry_start", attempt: 1, maxAttempts: 5 });
	state = reduce(state, { type: "auto_retry_end", success: false, finalError: "Retry cancelled" });
	assert.equal(state.lastError, undefined);
	assert.equal(state.retryAttempts?.[0].status, "cancelled");
	state = reduce(state, { type: "agent_settled" });
	assert.equal(state.retrying, false);
	state = reduce(state, { type: "auto_retry_start", attempt: 1, maxAttempts: 5 });
	state = reduce(state, { type: "bridge_exit", message: "pi exited" });
	assert.equal(state.retrying, false);
	assert.equal(state.lastError, "pi exited");
	assert.equal(state.retryAttempts?.[state.retryAttempts.length - 1].status, "cancelled");
});

test("provider errors survive cancellation, new prompts and history restore", () => {
	const errorMessage = '503: {"message":"No available workers (all circuits open or unhealthy)","code":"no_available_workers"}';
	let state = failedAttempt(initialSessionState, errorMessage);
	state = reduce(state, { type: "auto_retry_start", attempt: 1, maxAttempts: 5, errorMessage });
	state = reduce(state, { type: "auto_retry_end", success: false, finalError: "Retry cancelled" });
	assert.equal(state.retryAttempts?.[0].error, errorMessage);
	assert.equal(state.messages[0].errorMessage, errorMessage);
	state = reduce(state, { type: "prompt_start", promptId: "next", startedAt: 2000, message: { id: "next", role: "user", blocks: [] } });
	assert.equal(state.messages[0].errorMessage, errorMessage);
	assert.equal(parseMessages([{ role: "assistant", content: [], stopReason: "error", errorMessage }])[0].errorMessage, errorMessage);
});

test("malformed retry events do not enter maintenance state", () => {
	for (const attempt of [0, -1, 6, 1.5, Infinity]) assert.equal(reduce(initialSessionState, { type: "auto_retry_start", attempt, maxAttempts: 5 }), initialSessionState);
});

test("history recovers omitted retry errors only from the active branch without duplicating final errors", () => {
	const user = { role: "user", content: "work", timestamp: 1794191000000 };
	const failure = { role: "assistant", content: [], timestamp: user.timestamp + 1000, stopReason: "error", errorMessage: "503 no_available_workers" };
	const final = { ...failure, timestamp: user.timestamp + 2000 };
	const history = { leafId: "final", entries: [
		{ id: "user", parentId: null, type: "message", message: user },
		{ id: "other-branch", parentId: "user", type: "message", message: { ...failure, errorMessage: "401 other branch" } },
		{ id: "retry", parentId: "user", type: "message", message: failure },
		{ id: "omission", parentId: "retry", type: "context_edit" },
		{ id: "final", parentId: "omission", type: "message", message: final },
	] };
	assert.deepEqual(parseMessages([user, final], history).map((message) => message.errorMessage), [undefined, failure.errorMessage, final.errorMessage]);
	assert.equal(parseMessages([user], { ...history, leafId: "omission" })[1].errorMessage, failure.errorMessage, "Cancelled backoff retains its omitted provider error");
});

test("a retried partial reply is superseded only after replacement content arrives, without changing the transcript", () => {
	let state = reduce(initialSessionState, { type: "message_start", message: { role: "user", content: "检查配置" } });
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	state = reduce(state, { type: "message_end", message: { role: "assistant", content: "首先检查配置。未完成", stopReason: "error", usage: { input: 10, output: 5 } } });
	const failed = state.messages[1];
	state = reduce(state, { type: "auto_retry_start", attempt: 1, maxAttempts: 5, errorMessage: "request timeout" });
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	assert.equal(supersededReplyIds(state.messages).size, 0);
	assert.equal(turnReplyText(state.messages), "首先检查配置。未完成");
	state = reduce(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "首先检查配置。完整结论。" } });
	assert.deepEqual([...supersededReplyIds(state.messages)], [failed.id]);
	assert.equal(turnReplyText(state.messages), "首先检查配置。完整结论。");
	assert.equal(state.messages[1], failed);
	assert.equal(state.messages[1].usage?.output, 5);
	assert.equal(state.messages[1].blocks[0].kind === "text" && state.messages[1].blocks[0].text, "首先检查配置。未完成");
});

test("restored retries use the same display/copy policy and keep the last failed partial on exhaustion", () => {
	const raw = [
		{ role: "user", content: "检查配置" },
		{ role: "assistant", content: "第一个失败片段", stopReason: "error" },
		{ role: "assistant", content: "最后一个失败片段", stopReason: "error" },
	];
	const exhausted = parseMessages(raw);
	assert.deepEqual([...supersededReplyIds(exhausted)], [exhausted[1].id]);
	assert.equal(turnReplyText(exhausted), "最后一个失败片段");
	const restored = parseMessages([...raw, { role: "assistant", content: "完整结论", stopReason: "stop" }]);
	assert.equal(supersededReplyIds(restored).size, 2);
	assert.equal(turnReplyText(restored), "完整结论");
});

test("retry projection keeps successful tool steps, manual stops and failures from earlier user turns", () => {
	const messages = parseMessages([
		{ role: "user", content: "上一轮" },
		{ role: "assistant", content: "上一轮失败片段", stopReason: "error" },
		{ role: "user", content: "当前轮" },
		{ role: "assistant", content: "先读取文件", stopReason: "toolUse" },
		{ role: "assistant", content: "失败片段", stopReason: "error" },
		{ role: "assistant", content: "手动停止的片段", stopReason: "aborted" },
		{ role: "assistant", content: "续写结果", stopReason: "stop" },
	]);
	assert.deepEqual([...supersededReplyIds(messages)], [messages[4].id]);
	assert.equal(turnReplyText(messages), "上一轮失败片段\n\n先读取文件\n\n手动停止的片段\n\n续写结果");
	const stoppedBeforeToken = parseMessages([
		{ role: "user", content: "检查配置" },
		{ role: "assistant", content: "保留有用的片段", stopReason: "error" },
		{ role: "assistant", content: "  ", stopReason: "aborted" },
	]);
	assert.equal(supersededReplyIds(stoppedBeforeToken).size, 0);
	assert.equal(turnReplyText(stoppedBeforeToken), "保留有用的片段");
});
