import test from "node:test";
import assert from "node:assert/strict";
import { parseMessages, parseModels } from "../src/chat/parse.ts";
import { summarizeUsage, formatDuration } from "../src/chat/usage.ts";
import { readImages, MAX_IMAGE_BYTES } from "../src/chat/images.ts";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { PiRpc } from "../src/rpc/RpcClient.ts";
import { installMockPi } from "./mockPi.mjs";

test("usage includes cached input and counts reasoning only within output", () => {
	const messages = parseMessages([{ role: "assistant", usage: { input: 77984, cacheRead: 715968, cacheWrite: 0, output: 12249, reasoning: 8035 } }]);
	const usage = summarizeUsage(messages);
	assert.equal(usage.total, 806201);
	assert.equal(usage.answer, 4214);
	assert.equal(usage.inputTotal, 793952);
	assert.ok(Math.abs(usage.hitRate - 0.9018) < 0.0001);
	assert.equal(summarizeUsage(parseMessages([{ role: "assistant", usage: { input: 10, cacheWrite: 20, output: 5 } }])).total, 35);
	assert.equal(summarizeUsage([...messages, ...parseMessages([{ role: "assistant", usage: { output: 2 } }])]).reasoning, undefined);
	assert.equal(summarizeUsage([]).answer, undefined);
	assert.equal(formatDuration(172000), "2m 52s");
});

test("image history preserves safe image formats and rejects unsupported content", () => {
	const messages = parseMessages([{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }, { type: "image", mimeType: "image/svg+xml", data: "invalid" }] }]);
	assert.deepEqual(messages[0].blocks, [{ kind: "image", mimeType: "image/png", data: "aGVsbG8=" }]);
	assert.deepEqual(parseModels([{ id: "vision", provider: "local", input: ["text", "image", null] }])[0].input, ["text", "image"]);
});

test("attachments validate count, size and format before attempting reads", async () => {
	await assert.rejects(readImages([new File(["png"], "a.png", { type: "image/png" })], 4), /最多/);
	await assert.rejects(readImages([new File(["text"], "a.txt", { type: "text/plain" })], 0), /仅支持/);
	await assert.rejects(readImages([new File([], "a.png", { type: "image/png" })], 0), /不能为空/);
	await assert.rejects(readImages([new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "a.png", { type: "image/png" })], 0), /5 MiB/);
});

test("attachments read file bytes in order and retain names for the draft", async () => {
	const original = globalThis.FileReader;
	globalThis.FileReader = class {
		result = "";
		onload = () => {};
		onerror = () => {};
		readAsDataURL(file) {
			void file.arrayBuffer().then((bytes) => { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`; this.onload(); }).catch(() => this.onerror());
		}
	};
	try {
		const files = [new File(["first"], "first.png", { type: "image/png" }), new File(["second"], "second.jpg", { type: "image/jpeg" })];
		const images = await readImages(files, 0);
		assert.deepEqual(images.map((image) => [image.name, image.mimeType, image.data]), [["first.png", "image/png", "Zmlyc3Q="], ["second.jpg", "image/jpeg", "c2Vjb25k"]]);
		assert.notEqual(images[0].id, images[1].id);
	} finally { if (original === undefined) delete globalThis.FileReader; else globalThis.FileReader = original; }
});

test("reasoning commands and image-only prompts survive session restoration", async () => {
	globalThis.window = globalThis;
	installMockPi(window);
	const rpc = new PiRpc("capabilities");
	await rpc.start();
	assert.ok((await rpc.request({ type: "get_available_thinking_levels" })).levels.includes("low"));
	await rpc.request({ type: "set_thinking_level", level: "low" });
	assert.equal((await rpc.request({ type: "get_state" })).thinkingLevel, "low");
	const image = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };
	await rpc.request({ type: "prompt", message: "", images: [image] });
	await rpc.request({ type: "abort" });
	const { sessionFile } = await rpc.request({ type: "get_state" });
	await rpc.stop();
	const restored = new PiRpc("capabilities_restored");
	await restored.start();
	await restored.request({ type: "switch_session", sessionPath: sessionFile });
	assert.deepEqual((await restored.request({ type: "get_messages" })).messages[0].content, [image]);
	await restored.stop();
});

test("finalized provider errors reach the UI and settling clears streaming", () => {
	let state = reduce(initialSessionState, { type: "agent_start" });
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	state = reduce(state, { type: "message_end", message: { role: "assistant", content: [], errorMessage: "Unsupported reasoning effort" } });
	assert.equal(state.lastError, "Unsupported reasoning effort");
	state = reduce(state, { type: "agent_end" });
	assert.equal(state.isStreaming, false);
});
