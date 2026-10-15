// Optional real-pi integration. Uses only a loopback server and temporary config.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
await import("./register.mjs");

const cli = process.argv[2];
if (!cli) throw new Error("Usage: node tests/pi.interactions.integration.mjs <absolute path to pi cli.js>");
const directory = await mkdtemp(join(tmpdir(), "skiff-pi-integration-"));
const requests = [];
let release; let held = false; let finishReason = "stop"; let toolSent = false;
const server = createServer(async (request, response) => {
	try {
		let body = ""; for await (const chunk of request) body += chunk;
		assert.equal(request.url, "/v1/chat/completions");
		assert.equal(request.headers.authorization, "Bearer dummy-local-key");
		requests.push(JSON.parse(body));
		if (held) await new Promise((resolve) => { release = resolve; });
		response.writeHead(200, { "Content-Type": "text/event-stream" });
		const base = { id: "local-completion", object: "chat.completion.chunk", created: 0, model: "skiff-vision-test" };
		const userText = (value) => typeof value === "string" ? value : (value ?? []).map((part) => part.text ?? "").join("");
		const tools = !toolSent && userText(requests.at(-1).messages.findLast((message) => message.role === "user")?.content) === "mixed";
		if (tools) toolSent = true;
		for (const chunk of (tools ? [
			{ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "local_read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: join(directory, "sample.txt") }) } }] }, finish_reason: null }] },
			{ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
		] : [
			{ choices: [{ index: 0, delta: { role: "assistant", content: "A test image." }, finish_reason: null }] },
			{ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
			{ choices: [], usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130, prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 12 } } },
		])) response.write(`data: ${JSON.stringify({ ...base, ...chunk })}\n\n`);
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
	await writeFile(join(directory, "sample.txt"), "local tool result");
	await writeFile(join(directory, "template.md"), "Expanded local template $ARGUMENTS");
	await mkdir(join(directory, "skill"));
	await writeFile(join(directory, "skill", "SKILL.md"), "---\nname: local-test\ndescription: local test skill\n---\nLocal skill content");
	await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "skiff-local-test": { type: "api_key", key: "dummy-local-key" } }));
	await writeFile(join(directory, "dialogs.mjs"), `export default function(pi) {
 let afterEnd = false;
 pi.registerCommand("end-queue", {handler: async () => { afterEnd = true; }});
 pi.on("agent_end", async () => { if (afterEnd) { afterEnd = false; pi.sendUserMessage("delivered after agent_end", {deliverAs: "followUp"}); } });
 pi.registerCommand("handled", { handler: async (_, ctx) => ctx.ui.notify("handled") });
 for (const method of ["select", "confirm", "input", "editor"]) pi.registerCommand("dialog-" + method, {handler: async (args, ctx) => {
 const opts = args === "timeout" ? {timeout: 120} : undefined;
 const value = method === "select" ? await ctx.ui.select("Choose", ["A", "B"], opts) : method === "confirm" ? await ctx.ui.confirm("Confirm", "Question", opts) : method === "input" ? await ctx.ui.input("Input", "Placeholder", opts) : await ctx.ui.editor("Editor", "Line 1\\nLine 2");
 ctx.ui.notify(JSON.stringify({method, value: value === undefined ? "undefined" : value}));
 }});
}`);
	child = spawn(process.execPath, [cli, "--mode", "rpc", "--provider", "skiff-local-test", "--model", "skiff-vision-test", "--no-extensions", "--extension", join(directory, "dialogs.mjs"), "--no-skills", "--skill", join(directory, "skill"), "--prompt-template", join(directory, "template.md"), "--no-approve", "--no-context-files", "--offline"], {
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
	const waitFor = async (predicate) => {
		const deadline = Date.now() + 15000;
		while (!predicate()) { if (Date.now() > deadline) throw new Error("Timed out waiting for protocol event: " + stderr.slice(-1000)); await new Promise((resolve) => setTimeout(resolve, 10)); }
	};
	const settledCount = () => events.filter((e) => e.type === "agent_settled").length;
	const state = await rpc({type: "get_state"});
	assert.ok(state.steeringMode); assert.ok(state.followUpMode);
	await rpc({type: "set_steering_mode", mode: "all"}); await rpc({type: "set_follow_up_mode", mode: "all"});
	assert.equal((await rpc({type: "get_state"})).steeringMode, "all"); assert.equal((await rpc({type: "get_state"})).followUpMode, "all");
	const commands = (await rpc({type: "get_commands"})).commands;
	assert.equal(commands.find((c) => c.name === "handled")?.source, "extension");
	assert.equal((await rpc({type: "prompt", message: "/handled"})).disposition, "handled");
	held = true;
	assert.equal((await rpc({type: "prompt", message: "first"})).disposition, "started");
	await waitFor(() => release);
	assert.equal((await rpc({type: "steer", message: "steering one"})).disposition, "queued");
	assert.equal((await rpc({type: "follow_up", message: "follow one"})).disposition, "queued");
	assert.equal((await rpc({type: "prompt", message: "prompt queued", streamingBehavior: "steer"})).disposition, "queued");
	const queued = events.findLast((e) => e.type === "queue_update");
	assert.deepEqual(queued.steering, ["steering one", "prompt queued"]);
	assert.deepEqual(queued.followUp, ["follow one"]);
	await assert.rejects(rpc({type: "steer", message: "/handled"}));
	assert.equal((await rpc({type: "steer", message: "/template argument"})).disposition, "queued");
	assert.equal((await rpc({type: "follow_up", message: "/skill:local-test"})).disposition, "queued");
	const templateSnapshot = events.findLast((event) => event.type === "queue_update");
	assert.ok(templateSnapshot.steering.some((text) => text.includes("Expanded local template argument")));
	assert.ok(templateSnapshot.followUp.some((text) => text.includes("SKILL.md")));
	const removed = await rpc({type: "clear_queue"});
	assert.deepEqual(removed, {steering: templateSnapshot.steering, followUp: templateSnapshot.followUp});
	assert.deepEqual(events.findLast((e) => e.type === "queue_update").steering, []);
	const before = settledCount();
	await rpc({type: "abort"});
	await waitFor(() => settledCount() > before);
	assert.equal((await rpc({type: "get_state"})).pendingMessageCount, 0);
	held = false; release(); release = undefined;
	// Mixed queues drain before the final agent_settled; agent_end occurs earlier.
	held = true;
	await rpc({type: "prompt", message: "mixed"}); await waitFor(() => release);
	await rpc({type: "steer", message: "mixed steer"}); await rpc({type: "follow_up", message: "mixed follow"});
	const mixedStart = events.length; const mixedBefore = settledCount();
	held = false; release(); release = undefined;
	await waitFor(() => settledCount() > mixedBefore);
	const mixed = events.slice(mixedStart);
	assert.ok(mixed.findIndex((e) => e.type === "agent_end") < mixed.findIndex((e) => e.type === "agent_settled"));
	const toolEnd = mixed.findIndex((e) => e.type === "tool_execution_end");
	const steerDelivered = mixed.findIndex((e) => e.type === "message_start" && e.message?.role === "user" && e.message.content.some((part) => part.text === "mixed steer"));
	assert.ok(toolEnd >= 0 && steerDelivered > toolEnd, "Steering must arrive after tool execution");
	const transcript = (await rpc({type: "get_messages"})).messages;
	for (const text of ["mixed steer", "mixed follow"]) assert.ok(transcript.some((m) => m.role === "user" && m.content.some((c) => c.text === text)));
	await rpc({type: "prompt", message: "/end-queue"});
	const continuationStart = events.length, continuationBefore = settledCount();
	await rpc({type: "prompt", message: "exercise after-end"}); await waitFor(() => settledCount() > continuationBefore);
	const continuation = events.slice(continuationStart);
	assert.ok(continuation.filter((event) => event.type === "agent_end").length >= 2);
	const firstEnd = continuation.findIndex((event) => event.type === "agent_end");
	const continuedUser = continuation.findIndex((event) => event.type === "message_start" && event.message?.role === "user" && event.message.content.some((part) => part.text === "delivered after agent_end"));
	assert.ok(continuedUser > firstEnd, "agent_end can precede another user turn before agent_settled");
	finishReason = "length"; const lengthBefore = settledCount();
	await rpc({type: "prompt", message: "truncate"}); await waitFor(() => settledCount() > lengthBefore);
	assert.equal(events.findLast((e) => e.type === "message_end" && e.message?.role === "assistant").message.stopReason, "length");
	for (const method of ["select", "confirm", "input", "editor"]) {
		const start = events.length; const result = rpc({type: "prompt", message: "/dialog-" + method});
		await waitFor(() => events.slice(start).some((e) => e.type === "extension_ui_request" && e.method === method));
		const dialog = events.slice(start).find((e) => e.method === method);
		if (method === "editor") assert.equal(dialog.prefill, "Line 1\nLine 2");
		child.stdin.write(JSON.stringify({type: "extension_ui_response", id: dialog.id, ...(method === "confirm" ? {confirmed: true} : {value: method === "select" ? "B" : "edited\nvalue"})}) + "\n");
		assert.equal((await result).disposition, "handled");
		const cancelStart = events.length; const cancelled = rpc({type: "prompt", message: "/dialog-" + method});
		await waitFor(() => events.slice(cancelStart).some((e) => e.method === method));
		child.stdin.write(JSON.stringify({type: "extension_ui_response", id: events.slice(cancelStart).find((e) => e.method === method).id, cancelled: true}) + "\n");
		await cancelled;
		assert.ok(events.slice(cancelStart).some((e) => e.method === "notify" && e.message.includes(method === "confirm" ? '"value":false' : '"value":"undefined"')));
		if (method !== "editor") {
			const timeoutStart = events.length;
			await rpc({type: "prompt", message: "/dialog-" + method + " timeout"});
			assert.ok(events.slice(timeoutStart).some((e) => e.method === "notify" && e.message.includes(method === "confirm" ? '"value":false' : '"value":"undefined"')));
			assert.equal(events.slice(timeoutStart).filter((e) => e.type === "extension_ui_request" && e.method !== "notify").length, 1);
		}
	}
	console.log("PASS: real pi 1.2 queue snapshots/modes/dispositions, mixed drain/end/settled, clear-to-abort, length, four dialog replies/cancel, timeout defaults; loopback only.");
} finally {
	if (release) release();
	if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
	server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
}

