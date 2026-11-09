// Phase A experiment only. No production UI/config or real browser profiles are used.
// node tests/agent-browser.spike.mjs [--desktop] [--pi <absolute cli.js>]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

const require = createRequire(import.meta.url);
const { chromium } = require(resolve(".playwright-cli/node_modules/playwright-core"));
const binary = process.env.SKIFF_AGENT_BROWSER_BIN ?? join(process.env.APPDATA, "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe");
const root = await mkdtemp(join(tmpdir(), "skiff-browser-spike-"));
const artifacts = resolve("dist/agent-browser-spike");
await mkdir(artifacts, { recursive: true });
const config = join(root, "agent-browser.json");
await writeFile(config, "{}");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_") && !/^(https?|all|no)_proxy$/i.test(key)));
Object.assign(env, { AGENT_BROWSER_NO_VERSION_CHECK: "1", AGENT_BROWSER_DEFAULT_TIMEOUT: "2000" });
const namespace = `skiff-spike-${randomBytes(5).toString("hex")}`;
const flags = ["--config", config, "--namespace", namespace, "--json"];
const report = { date: new Date().toISOString(), binary, namespace, checks: {} };
const sessions = new Set();
const children = new Set();
const sockets = new Set();
let desktop, viewerBrowser, vite, proxy, pi;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(fn, label, timeout = 15000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(50); }
	throw new Error(`Timeout: ${label}`);
}
function launch(program, args, options = {}) {
	const child = spawn(program, args, { cwd: root, env, windowsHide: true, ...options });
	children.add(child); child.on("exit", () => children.delete(child));
	return child;
}
async function execute(program, args, options = {}) {
	const child = launch(program, args, options); let stdout = "", stderr = "";
	child.stdout.on("data", (data) => { stdout += data; });
	child.stderr.on("data", (data) => { stderr += data; });
	const code = await new Promise((done, fail) => { child.on("error", fail); child.on("exit", done); });
	return { code, stdout, stderr };
}
async function command(session, args, allowFailure = false) {
	sessions.add(session);
	const result = await execute(binary, [...flags, "--session", session, ...args]);
	let json; try { json = JSON.parse(result.stdout); } catch { throw new Error(JSON.stringify(result)); }
	if (!allowFailure) assert.equal(json.success, true, JSON.stringify(json));
	return { ...result, json };
}
const fixture = `<!doctype html><meta charset="utf-8"><title>Skiff browser spike</title>
<style>body{font:20px sans-serif;background:#eef3ff;padding:30px}input,button{font:inherit;margin:12px;padding:12px}#result{padding:20px;background:white}</style>
<h1>Skiff 浏览器验证</h1><label>姓名<input id="name" aria-label="姓名"></label>
<button id="submit" onclick="result.textContent='完成：'+document.querySelector('#name').value;history.pushState({},'', '#done')">提交</button>
<p id="result">等待操作</p><button id="late" hidden onclick="this.textContent='迟到点击已执行'">延迟按钮</button>
<script>window.reveal=()=>setTimeout(()=>document.querySelector('#late').hidden=false,700);</script>`;
const viewer = await readFile(new URL("./fixtures/agent-browser-spike/web/index.html", import.meta.url), "utf8");
const site = createServer((req, res) => {
	res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(req.url.startsWith("/viewer") ? viewer : fixture);
});
site.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
await new Promise((done) => site.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${site.address().port}`;
async function handshake(port, origin) {
	return new Promise((done, fail) => {
		const socket = connect(port, "127.0.0.1"); socket.on("error", fail);
		socket.on("connect", () => socket.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\nOrigin: ${origin}\r\n\r\n`));
		socket.once("data", (data) => { socket.destroy(); done(data.toString().split("\r\n")[0]); });
	});
}
try {
	report.version = (await execute(binary, ["--version"])).stdout.trim();
	assert.equal(report.version, "agent-browser 0.41.2", "Revalidate and update the version baseline before using another CLI");
	console.log(report.version);
	const opened = await command("main", ["--profile", join(root, "profile-main"), "--idle-timeout", "0", "open", baseUrl]);
	report.checks.open = opened.json;
	const snapshot = (await command("main", ["snapshot", "-i"])).json;
	report.checks.snapshot = snapshot;
	const refs = snapshot.data.refs;
	const input = Object.entries(refs).find(([, value]) => value.name === "姓名")[0];
	const submit = Object.entries(refs).find(([, value]) => value.name === "提交")[0];
	await command("main", ["fill", `@${input}`, "浏览验证"]);
	await command("main", ["click", `@${submit}`]);
	assert.match(JSON.stringify((await command("main", ["snapshot"])).json), /完成：浏览验证/);
	report.checks.invalidSelector = (await command("main", ["click", "#does-not-exist"], true)).json;
	assert.equal(report.checks.invalidSelector.success, false);
	const status = (await command("main", ["stream", "status"])).json;
	report.checks.stream = status;
	const streamPort = status.data.port;
	assert.ok(streamPort > 0);
	report.checks.sessionInfo = (await command("main", ["session", "info"])).json;
	const cdpUrl = (await command("main", ["get", "cdp-url"])).json;
	report.checks.cdp = cdpUrl;
	report.checks.origins = {};
	for (const origin of [baseUrl, "http://localhost:1421", "http://tauri.localhost", "tauri://localhost"]) report.checks.origins[origin] = await handshake(streamPort, origin);
	assert.match(report.checks.origins[baseUrl], /101/);
	assert.match(report.checks.origins["http://tauri.localhost"], /403/);

	viewerBrowser = await chromium.launch({ channel: "msedge", headless: true });
	const page = await viewerBrowser.newPage();
	await page.goto(`${baseUrl}/viewer?port=${streamPort}`);
	await page.waitForFunction(() => window.probe?.frames > 0);
	const box = (await command("main", ["get", "box", "#name"])).json.data;
	report.checks.inputBox = box;
	await page.evaluate((box) => window.sendClick(box.x + 10, box.y + 10), box);
	await until(async () => /name/.test(JSON.stringify((await command("main", ["eval", "document.activeElement.id"])).json)), "stream mouse focus");
	await page.evaluate(() => { for (const text of "人工中文") window.stream.send(JSON.stringify({ type: "input_keyboard", eventType: "char", text })); });
	await until(async () => /人工中文/.test(JSON.stringify((await command("main", ["get", "value", "#name"])).json)), "stream Chinese input");
	const buttonBox = (await command("main", ["get", "box", "#submit"])).json.data;
	await page.evaluate((box) => window.sendClick(box.x + 10, box.y + 10), buttonBox);
	await page.waitForFunction(() => window.probe.urls.some((url) => url.endsWith("#done")));
	report.checks.viewer = await page.evaluate(() => window.probe);
	await page.screenshot({ path: join(artifacts, "loopback-viewer.png") });
	vite = launch(process.execPath, [resolve("node_modules/vite/bin/vite.js"), "--port", "1421", "--strictPort"], { cwd: resolve(".") });
	await until(async () => { try { return (await fetch("http://localhost:1421/tests/fixtures/agent-browser-spike/web/index.html")).ok; } catch { return false; } }, "Vite 1421");
	const vitePage = await viewerBrowser.newPage();
	await vitePage.goto(`http://localhost:1421/tests/fixtures/agent-browser-spike/web/index.html?port=${streamPort}`);
	await vitePage.waitForFunction(() => window.probe?.frames > 0);
	report.checks.vite = await vitePage.evaluate(() => ({ origin: location.origin, ...window.probe }));
	await vitePage.screenshot({ path: join(artifacts, "vite-viewer.png") });
	await vitePage.close();

	// Killing a CLI client is not a daemon cancellation protocol. Measure the actual effect.
	const late = launch(binary, [...flags, "--session", "main", "wait", "2500"]);
	await delay(350); late.kill();
	const afterKill = Date.now();
	await command("main", ["snapshot"]);
	report.checks.killedClient = { subsequentCommandBlockedMs: Date.now() - afterKill };
	assert.ok(report.checks.killedClient.subsequentCommandBlockedMs > 1500, "Expected the daemon to finish its in-flight wait despite killing the CLI");
	console.log("CLI cancellation:", JSON.stringify(report.checks.killedClient));
	await command("idle", ["--profile", join(root, "profile-idle"), "--idle-timeout", "1500", "open", baseUrl]);
	const idleInfo = (await command("idle", ["session", "info"])).json;
	report.checks.idleBefore = idleInfo;
	await delay(2300);
	report.checks.sessionsAfterIdle = (await command("main", ["session", "list"])).json;
	assert.ok(!JSON.stringify(report.checks.sessionsAfterIdle.data).includes('"idle"'), "Idle daemon should exit");

	if (process.argv.includes("--desktop")) {
		// Private probe app: unique identifier/profile, no workspace state is seeded.
		const project = join(artifacts, "native"); await mkdir(join(project, "src"), { recursive: true });
		for (const name of ["Cargo.toml", "build.rs", "tauri.conf.json"]) await copyFile(new URL(`./fixtures/agent-browser-spike/native/${name}`, import.meta.url), join(project, name));
		await copyFile(new URL("./fixtures/agent-browser-spike/native/src/main.rs", import.meta.url), join(project, "src/main.rs"));
		await mkdir(join(project, "web"), { recursive: true }); await writeFile(join(project, "web/index.html"), viewer);
		await mkdir(join(project, "icons"), { recursive: true });
		for (const icon of ["icon.ico", "32x32.png"]) await copyFile(resolve("src-tauri/icons", icon), join(project, "icons", icon));
		await copyFile(resolve("src-tauri/Cargo.lock"), join(project, "Cargo.lock"));
		console.log("Building isolated release WebView2 probe...");
		const build = await execute("cargo", ["build", "--release", "--manifest-path", join(project, "Cargo.toml"), "--target-dir", resolve("src-tauri/target")], { cwd: project });
		await writeFile(join(artifacts, "native-build.log"), build.stdout + build.stderr);
		assert.equal(build.code, 0, build.stderr.slice(-4000));
		const cdpPort = 9236;
		const bridgeToken = randomBytes(24).toString("hex");
		const bridgeInfo = join(root, "bridge.json");
		desktop = launch(resolve("src-tauri/target/release/skiff-browser-spike.exe"), [], { env: { ...env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`, SPIKE_STREAM_PORT: String(streamPort), SPIKE_BRIDGE_INFO: bridgeInfo, SPIKE_TOKEN: bridgeToken, SPIKE_BIN: binary, SPIKE_ARGS: JSON.stringify([...flags, "--session", "main"]) } });
		await until(async () => { try { return (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok; } catch { return false; } }, "release CDP", 30000);
		desktop = Object.assign(desktop, { connection: await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`) });
		const nativePage = await until(() => desktop.connection.contexts()[0]?.pages()[0], "release page");
		await nativePage.waitForURL(/tauri\.localhost/);
		await nativePage.waitForLoadState();
		report.checks.releaseOrigin = await nativePage.evaluate(() => location.origin);
		assert.equal(report.checks.releaseOrigin, "http://tauri.localhost");
		console.log("Release origin:", report.checks.releaseOrigin);
		await nativePage.waitForFunction(() => window.probe?.error);
		report.checks.releaseDirect = await nativePage.evaluate(() => window.probe);
		// Experiment-only origin-aware TCP proxy. Production service belongs to phase B.
		proxy = createServer();
		proxy.on("upgrade", (req, socket, head) => {
			if (req.headers.origin !== report.checks.releaseOrigin) return socket.destroy();
			const upstream = connect(streamPort, "127.0.0.1"); sockets.add(socket); sockets.add(upstream);
			upstream.on("connect", () => {
				const headers = Object.entries({ ...req.headers, host: `127.0.0.1:${streamPort}`, origin: baseUrl }).map(([key, value]) => `${key}: ${value}`).join("\r\n");
				upstream.write(`GET ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`); if (head.length) upstream.write(head);
				socket.pipe(upstream); upstream.pipe(socket);
			});
			upstream.on("error", () => socket.destroy()); socket.on("error", () => upstream.destroy());
			socket.on("close", () => { sockets.delete(socket); upstream.destroy(); }); upstream.on("close", () => { sockets.delete(upstream); socket.destroy(); });
		});
		await new Promise((done) => proxy.listen(0, "127.0.0.1", done));
		await nativePage.evaluate((port) => window.connectStream(port), proxy.address().port);
		await nativePage.waitForFunction(() => window.probe.frames > 0);
		await command("main", ["fill", "#name", "桌面接管"]);
		const canvas = nativePage.locator("canvas"); const bounds = await canvas.boundingBox();
		const width = await canvas.evaluate((element) => element.width);
		await canvas.click({ position: { x: (buttonBox.x + 10) * bounds.width / width, y: (buttonBox.y + 10) * bounds.width / width } });
		await until(async () => /完成：桌面接管/.test(JSON.stringify((await command("main", ["get", "text", "#result"])).json)), "release canvas click");
		await nativePage.screenshot({ path: join(artifacts, "release-viewer.png") });
		report.checks.releaseProxy = await nativePage.evaluate(() => window.probe);
		const piIndex = process.argv.indexOf("--pi");
		if (piIndex !== -1) await verifyPi(process.argv[piIndex + 1], JSON.parse(await readFile(bridgeInfo, "utf8")), bridgeToken);
	}
	report.success = true;
	console.log("PASS: phase A browser experiments", Object.keys(report.checks));
} catch (error) {
	report.success = false; report.error = error.stack; console.error(error); process.exitCode = 1;
} finally {
	if (pi) pi.kill();
	if (desktop?.connection) await desktop.connection.close();
	if (desktop) desktop.kill();
	if (viewerBrowser) await viewerBrowser.close();
	for (const session of sessions) { try { await command(session, ["close"], true); } catch {} }
	for (const child of children) child.kill();
	for (const socket of sockets) socket.destroy();
	site.close(); proxy?.close(); vite?.kill();
	await writeFile(join(artifacts, "results.json"), JSON.stringify(report, null, 2));
	// root is a newly created temp directory owned solely by this experiment.
	await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

async function verifyPi(cli, bridge, token) {
	const agentDir = join(root, "pi"); await mkdir(agentDir);
	let modelRequests = 0;
	const mock = createServer(async (request, response) => {
		let body = ""; for await (const chunk of request) body += chunk;
		const parsed = JSON.parse(body);
		const step = modelRequests++;
		const completed = step === 1;
		response.writeHead(200, { "Content-Type": "text/event-stream" });
		const delta = completed ? { content: "spike complete" } : { tool_calls: [{ index: 0, id: `spike-call-${step}`, type: "function", function: { name: "browser_spike", arguments: JSON.stringify({ wait: step > 1 }) } }] };
		for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: completed ? "stop" : "tool_calls" }]) response.write(`data: ${JSON.stringify({ id: "spike", object: "chat.completion.chunk", model: "spike", choices: [choice] })}\n\n`);
		response.end("data: [DONE]\n\n");
	});
	await new Promise((done) => mock.listen(0, "127.0.0.1", done));
	await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { spike: { api: "openai-completions", baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, models: [{ id: "spike", input: ["text"], contextWindow: 32000, maxTokens: 1024 }] } } }));
	await writeFile(join(agentDir, "auth.json"), JSON.stringify({ spike: { type: "api_key", key: "dummy-local-key" } }));
	await writeFile(join(root, "extension.js"), `export default function(pi) { pi.registerTool({name:"browser_spike",label:"Browser spike",description:"Local experiment",parameters:{type:"object",properties:{wait:{type:"boolean"}}},async execute(id,params,signal) { const response=await fetch(process.env.SPIKE_BRIDGE+(params.wait?"/command":"/snapshot"),{method:"POST",headers:{Authorization:"Bearer "+process.env.SPIKE_TOKEN},signal});return {content:[{type:"text",text:await response.text()}]}; }}); }`);
	pi = launch(process.execPath, [resolve(cli), "--mode", "rpc", "--provider", "spike", "--model", "spike", "--no-extensions", "--extension", join(root, "extension.js"), "--no-skills", "--no-context-files", "--offline"], { env: { ...env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", SPIKE_BRIDGE: bridge.url, SPIKE_TOKEN: token } });
	const events = []; let stderr = "";
	pi.stderr.on("data", (chunk) => { stderr += chunk; });
	createInterface({ input: pi.stdout }).on("line", (line) => { try { events.push(JSON.parse(line)); } catch {} });
	try {
		const unauthenticated = await fetch(`${bridge.url}/state`); assert.equal(unauthenticated.status, 401);
		pi.stdin.write(JSON.stringify({ type: "prompt", id: "spike-prompt", message: "Run local browser spike" }) + "\n");
		const headers = { Authorization: `Bearer ${token}` };
		await until(() => events.some((event) => event.type === "agent_end"), `pi completed snapshot; ${stderr}`, 30000);
		const result = events.find((event) => event.type === "tool_execution_end");
		assert.ok(JSON.stringify(result).includes("Skiff 浏览器验证"), JSON.stringify(events));
		pi.stdin.write(JSON.stringify({ type: "prompt", id: "spike-cancel-prompt", message: "Run long browser spike" }) + "\n");
		await until(async () => (await (await fetch(`${bridge.url}/state`, { headers })).json()).active, `pi extension bridge; ${stderr}`, 30000);
		pi.stdin.write(JSON.stringify({ type: "abort", id: "spike-abort" }) + "\n");
		await until(() => events.find((event) => event.type === "response" && event.id === "spike-abort"), "pi abort");
		const afterAbort = await (await fetch(`${bridge.url}/state`, { headers })).json();
		await fetch(`${bridge.url}/cancel`, { method: "POST", headers });
		await until(async () => !(await (await fetch(`${bridge.url}/state`, { headers })).json()).active, "native client cancellation");
		report.checks.pi = { snapshotRoundtrip: true, abort: events.find((event) => event.id === "spike-abort"), rustActiveAfterFetchAbort: afterAbort.active, eventTypes: [...new Set(events.map((event) => event.type))] };
	} finally { pi.kill(); mock.close(); }
}
