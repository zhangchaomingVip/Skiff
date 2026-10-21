import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";

const cli = process.argv[2];
if (!cli) throw new Error("Usage: node tests/pi.retry.integration.mjs <pi-cli.js>");
const directory = await mkdtemp(join(tmpdir(), "skiff-retry-"));
let count = 0, mode = "recover";
const server = createServer(async (request, response) => {
	for await (const chunk of request) { /* Consume the local request. */ }
	count++;
	if (mode === "timeout" && count < 6) return;
	if (mode === "network" && count < 6) { request.socket.destroy(); return; }
	if (!["recover", "timeout", "network"].includes(mode) || count < 6) {
		response.writeHead(mode === "unauthorized" ? 401 : 503, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ error: { message: mode === "unauthorized" ? "invalid api key" : "server busy" } })); return;
	}
	response.writeHead(200, { "Content-Type": "text/event-stream" });
	response.end('data: {"id":"test","choices":[{"index":0,"delta":{"content":"Recovered"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let child;
try {
	await writeFile(join(directory, "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 5, baseDelayMs: 5, maxAgentDelayMs: 20 } }));
	await writeFile(join(directory, "models.json"), JSON.stringify({ providers: { "retry-test": { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", models: [{ id: "local", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 64 }] } } }));
	await writeFile(join(directory, "auth.json"), JSON.stringify({ "retry-test": { type: "api_key", key: "dummy-local-key" } }));
	const route = { providerKey: "retry-test", keyEnv: "SKIFF_RETRY_TEST_KEY", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, timeoutSeconds: .1, tools: true, streaming: true, models: [{ id: "local", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 64 }] };
	child = spawn(process.execPath, [cli, "--mode", "rpc", "--provider", "retry-test", "--model", "local", "--no-extensions", "--extension", resolve("src-tauri/src/pi_extensions/model_families.js"), "--no-skills", "--no-approve", "--no-context-files", "--offline"], { cwd: directory, env: { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: "1", SKIFF_FAMILY_RUNTIME: JSON.stringify([route]), SKIFF_RETRY_TEST_KEY: "dummy-local-key" }, stdio: ["pipe", "pipe", "pipe"] });
	const events = [], pending = new Map(); let sequence = 0, stderr = "";
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	createInterface({ input: child.stdout }).on("line", (line) => {
		let event; try { event = JSON.parse(line); } catch { return; }
		events.push(event);
		const waiter = event.type === "response" && pending.get(event.id);
		if (!waiter) return;
		pending.delete(event.id); clearTimeout(waiter.timer);
		if (event.success) waiter.resolve(event.data); else waiter.reject(new Error(event.error));
	});
	const rpc = (command) => new Promise((resolve, reject) => {
		const id = `retry-${++sequence}`;
		const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${command.type}; ${stderr.slice(-500)}`)); }, 20000);
		pending.set(id, { resolve, reject, timer }); child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
	});
	const until = async (predicate) => {
		const deadline = Date.now() + 20000;
		while (!predicate()) { if (Date.now() > deadline) throw new Error(`Event timeout: ${stderr.slice(-500)}`); await new Promise((resolve) => setTimeout(resolve, 10)); }
	};
	await rpc({ type: "get_state" });
	for (const scenario of ["recover", "timeout", "network", "exhaust", "unauthorized", "cancel"]) {
		mode = scenario; count = 0;
		await rpc({ type: "new_session" });
		const offset = events.length;
		await rpc({ type: "prompt", message: "Local retry test" });
		if (scenario === "cancel") {
			await until(() => events.slice(offset).some((event) => event.type === "auto_retry_start"));
			await rpc({ type: "abort" });
		}
		await until(() => events.slice(offset).some((event) => event.type === "agent_settled"));
		const run = events.slice(offset), retries = run.filter((event) => event.type === "auto_retry_start");
		if (["recover", "timeout", "network", "exhaust"].includes(scenario)) {
			assert.deepEqual(retries.map((event) => event.attempt), [1, 2, 3, 4, 5]);
			assert.ok(retries.every((event) => event.maxAttempts === 5));
			assert.equal(count, 6, "One initial request plus five retries");
			assert.equal(run.findLast((event) => event.type === "auto_retry_end").success, scenario !== "exhaust");
			if (scenario === "timeout") assert.ok(retries.every((event) => /提供商请求超时/.test(event.errorMessage)));
		} else if (scenario === "unauthorized") { assert.equal(retries.length, 0); assert.equal(count, 1); }
		else { const stopped = count; await new Promise((resolve) => setTimeout(resolve, 80)); assert.equal(count, stopped); assert.ok(count < 6); }
		const transcript = await rpc({ type: "get_messages" });
		assert.equal(transcript.messages.filter((message) => message.role === "user").length, 1);
		console.log(`PASS ${scenario}: ${count} requests, ${retries.length} retries`);
	}
} finally {
	if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
	server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
}
