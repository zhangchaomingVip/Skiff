import test from "node:test";
import assert from "node:assert/strict";
import { readArchivedMessages } from "../src/chat/archivePreview.ts";

test("archived transcript reads use only switch and get_messages RPC requests", async () => {
	const calls: Record<string, unknown>[] = [];
	const request = async <T,>(command: Record<string, unknown> & { type: string }): Promise<T> => {
		calls.push(command);
		if (command.type === "get_messages") return { messages: [{ role: "user", content: [{ type: "text", text: "question" }, { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] }, { role: "assistant", content: [{ type: "thinking", thinking: "reasoning" }, { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "file" } }, { type: "toolResult", toolCallId: "tool-1", name: "read", content: "result" }, { type: "text", text: "answer" }] }] } as T;
		return {} as T;
	};
	const messages = await readArchivedMessages(request, "archive.jsonl");
	assert.deepEqual(calls.map((call) => call.type), ["switch_session", "get_messages"]);
	assert.equal(calls[0].sessionPath, "archive.jsonl");
	assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
	assert.deepEqual(messages[0].blocks.map((block) => block.kind), ["text", "image"]);
	assert.deepEqual(messages[1].blocks.map((block) => block.kind), ["thinking", "tool", "toolResult", "text"]);
});
