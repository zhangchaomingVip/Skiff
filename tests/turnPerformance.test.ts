import test from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/chat/reducer.ts";
import { parseMessages } from "../src/chat/parse.ts";
import { initialSessionState, type ChatMessage } from "../src/chat/types.ts";
import { attachHistoricalPerformances, normalizeTurnPerformances, performancesForMessages } from "../src/chat/turnPerformance.ts";
import { normalizeWorkspace } from "../src/chat/workspace.ts";

const user = { role: "user", content: "保留性能记录", timestamp: 1700000000000 };
const assistant = { role: "assistant", provider: "mock", model: "model", content: [{ type: "text", text: "完成" }], usage: { input: 10, cacheRead: 0, cacheWrite: 0, output: 100, reasoning: 20, totalTokens: 110 } };
function complete() {
	let state = reduce(initialSessionState, { type: "prompt_start", startedAt: 1000, promptId: "performance", message: { id: "user", role: "user", blocks: [{ kind: "text", text: user.content }] } });
	state = reduce(state, { type: "message_start", message: user, voyageAt: 1000 });
	state = reduce(state, { type: "agent_start", voyageAt: 1000 });
	state = reduce(state, { type: "message_start", message: { role: "assistant" }, voyageAt: 1000 });
	state = reduce(state, { type: "message_update", voyageAt: 1380, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "完成" } });
	state = reduce(state, { type: "message_end", message: assistant, voyageAt: 2380 });
	return reduce(state, { type: "agent_settled", voyageAt: 2380, durationMs: 1380, completedAt: 2380 });
}

test("settling stores TTFT and decode speed on the completed reply, independently of the mounted dashboard", () => {
	const state = complete();
	assert.equal(state.isStreaming, false);
	assert.equal(state.messages[1].performance?.ttftMs, 380);
	assert.equal(state.messages[1].performance?.decodeMs, 1000);
	assert.equal(state.messages[1].performance?.averageSpeed, 80);
	assert.equal(state.messages[1].performance?.averageEstimated, false);
});

test("workspace round-trip restores performance despite new history IDs and completion timestamps", () => {
	const state = complete();
	const workspace = normalizeWorkspace(JSON.parse(JSON.stringify({ version: 1, projects: [{ id: "p", name: "p", path: "D:/mock" }], chats: [{ id: "c", projectId: "p", title: "c", updatedAt: 1, hasMessages: true, turnPerformances: performancesForMessages(state.messages) }], activeId: "c" })));
	const restored = attachHistoricalPerformances(parseMessages([user, assistant]), workspace!.chats[0].turnPerformances);
	assert.notEqual(restored[1].id, state.messages[1].id);
	assert.deepEqual(restored[1].performance, state.messages[1].performance);
	assert.equal(attachHistoricalPerformances(parseMessages([{ ...user, content: "另一个问题" }, assistant]), workspace!.chats[0].turnPerformances)[1].performance, undefined);
	assert.equal(attachHistoricalPerformances(parseMessages([user, { ...assistant, content: "另一条回答" }]), workspace!.chats[0].turnPerformances)[1].performance, undefined);
});

test("the next prompt and a run without visible output cannot inherit the previous turn's timing", () => {
	let state = complete();
	state = reduce(state, { type: "prompt_start", startedAt: 4000, promptId: "next", message: { id: "next", role: "user", blocks: [] } });
	state = reduce(state, { type: "message_start", message: { role: "user", content: "下一轮" }, voyageAt: 4000 });
	state = reduce(state, { type: "message_start", message: { role: "assistant" }, voyageAt: 4000 });
	state = reduce(state, { type: "agent_settled", voyageAt: 5000 });
	assert.equal(state.messages[3].performance, undefined);
	assert.equal(state.messages[1].performance?.ttftMs, 380);
});

test("malformed performance fields are discarded and unrelated properties never enter the stored receipt", () => {
	const receipt = complete().messages[1].performance!;
	assert.deepEqual(normalizeTurnPerformances([null, { ...receipt, apiKey: "discard" }, { ...receipt, ttftMs: -1 }, { ...receipt, averageSpeed: Infinity }]), [null, receipt, null, { ...receipt, averageSpeed: undefined }]);
	const legacy: ChatMessage[] = parseMessages([user, assistant]);
	assert.equal(attachHistoricalPerformances(legacy, undefined), legacy);
});
