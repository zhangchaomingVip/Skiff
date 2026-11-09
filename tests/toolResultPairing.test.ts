import test from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/chat/reducer.ts";
import { parseMessages } from "../src/chat/parse.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { processBlocks } from "../src/chat/turnProcess.ts";
import { pendingToolCallId, voyagePhase } from "../src/chat/sailing.ts";

test("reused IDs after compaction pair with the latest assistant in live and restored history", () => {
	const call = (id: string, command: string) => ({ type: "toolCall", id, name: "bash", arguments: { command } });
	const result = (toolCallId: string, content: string) => ({ role: "toolResult", toolCallId, toolName: "bash", content });
	const raw = [
		{ role: "user", content: "work" },
		{ role: "assistant", content: [call("bash:44", "old"), call("bash:45", "old parallel")] },
		result("bash:45", "old second"), result("bash:44", "old first"),
		{ role: "assistant", content: [call("bash:44", "new"), call("bash:45", "new parallel")] },
		result("bash:45", "new second"), result("bash:44", "new first"),
	];
	let state = initialSessionState;
	for (const [index, message] of raw.entries()) {
		if (message.role !== "toolResult") state = reduce(state, { type: "message_start", message });
		state = reduce(state, { type: "message_end", message });
		if (index === 4) {
			assert.equal(pendingToolCallId(state.messages), "bash:45");
			assert.equal(voyagePhase(state.messages), "tool");
		}
	}
	for (const messages of [state.messages, parseMessages(raw)]) {
		const assistants = messages.filter((message) => message.role === "assistant");
		assert.deepEqual(assistants.map((message) => processBlocks(message).map((entry) => entry.result?.text)), [["old first", "old second"], ["new first", "new second"]]);
		assert.equal(pendingToolCallId(messages), undefined);
		assert.equal(voyagePhase(messages), "response");
	}
});
