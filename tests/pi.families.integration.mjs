// Real pi + loopback only: no user configuration or paid requests.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

const cli = process.argv[2];
if (!cli) throw new Error("Usage: node tests/pi.families.integration.mjs <pi-cli.js>");
const directory = await mkdtemp(join(tmpdir(), "skiff-family-integration-"));
const requests = [];
const server = createServer(async (request, response) => {
	let body = ""; for await (const chunk of request) body += chunk;
	const payload = JSON.parse(body);
	requests.push({ path: request.url, key: request.headers.authorization, payload });
	if (request.url.startsWith("/timeout")) return;
	if (request.url.startsWith("/failure")) {
		response.writeHead(401, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ error: { message: "渠道测试：无效凭据" } })); return;
	}
	const completion = { id: "local", model: payload.model, created: 0,
		choices: [{ index: 0, message: { role: "assistant", content: "渠道正常" }, finish_reason: "stop" }],
		usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
	if (!payload.stream) {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify(completion)); return;
	}
	response.writeHead(200, { "Content-Type": "text/event-stream" });
	for (const chunk of [
		{ choices: [{ index: 0, delta: { role: "assistant", content: "渠道正常" }, finish_reason: null }] },
		{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
		{ choices: [], usage: completion.usage },
	]) response.write(`data: ${JSON.stringify({ ...completion, ...chunk })}\n\n`);
	response.end("data: [DONE]\n\n");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let child;
try {
	const routes = [
		{ id: "a", path: "stream", model: "deepseek-chat", streaming: true, tools: true, input: 1, timeout: 5 },
		{ id: "b", path: "json", model: "deepseek-v4.1", streaming: false, tools: false, input: 2, timeout: 5 },
		{ id: "c", path: "failure", model: "deepseek-chat", streaming: true, tools: false, input: 0, timeout: 5 },
		{ id: "d", path: "timeout", model: "deepseek-chat", streaming: true, tools: false, input: 0, timeout: 1 },
	].map((item) => ({ providerKey: `skiff-deepseek-${item.id}`, keyEnv: `SKIFF_TEST_KEY_${item.id}`,
		baseUrl: `http://127.0.0.1:${server.address().port}/${item.path}/v1`,
		streaming: item.streaming, tools: item.tools, timeoutSeconds: item.timeout,
		model: { id: item.model, name: item.id, api: "openai-completions", input: ["text"], reasoning: false,
			contextWindow: 64000, maxTokens: item.id === "a" ? 100 : 200, cost: { input: item.input, output: 3, cacheRead: 0, cacheWrite: 0 } } }));
	await writeFile(join(directory, "models.json"), JSON.stringify({ providers: Object.fromEntries(routes.map((route) => [route.providerKey, {
		baseUrl: route.baseUrl, api: "openai-completions", models: [route.model],
	}])) }));
	await writeFile(join(directory, "auth.json"), JSON.stringify(Object.fromEntries(routes.map((route) => [route.providerKey, { type: "api_key", key: `$${route.keyEnv}` }]))));
	await writeFile(join(directory, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
	child = spawn(process.execPath, [cli, "--mode", "rpc", "--provider", routes[0].providerKey, "--model", routes[0].model.id,
		"--no-extensions", "--extension", resolve("src-tauri/src/pi_extensions/model_families.js"), "--no-skills", "--no-approve", "--no-context-files", "--offline"], {
		cwd: directory, env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: "1", SKIFF_FAMILY_RUNTIME: JSON.stringify(routes),
			...Object.fromEntries(routes.map((route) => [route.keyEnv, `dummy-${route.providerKey}`])) }, stdio: ["pipe", "pipe", "pipe"],
	});
	const pending = new Map(); const events = []; let sequence = 0; let stderr = "";
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	createInterface({ input: child.stdout }).on("line", (line) => {
		let event; try { event = JSON.parse(line); } catch { return; }
		events.push(event);
		if (event.type !== "response") return;
		const waiter = pending.get(event.id); if (!waiter) return;
		pending.delete(event.id); clearTimeout(waiter.timer);
		if (event.success) waiter.resolve(event.data); else waiter.reject(new Error(event.error));
	});
	const rpc = (command) => new Promise((resolve, reject) => {
		const id = `family-${++sequence}`;
		const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${command.type}; ${stderr.slice(-1500)}`)); }, 15000);
		pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
	});
	const available = await rpc({ type: "get_available_models" });
	assert.ok(available.models.some((model) => model.provider === routes[1].providerKey));
	for (const [index, route] of routes.entries()) {
		await rpc({ type: "new_session" });
		await rpc({ type: "set_model", provider: route.providerKey, modelId: route.model.id });
		assert.equal((await rpc({ type: "get_state" })).model.cost.input, route.model.cost.input);
		const count = events.filter((event) => event.type === "agent_end").length;
		await rpc({ type: "prompt", message: "只回复一行" });
		const deadline = Date.now() + 15000;
		while (events.filter((event) => event.type === "agent_end").length === count) {
			if (Date.now() > deadline) throw new Error(`No agent_end for ${route.providerKey}: ${stderr.slice(-1500)}`);
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
		const message = (await rpc({ type: "get_messages" })).messages.findLast((message) => message.role === "assistant");
		assert.ok(message, `Missing assistant: ${JSON.stringify(events.filter((event) => event.type === "message_end").slice(-2))}; ${stderr}`);
		if (index < 2) {
			assert.equal(message.stopReason, "stop", message.errorMessage);
			assert.equal(message.content.find((block) => block.type === "text")?.text, "渠道正常");
			assert.equal(message.usage.input, 10); assert.equal(message.usage.output, 2);
			assert.equal(message.usage.cost.total, (10 * route.model.cost.input + 2 * route.model.cost.output) / 1_000_000);
		} else {
			assert.ok(["error", "aborted"].includes(message.stopReason), JSON.stringify(message));
			if (index === 2) assert.match(message.errorMessage, /401|无效凭据/);
			if (index === 3) assert.match(message.errorMessage, /超时/);
		}
		const request = requests.findLast((request) => request.path === `/${["stream", "json", "failure", "timeout"][index]}/v1/chat/completions`);
		assert.ok(request, `No upstream request for ${route.providerKey}: ${message.errorMessage}`);
		assert.equal(request.key, `Bearer dummy-${route.providerKey}`);
		assert.equal(request.payload.model, route.model.id);
		assert.equal(request.payload.stream, route.streaming);
		assert.equal(request.payload.max_tokens ?? request.payload.max_completion_tokens, route.model.maxTokens);
		if (!route.tools) assert.equal(request.payload.tools, undefined);
		else assert.ok(request.payload.tools?.length > 0);
	}
	console.log("PASS: real pi channel routing, separate keys/models/prices, streaming toggle, tool toggle, 401 and request timeout (local only).");
} finally {
	if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
	server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
