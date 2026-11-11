import test from "node:test";
import assert from "node:assert/strict";

const extensionUrl = new URL("../src-tauri/src/pi_extensions/agent_browser.js", import.meta.url).href;
const { default: setup } = await import(extensionUrl);
const token = "a".repeat(32);
const runtime = JSON.stringify({ url: "http://127.0.0.1:12345/v1/agent", token });
const originalRuntime = process.env.SKIFF_BROWSER_RUNTIME;
const originalFetch = globalThis.fetch;
test.afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalRuntime === undefined) delete process.env.SKIFF_BROWSER_RUNTIME;
	else process.env.SKIFF_BROWSER_RUNTIME = originalRuntime;
});

function load(config: string | undefined = runtime) {
	if (config === undefined) delete process.env.SKIFF_BROWSER_RUNTIME;
	else process.env.SKIFF_BROWSER_RUNTIME = config;
	let tool: any;
	const hooks: Record<string, any> = {};
	let active = ["read", "browser"];
	setup({ registerTool: (value: any) => { tool = value; }, on: (name: string, handler: any) => { hooks[name] = handler; }, getActiveTools: () => active, setActiveTools: (value: string[]) => { active = value; } });
	return { get tool() { return tool; }, hooks, get active() { return active; } };
}

test("browser is absent without a valid process-scoped loopback lease", () => {
	for (const config of ["null", "{}", runtime.replace("127.0.0.1", "example.com"), runtime.replace("http:", "https:"), runtime.replace(token, "secret")]) assert.equal(load(config).tool, undefined);
	assert.equal(load().tool.name, "browser");
});

test("browser validates action fields before sending any request", async () => {
	globalThis.fetch = (() => { throw new Error("must not send"); }) as typeof fetch;
	const { tool } = load();
	for (const params of [{ action: "shell", command: "anything" }, { action: "open", url: "file:///secret" }, { action: "open", url: "https://user:pass@example.com" }, { action: "fill", selector: "--cdp", text: "a" }, { action: "wait", milliseconds: 10001 }, { action: "snapshot", generation: "other-chat" }]) {
		assert.equal((await tool.execute("invalid", params)).details.skiffBrowser.outcome, "invalidArguments");
	}
});

test("browser binds commands to fresh context, returns image and operation metadata", async () => {
	const calls: { url: string; init: RequestInit; body?: any }[] = [];
	const jpeg = "/9j/4AAQSkZJRg==";
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
		return new Response(JSON.stringify(url.endsWith("/context") ? { success: true, status: { generation: "fresh", controlVersion: 7 } } : { success: true, data: { mimeType: "image/jpeg", data: jpeg }, details: { outcome: "success", target: "current", durationMs: 5 } }));
	}) as typeof fetch;
	const { tool, hooks } = load();
	const result = await tool.execute("tool-1", { action: "screenshot" });
	assert.deepEqual(calls.map((call) => call.url), ["http://127.0.0.1:12345/v1/agent/context", "http://127.0.0.1:12345/v1/agent/command"]);
	assert.equal(calls[1].body.generation, "fresh");
	assert.equal(calls[1].body.controlVersion, 7);
	assert.deepEqual(calls[1].body.action, { type: "screenshot" });
	assert.equal(calls[1].init.redirect, "error");
	assert.equal(result.content[1].data, jpeg);
	assert.equal(result.details.skiffBrowser.toolCallId, "tool-1");
	assert.equal(result.details.skiffBrowser.target, "current");
	assert.deepEqual(hooks.tool_result({ toolName: "browser", details: result.details }), { isError: false });
});

