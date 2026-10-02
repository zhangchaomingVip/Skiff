// Optional real-pi integration. Uses only a loopback server and temporary config.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { testImage } from "./imageFixture.mjs";

const cli = process.argv[2];
if (!cli) throw new Error("Usage: node tests/pi.integration.mjs <absolute path to pi cli.js>");
const directory = await mkdtemp(join(tmpdir(), "skiff-pi-integration-"));
const requests = [];
const server = createServer(async (request, response) => {
	try {
		let body = ""; for await (const chunk of request) body += chunk;
		assert.equal(request.url, "/v1/chat/completions");
		assert.equal(request.headers.authorization, "Bearer dummy-local-key");
		requests.push(JSON.parse(body));
		response.writeHead(200, { "Content-Type": "text/event-stream" });
		const base = { id: "local-completion", object: "chat.completion.chunk", created: 0, model: "skiff-vision-test" };
		for (const chunk of [
			{ choices: [{ index: 0, delta: { role: "assistant", content: "A test image." }, finish_reason: null }] },
			{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
			{ choices: [], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 12 } } },
		]) response.write(`data: ${JSON.stringify({ ...base, ...chunk })}\n\n`);
		response.end("data: [DONE]\n\n");
	} catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let child;
try {
	const agentDir = join(directory, "agent"); await mkdir(agentDir);
	await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "skiff-local-test": {
		baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions",
		models: [{ id: "skiff-vision-test", reasoning: true, input: ["text", "image"], contextWindow: 128000, maxTokens: 8192, thinkingLevelMap: { xhigh: "xhigh", max: "max" } }],
	} } }));
	await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "skiff-local-test": { type: "api_key", key: "dummy-local-key" } }));
	child = spawn(process.execPath, [cli, "--mode", "rpc", "--provider", "skiff-local-test", "--model", "skiff-vision-test", "--no-extensions", "--no-skills", "--no-approve", "--no-context-files", "--offline"], {
		cwd: directory, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"],
	});
	const pending = new Map(); const events = []; let sequence = 0; let stderr = "";
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	createInterface({ input: child.stdout }).on("line", (line) => {
		let event; try { event = JSON.parse(line); } catch { return; }
		events.push(event);
		if (event.type === "response") {
			const waiter = pending.get(event.id); if (!waiter) return;
			pending.delete(event.id); clearTimeout(waiter.timer);
			if (event.success) waiter.resolve(event.data); else waiter.reject(new Error(event.error));
		}
	});
	const rpc = (command) => new Promise((resolve, reject) => {
		const id = `integration-${++sequence}`;
		const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${command.type}; ${stderr.slice(-500)}`)); }, 20000);
		pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
	});
	const state = await rpc({ type: "get_state" }); assert.equal(state.model.id, "skiff-vision-test");
	const levels = await rpc({ type: "get_available_thinking_levels" }); assert.ok(levels.levels.includes("max"));
	await rpc({ type: "set_thinking_level", level: "max" }); assert.equal((await rpc({ type: "get_state" })).thinkingLevel, "max");
	const image = { type: "image", mimeType: "image/png", data: testImage().toString("base64") };
	await rpc({ type: "prompt", message: "Describe the attached image", images: [image] });
	const deadline = Date.now() + 20000;
	while (!events.some((event) => event.type === "agent_end")) {
		if (Date.now() > deadline) throw new Error("No agent_end received");
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
	assert.equal(requests.length, 1); assert.equal(requests[0].reasoning_effort, "max");
	assert.ok(requests[0].messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url" && part.image_url.url.startsWith("data:image/"))), "No inline image reached the local server");
	const transcript = await rpc({ type: "get_messages" });
	const assistant = transcript.messages.findLast((message) => message.role === "assistant");
	assert.equal(assistant.stopReason, "stop", assistant.errorMessage);
	assert.equal(assistant.usage.input, 30); assert.equal(assistant.usage.cacheRead, 60);
	assert.equal(assistant.usage.cacheWrite, 10); assert.equal(assistant.usage.output, 30);
	assert.equal(assistant.usage.reasoning, 12); assert.equal(assistant.usage.totalTokens, 130);
	await rpc({ type: "set_thinking_level", level: "low" });
	const previousEndCount = events.filter((event) => event.type === "agent_end").length;
	await rpc({ type: "prompt", message: "", images: [image] });
	const imageOnlyDeadline = Date.now() + 20000;
	while (events.filter((event) => event.type === "agent_end").length === previousEndCount) {
		if (Date.now() > imageOnlyDeadline) throw new Error("Image-only prompt did not finish");
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
	assert.equal(requests.length, 2); assert.equal(requests[1].reasoning_effort, "low");
	assert.ok(requests[1].messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url")));
	const file = (await rpc({ type: "get_state" })).sessionFile; assert.ok(file);
	await rpc({ type: "new_session" });
	await rpc({ type: "switch_session", sessionPath: file });
	const history = await rpc({ type: "get_messages" });
	assert.ok(history.messages.some((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((block) => block.type === "image")));
	assert.equal(history.messages.findLast((message) => message.role === "assistant").usage.reasoning, 12);
	assert.equal((await rpc({ type: "get_state" })).thinkingLevel, "low");
	console.log("PASS: real pi reasoning=max/low, multimodal and image-only prompts, cache/reasoning usage and restored history (local only).");
} finally {
	if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
	await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
