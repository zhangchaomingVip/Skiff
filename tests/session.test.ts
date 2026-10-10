import test from "node:test";
import assert from "node:assert/strict";
import { parseMessages, parseModels } from "../src/chat/parse.ts";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { PiRpc } from "../src/rpc/RpcClient.ts";
import { installMockPi } from "./mockPi.mjs";

test("history restores the active transcript and attaches tool results", () => {
	const messages = parseMessages([
		{ role: "system", content: "hidden" },
		{ role: "user", content: "inspect" },
		{ role: "assistant", content: [{ type: "thinking", thinking: "plan" }, { type: "toolCall", id: "read1", name: "read", arguments: { path: "README.md" } }] },
		{ role: "toolResult", toolName: "read", content: [{ type: "text", text: "# Skiff" }], isError: false },
	]);
	assert.equal(messages.length, 2);
	assert.equal(messages[1].blocks[2].kind, "toolResult");
	assert.equal(messages[1].blocks[2].text, "# Skiff");
	assert.deepEqual(parseMessages(null), []);
});

test("streamed assistant text finalizes once and retains subsequent tool results", () => {
	let state = reduce(initialSessionState, { type: "agent_start" });
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	for (const delta of ["Hello", " world"]) state = reduce(state, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta } });
	assert.equal(state.messages[0].blocks[0].text, "Hello world");
	state = reduce(state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] } });
	state = reduce(state, { type: "message_end", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "ok" }] } });
	state = reduce(state, { type: "agent_end" });
	assert.equal(state.messages.length, 1);
	assert.equal(state.messages[0].blocks.length, 2);
	assert.equal(state.isStreaming, false);
});

test("models come from pi, including custom providers; invalid descriptors are excluded", () => {
	assert.deepEqual(parseModels([{ provider: "custom", id: "local-model" }, { id: "missing-provider" }, null]).map((m) => m.id), ["local-model"]);
	assert.equal(parseModels([{ provider: "custom", id: "local-model", contextWindow: 64000, maxTokens: 32768 }])[0].maxTokens, 32768);
});

test("RPC listeners precede startup; sessions restore and transport failures reject promptly", async () => {
	globalThis.window = globalThis;
	const mock = installMockPi(window);
	const rpc = new PiRpc("test_chat");
	await rpc.start({ cwd: "D:\\workspace\\Skiff" });
	assert.equal(mock.commands[0].command, "plugin:event|listen");
	assert.equal(mock.commands[1].args.options.piPath, null);
	const events = [];
	rpc.onEvent((event) => events.push(event));
	await rpc.request({ type: "prompt", message: "Inspect project" });
	await rpc.request({ type: "abort" });
	const { sessionFile } = await rpc.request({ type: "get_state" });
	assert.ok(events.some((e) => e.type === "agent_start"));
	mock.failNextSend();
	await assert.rejects(rpc.request({ type: "get_state" }), /Simulated transport failure/);
	await assert.rejects(rpc.request({ type: "never_reply" }, 10), /RPC timeout/);
	await rpc.stop();
	const restored = new PiRpc("restored_chat");
	await restored.start({ cwd: "D:\\workspace\\Skiff" });
	await restored.request({ type: "switch_session", sessionPath: sessionFile });
	const { messages } = await restored.request({ type: "get_messages" });
	assert.equal(messages[0].content, "Inspect project");
	assert.deepEqual(await restored.request({ type: "switch_session", sessionPath: "cancelled.jsonl" }), { cancelled: true });
	await assert.rejects(restored.request({ type: "switch_session", sessionPath: "missing.jsonl" }), /Session file missing/);
	await restored.stop();
	assert.equal(mock.processes.size, 0);
	assert.equal(mock.listeners.size, 0);
});

test("bridge exit rejects pending requests instead of leaving the UI waiting", async () => {
	globalThis.window = globalThis;
	const mock = installMockPi(window);
	const rpc = new PiRpc("exiting_chat");
	await rpc.start();
	const waiting = rpc.request({ type: "never_reply" });
	const rejected = assert.rejects(waiting, /pi exited/);
	mock.emit("exiting_chat", { type: "bridge_exit", message: "pi exited" });
	await rejected;
	await rpc.stop();
});

test("navigation teardown rejects outstanding RPC and clears its timeout immediately", async () => {
	globalThis.window = globalThis;
	const mock = installMockPi(window);
	const rpc = new PiRpc("switching_chat");
	await rpc.start();
	const waiting = rpc.request({ type: "never_reply" });
	const rejected = assert.rejects(waiting, /RPC stopped/);
	await rpc.stop();
	await rejected;
	assert.equal(mock.processes.size, 0);
	assert.equal(mock.listeners.size, 0);
	assert.equal(mock.callbacks.size, 0);
});