test("browser abort sends independent cancellation and reports unconfirmed drain", async () => {
	const controller = new AbortController();
	const calls: string[] = [];
	let requestId: string | undefined;
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		calls.push(url);
		if (url.endsWith("/context")) return new Response(JSON.stringify({ success: true, status: null }));
		const body = JSON.parse(String(init.body));
		if (url.endsWith("/cancel")) {
			assert.equal(body.requestId, requestId);
			assert.notEqual(init.signal, controller.signal);
			return new Response(JSON.stringify({ success: true }));
		}
		requestId = body.requestId;
		controller.abort();
		throw new Error("aborted");
	}) as typeof fetch;
	const { tool, hooks } = load();
	const result = await tool.execute("abort", { action: "open", url: "http://localhost/" }, controller.signal);
	assert.equal(calls.filter((url) => url.endsWith("/cancel")).length, 1);
	assert.equal(result.details.skiffBrowser.outcome, "cancelled");
	assert.equal(result.details.skiffBrowser.browserOutcome, "unconfirmed");
	assert.deepEqual(hooks.tool_result({ toolName: "browser", details: result.details }), { isError: true });
});

test("revoked leases deactivate browser without removing other tools", async () => {
	globalThis.fetch = (async () => new Response("", { status: 403 })) as typeof fetch;
	const extension = load();
	await extension.hooks.before_agent_start();
	assert.deepEqual(extension.active, ["read"]);
	assert.equal((await extension.tool.execute("revoked", { action: "snapshot" })).details.skiffBrowser.outcome, "unavailable");
});

test("a closed instance keeps the tool available and reopens only on explicit open", async () => {
	const commands: any[] = [];
	let closed = true;
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		if (url.endsWith("/context")) return new Response(JSON.stringify({ success: true, status: { generation: closed ? "closed-instance" : "new-instance", controlVersion: closed ? 8 : 1, control: closed ? "closed" : "ai", requiresSnapshot: closed } }));
		const command = JSON.parse(String(init.body));
		commands.push(command);
		closed = false;
		return new Response(JSON.stringify({ success: true, data: command.action.type === "snapshot" ? { snapshot: "new page" } : {}, details: { outcome: "success" } }));
	}) as typeof fetch;
	const extension = load();
	await extension.hooks.before_agent_start();
	assert.deepEqual(extension.active, ["read", "browser"]);
	const snapshot = await extension.tool.execute("closed-snapshot", { action: "snapshot" });
	assert.equal(snapshot.details.skiffBrowser.outcome, "closed");
	assert.match(snapshot.content[0].text, /open/);
	assert.equal(commands.length, 0);
	assert.equal((await extension.tool.execute("reopen", { action: "open", url: "http://localhost/" })).details.skiffBrowser.outcome, "success");
	assert.equal(commands[0].generation, "closed-instance");
	assert.equal(commands[0].controlVersion, 8);
	assert.equal((await extension.tool.execute("new-snapshot", { action: "snapshot" })).details.skiffBrowser.outcome, "success");
	assert.equal(commands[1].generation, "new-instance");
	assert.deepEqual(extension.active, ["read", "browser"]);
});

test("human takeover and stale generation remain explicit error outcomes", async () => {
	for (const [status, expected] of [[200, "humanControl"], [409, "closed"]] as const) {
		globalThis.fetch = (async (url: string) => new Response(JSON.stringify(url.endsWith("/context") ? { success: true, status: { generation: "old", controlVersion: 1 } } : { success: false, error: "人工控制中", details: { outcome: "humanControl" } }), { status: url.endsWith("/context") ? 200 : status })) as typeof fetch;
		const result = await load().tool.execute("human", { action: "click", selector: "@e1" });
		assert.equal(result.details.skiffBrowser.outcome, expected);
	}
});

test("handoff requires a new snapshot before any mutation", async () => {
	let commands = 0;
	globalThis.fetch = (async (url: string) => {
		if (url.endsWith("/command")) commands++;
		return new Response(JSON.stringify({ success: true, status: { generation: "current", controlVersion: 3, requiresSnapshot: true } }));
	}) as typeof fetch;
	const result = await load().tool.execute("stale-ref", { action: "click", selector: "@e1" });
	assert.equal(result.details.skiffBrowser.outcome, "snapshotRequired");
	assert.equal(commands, 0);
});
