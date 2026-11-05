// Real pi + isolated loopback providers: each protocol applies model switches.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = process.argv[2];
if (!cli) throw new Error("Usage: node tests/pi.protocol-models.integration.mjs <pi-cli.js>");
const directory = await mkdtemp(join(tmpdir(), "skiff-protocol-models-"));
const requests = [];
const reply = "protocol model switches work";
const sse = (events) => events.map((event) => `${event.type ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join("");
const server = createServer(async (request, response) => {
	let body = ""; for await (const chunk of request) body += chunk;
	const payload = JSON.parse(body);
	const api = request.url.split("/")[1];
	const streaming = api.startsWith("google") ? request.url.includes(":streamGenerateContent") : payload.stream;
	requests.push({ api, url: request.url, payload, headers: request.headers, streaming });
	let completion; let events;
	if (api === "anthropic-messages") {
		completion = { id: "msg_local", type: "message", role: "assistant", model: payload.model, content: [{ type: "text", text: reply }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } };
		events = [{ type: "message_start", message: { ...completion, content: [] } }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: completion.usage }, { type: "message_stop" }];
	} else if (api === "openai-responses") {
		completion = { id: "resp_local", object: "response", status: "completed", model: payload.model, output: [{ id: "msg_local", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: reply, annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12, input_tokens_details: { cached_tokens: 0 } } };
		events = [{ type: "response.created", response: completion }, { type: "response.output_item.done", output_index: 0, item: completion.output[0] }, { type: "response.completed", response: completion }];
	} else {
		completion = { candidates: [{ content: { role: "model", parts: [{ text: reply }] }, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } };
		events = [completion];
	}
	response.writeHead(200, { "Content-Type": streaming ? "text/event-stream" : "application/json" });
	response.end(streaming ? sse(events) : JSON.stringify(completion));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let child;
try {
	const apis = ["openai-responses", "anthropic-messages", "google-generative-ai", "google-vertex"];
	const providers = apis.map((api) => ({ providerKey: `skiff-relay-${api}`, api, baseUrl: `http://127.0.0.1:${server.address().port}/${api}/v1`, keyEnv: "SKIFF_TEST_PROTOCOL_KEY", timeoutSeconds: 5,
		models: [false, true].map((enabled) => ({ id: api.startsWith("google") ? `gemini-2.5-flash-${enabled}` : api === "anthropic-messages" ? `claude-test-${enabled}` : `gpt-test-${enabled}`, name: String(enabled), streaming: enabled, tools: enabled, reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 500, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } })) }));
	await writeFile(join(directory, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
	child = spawn(process.execPath, [cli, "--mode", "rpc", "--no-extensions", "--extension", resolve("src-tauri/src/pi_extensions/model_families.js"), "--no-skills", "--no-approve", "--no-context-files", "--offline"], {
		cwd: directory, env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: "1", SKIFF_TEST_PROTOCOL_KEY: "dummy-protocol-key", SKIFF_FAMILY_RUNTIME: JSON.stringify(providers) }, stdio: ["pipe", "pipe", "pipe"],
	});
	const pending = new Map(); const events = []; let sequence = 0; let stderr = "";
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	createInterface({ input: child.stdout }).on("line", (line) => {
		let event; try { event = JSON.parse(line); } catch { return; }
		events.push(event);
		const waiter = pending.get(event.id); if (event.type !== "response" || !waiter) return;
		pending.delete(event.id); clearTimeout(waiter.timer);
		if (event.success) waiter.resolve(event.data); else waiter.reject(new Error(event.error));
	});
	const rpc = (command) => new Promise((resolve, reject) => {
		const id = `protocol-${++sequence}`;
		const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${command.type}; ${stderr.slice(-1000)}`)); }, 15000);
		pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
	});
	for (const provider of providers) for (const model of provider.models) {
		await rpc({ type: "new_session" });
		await rpc({ type: "set_model", provider: provider.providerKey, modelId: model.id });
		const offset = events.length;
		await rpc({ type: "prompt", message: "Verify protocol model configuration" });
		const deadline = Date.now() + 10000;
		while (!events.slice(offset).some((event) => event.type === "agent_end") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
		const message = events.slice(offset).findLast((event) => event.type === "message_end" && event.message?.role === "assistant")?.message;
		assert.ok(message, `${provider.api}: missing response; ${stderr.slice(-1000)}`);
		assert.equal(message.stopReason, "stop", `${provider.api}: ${message.errorMessage}`);
		assert.equal(message.content.find((block) => block.type === "text")?.text, reply, provider.api);
		assert.equal(message.usage.input, 10); assert.equal(message.usage.output, 2);
		const request = requests.at(-1);
		assert.equal(request.api, provider.api); assert.equal(request.streaming, model.streaming);
		assert.equal(!!request.payload.tools?.length, model.tools, `${provider.api}: tools`);
		assert.equal(request.headers["x-skiff-response-mode"], undefined);
		assert.equal(request.payload.max_output_tokens ?? request.payload.max_tokens ?? request.payload.generationConfig?.maxOutputTokens, model.maxTokens);
		console.log(`PASS ${provider.api}: streaming=${model.streaming}, tools=${model.tools}`);
	}
} finally {
	if (child && child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
	server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
