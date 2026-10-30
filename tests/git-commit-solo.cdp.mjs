// 临时脚本：只跑 verifyGitCommit 的精简 CDP 验证（验证后删除，不入库）。
// 复用 app.cdp.mjs 的启动/隔离机制，跳过聊天流与其它用例。
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { verifyGitCommit } from "./git-commit.cdp.mjs";

const CDP_PORT = 9222;
const MODEL_ID = "skiff-cdp-test";
const REPLY = "CDP 全链路验证成功：UI → Tauri IPC → Rust → pi → 本地 mock 模型。";
const repoRoot = process.cwd();
const artifacts = join(repoRoot, "dist");
await mkdir(artifacts, { recursive: true });

const require = createRequire(import.meta.url);
const { chromium } = require(join(repoRoot, ".playwright-cli/node_modules/playwright-core"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requests = [];
const server = createServer((request, response) => {
	const send = (status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(body); };
	if (request.method === "GET" && request.url === "/v1/models") return send(200, JSON.stringify({ data: [{ id: MODEL_ID }] }));
	if (request.method === "POST" && request.url === "/v1/chat/completions") {
		let body = "";
		request.on("data", (chunk) => { body += chunk; });
		request.on("end", () => {
			requests.push({ model: JSON.parse(body).model });
			if (!JSON.parse(body).stream) return send(200, JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }));
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			const base = { id: "cdp-verify", object: "chat.completion.chunk", created: 0, model: MODEL_ID };
			for (const chunk of [
				{ choices: [{ index: 0, delta: { role: "assistant", content: REPLY }, finish_reason: null }] },
				{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
			]) response.write(`data: ${JSON.stringify({ ...base, ...chunk })}\n\n`);
			response.end("data: [DONE]\n\n");
		});
		return;
	}
	send(404, "{}");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const mockPort = server.address().port;

const root = await mkdtemp(join(tmpdir(), "skiff-cdp-"));
const agentDir = join(root, "agent");
await mkdir(agentDir);
const families = {
	version: 5,
	relays: [{ id: "local-mock", name: "CDP 本地验证", baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: "dummy-local-key", protocol: "openai", timeoutSeconds: 60, enabled: true, billingAccountId: "", excludedModelIds: [], unassignedModels: [] }],
	families: [{ id: "glm", displayName: "GLM", routes: [{ id: "local-mock-glm", relayId: "local-mock", enabled: true, models: [{ modelId: MODEL_ID, alias: "cdp-test", inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }], streaming: true, tools: true, vision: false, reasoning: false }] }],
	autoFailover: false,
	autoRetry: false,
	usdCnyRate: 7.2,
};
await writeFile(join(agentDir, "skiff-families.json"), JSON.stringify(families, null, "\t"));

const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` };
const dev = spawn("cmd.exe", ["/c", "npm run tauri -- dev"], { cwd: repoRoot, env });
const devLog = [];
dev.stdout.on("data", (chunk) => devLog.push(chunk));
dev.stderr.on("data", (chunk) => devLog.push(chunk));
let devExit;
dev.on("exit", (code, signal) => { devExit = `${code ?? signal}`; });

const writeArtifacts = async () => { await writeFile(join(artifacts, "cdp-dev.log"), devLog.join("")).catch(() => {}); };
const cleanup = async () => {
	await new Promise((resolve) => { execFile("taskkill", ["/PID", String(dev.pid), "/T", "/F"], () => resolve()); });
	server.close();
	await rm(root, { recursive: true, force: true }).catch(() => {});
	await writeArtifacts();
};

let browser;
let page;
let storageSnapshot;
try {
	const cdpUrl = `http://127.0.0.1:${CDP_PORT}`;
	const cdpDeadline = Date.now() + 15 * 60_000;
	let waited = 0;
	while (true) {
		try { if ((await fetch(`${cdpUrl}/json/version`)).ok) break; } catch {}
		if (devExit !== undefined) throw new Error(`桌面进程已退出（${devExit}）：\n${devLog.join("").slice(-2000)}`);
		if (Date.now() > cdpDeadline) throw new Error(`等待 CDP 端点超时（15 分钟）。dev 日志尾部：\n${devLog.join("").slice(-2000)}`);
		await sleep(800);
		waited += 0.8;
	}
	console.log("CDP 端点已就绪，正在附身窗口…");
	browser = await chromium.connectOverCDP(cdpUrl);
	const context = browser.contexts()[0];
	if (!context) throw new Error("CDP 已连接但没有任何浏览器上下文。");
	const pageDeadline = Date.now() + 60_000;
	while (!context.pages().some((item) => item.url().includes("localhost:1420"))) {
		if (Date.now() > pageDeadline) throw new Error(`未找到应用页面，现有页面：${context.pages().map((item) => item.url()).join(", ")}`);
		await sleep(500);
	}
	page = context.pages().find((candidate) => candidate.url().includes("localhost:1420"));

	storageSnapshot = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
	await writeFile(join(artifacts, "cdp-localstorage-backup.json"), JSON.stringify(storageSnapshot, null, "\t")).catch(() => {});
	console.log(`已快照 ${Object.keys(storageSnapshot).length} 个 localStorage 键，退出时会还原`);

	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector(".workbench-shell, body", { timeout: 60_000 });
	await sleep(1500);
	const commitRepo = await verifyGitCommit(page, root, artifacts);
	console.log(`git commit 全链路通过，fixture 仓库：${commitRepo}`);
} catch (error) {
	await writeArtifacts();
	console.error(`\n验证失败：${error.message}`);
	console.error(`dev 日志尾部：\n${devLog.join("").slice(-2000)}`);
	process.exitCode = 1;
} finally {
	if (page && storageSnapshot) {
		const restored = await page.evaluate((snapshot) => {
			localStorage.clear();
			for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
			return Object.keys(localStorage).length;
		}, storageSnapshot).catch(() => 0);
		await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
		await sleep(8000);
		console.log(`\n已还原 localStorage（${restored} 个键）`);
	}
	if (browser) await browser.close().catch(() => {});
	await cleanup();
}
