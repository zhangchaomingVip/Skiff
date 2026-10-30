// CDP 全链路验证：附身真实桌面窗口（WebView2），一次跑通 UI → Tauri IPC → Rust → pi → provider。
// 用法：node tests/app.cdp.mjs
//
// 与 `pi.integration.mjs` 同样的思路：临时 agent 目录 + 本地 mock OpenAI 服务，
// 不发外部请求、不消耗 token、不触碰 ~/.pi 下的真实会话与配置。区别在于这里
// 连 UI 与 Rust 桥接一起验证：脚本自动拉起 `npm run tauri -- dev`，注入
// CDP 远程调试端口，通过 localStorage 预置工程列表（绕开原生目录选择框），
// 在真实窗口里发送一条消息并断言流式回复渲染到 DOM。
//
// 前置：`npm i --prefix .playwright-cli playwright-core`（只需要 core，不下载浏览器）；
// 1420 与 9222 端口空闲；截图与 dev 日志写入 dist/。
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { SKIFF_IDENTITY_PROMPT } from "../src/chat/prompt.ts";
import { verifyGitTree } from "./git-tree.cdp.mjs";
import { verifyGitCommit } from "./git-commit.cdp.mjs";
import { verifyFileContextMenu } from "./file-context-menu.cdp.mjs";
import { verifyFileTreeRefresh } from "./file-tree-refresh.cdp.mjs";
import { verifyDraftAttachments } from "./draft-attachments.cdp.mjs";

const CDP_PORT = 9222;
const MODEL_ID = "skiff-cdp-test";
const REPLY = "CDP 全链路验证成功：UI → Tauri IPC → Rust → pi → 本地 mock 模型。";
const repoRoot = process.cwd();
const artifacts = join(repoRoot, "dist");
await mkdir(artifacts, { recursive: true });

const require = createRequire(import.meta.url);
// playwright-core 固定装在 .playwright-cli/node_modules（不入库，见 .gitignore）。
// 只用来 connectOverCDP 附身已有 WebView2，不需要浏览器内核，所以不放进根依赖。
function loadPlaywright() {
	try { return require(join(repoRoot, ".playwright-cli/node_modules/playwright-core")); }
	catch {
		throw new Error("缺少 Playwright：在项目根运行 `npm i --prefix .playwright-cli playwright-core`。");
	}
}
const { chromium } = loadPlaywright();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- 本地 mock provider（与 pi.integration.mjs 相同的 SSE 形状）----------------
const requests = [];
const server = createServer((request, response) => {
	const send = (status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(body); };
	if (request.method === "GET" && request.url === "/v1/models") return send(200, JSON.stringify({ data: [{ id: MODEL_ID }] }));
	if (request.method === "POST" && request.url === "/v1/chat/completions") {
		let body = "";
		request.on("data", (chunk) => { body += chunk; });
		request.on("end", () => {
			try {
				const parsed = JSON.parse(body);
				const systemText = (parsed.messages ?? []).filter((message) => message.role === "system" || message.role === "developer")
					.map((message) => typeof message.content === "string" ? message.content : (message.content ?? []).map((part) => part.text ?? "").join("\n")).join("\n");
				requests.push({ model: parsed.model, messageCount: parsed.messages?.length ?? 0, systemText });
				if (parsed.model === "test-html") {
					response.writeHead(200, { "Content-Type": "text/html" });
					response.end("<!doctype html><html>Provider website</html>"); return;
				}
				if (parsed.model === "test-empty") return send(200, JSON.stringify({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }] }));
				if (parsed.model === "test-error") return send(200, JSON.stringify({ error: { message: "upstream failed" } }));
				if (!parsed.stream) return send(200, JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }));
				response.writeHead(200, { "Content-Type": "text/event-stream" });
				const base = { id: "cdp-verify", object: "chat.completion.chunk", created: 0, model: MODEL_ID };
				for (const chunk of [
					{ choices: [{ index: 0, delta: { role: "assistant", content: REPLY }, finish_reason: null }] },
					{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
					{ choices: [], usage: { prompt_tokens: 12, completion_tokens: 20, total_tokens: 32 } },
				]) response.write(`data: ${JSON.stringify({ ...base, ...chunk })}\n\n`);
				response.end("data: [DONE]\n\n");
			} catch (error) { send(500, String(error)); }
		});
		return;
	}
	send(404, "{}");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const mockPort = server.address().port;

// --- 临时 agent 目录：只预置 Skiff 自己的中继配置，投影由 prepare_runtime 完成 --
const root = await mkdtemp(join(tmpdir(), "skiff-cdp-"));
const agentDir = join(root, "agent");
await mkdir(agentDir);
const families = {
	version: 5,
	relays: [{
		id: "local-mock",
		name: "CDP 本地验证",
		baseUrl: `http://127.0.0.1:${mockPort}/v1`,
		apiKey: "dummy-local-key",
		protocol: "openai",
		timeoutSeconds: 60,
		enabled: true,
		billingAccountId: "",
		excludedModelIds: [],
		unassignedModels: [],
	}],
	families: [{
		id: "glm",
		displayName: "GLM",
		routes: [{
			id: "local-mock-glm",
			relayId: "local-mock",
			enabled: true,
			models: [{ modelId: MODEL_ID, alias: "cdp-test", inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }],
			streaming: true,
			tools: true,
			vision: false,
			reasoning: false,
		}],
	}],
	autoFailover: false,
	autoRetry: false,
	usdCnyRate: 7.2,
};
await writeFile(join(agentDir, "skiff-families.json"), JSON.stringify(families, null, "\t"));

// --- 拉起桌面 dev 实例（CDP 调试端口 + 临时数据目录）----------------------------
const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir, WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` };
// Optional already-built debug binary, for verification while a developer's
// Vite/Tauri instance owns port 1420. Copy it and isolate WebView2 storage so
// neither its executable nor its workspace can be affected by this run.
let executable;
if (process.env.SKIFF_CDP_BINARY) {
	executable = join(root, "skiff-cdp.exe");
	await copyFile(process.env.SKIFF_CDP_BINARY, executable);
}
const dev = executable ? spawn(executable, [], { cwd: repoRoot, env }) : spawn("cmd.exe", ["/c", "npm run tauri -- dev"], { cwd: repoRoot, env });
const devLog = [];
dev.stdout.on("data", (chunk) => devLog.push(chunk));
dev.stderr.on("data", (chunk) => devLog.push(chunk));
let devExit;
dev.on("exit", (code, signal) => { devExit = `${code ?? signal}`; });

const writeArtifacts = async () => {
	await writeFile(join(artifacts, "cdp-dev.log"), devLog.join("")).catch(() => {});
};
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
	// 等待 CDP 端点：包含首次 cargo 增量编译的时间。
	const cdpUrl = `http://127.0.0.1:${CDP_PORT}`;
	const cdpDeadline = Date.now() + 15 * 60_000;
	let waited = 0;
	while (true) {
		try { if ((await fetch(`${cdpUrl}/json/version`)).ok) break; } catch {}
		if (devExit !== undefined) throw new Error(`桌面进程已退出（${devExit}）：\n${devLog.join("").slice(-2000)}`);
		if (Date.now() > cdpDeadline) throw new Error(`等待 CDP 端点超时（15 分钟）。dev 日志尾部：\n${devLog.join("").slice(-2000)}`);
		await sleep(800);
		waited += 0.8;
		if (Math.round(waited) % 30 === 0) console.log(`仍在等待桌面窗口（已等 ${Math.round(waited)}s）…`);
	}
	console.log("CDP 端点已就绪，正在附身窗口…");

	browser = await chromium.connectOverCDP(cdpUrl);
	const context = browser.contexts()[0];
	if (!context) throw new Error("CDP 已连接但没有任何浏览器上下文。");
	const pageDeadline = Date.now() + 60_000;
	while (!context.pages().some((page) => page.url().includes("localhost:1420"))) {
		if (Date.now() > pageDeadline) throw new Error(`未找到应用页面，现有页面：${context.pages().map((page) => page.url()).join(", ")}`);
		await sleep(500);
	}
	page = context.pages().find((candidate) => candidate.url().includes("localhost:1420"));
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(String(error)));

	// 使用临时 WebView2 profile，同时保留快照/还原保护。
	// 草稿包含 IndexedDB 实体，仅备份 localStorage 不足以隔离附件测试。
	storageSnapshot = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
	await writeFile(join(artifacts, "cdp-localstorage-backup.json"), JSON.stringify(storageSnapshot, null, "\t")).catch(() => {});
	console.log(`已快照 ${Object.keys(storageSnapshot).length} 个 localStorage 键，退出时会还原`);

	// 预置工程与聊天，再重载，让应用带着工作区启动。
	const seed = {
		version: 1,
		projects: [{ id: "p-cdp", name: "Skiff 源码", path: repoRoot }],
		chats: [{ id: "c-cdp", projectId: "p-cdp", title: "CDP 全链路验证", createdAt: Date.now(), updatedAt: Date.now(), hasMessages: false }],
		activeId: "c-cdp",
	};
	await page.evaluate((value) => {
		localStorage.setItem("skiff.workspace.v1", JSON.stringify(value));
		localStorage.setItem("skiff.prompt.append", ""); // Existing explicit empty preferences must still receive product identity.
	}, seed);
	await page.reload({ waitUntil: "domcontentloaded" });

	// 空会话默认进启动台（App 的 currentView 由 hasMessages/hasDraft 决定），
	// 输入框只存在于聊天视图，所以先走一次真实点击：选模型 → 开始聊天。
	const startButton = page.locator(".launcher-row", { hasText: MODEL_ID }).getByRole("button", { name: "开始聊天" });
	try {
		await startButton.waitFor({ state: "visible", timeout: 120_000 });
	} catch (error) {
		throw new Error(`启动台没有出现可用模型 ${MODEL_ID}：${error.message.split("\n")[0]}。页面文本：\n${(await page.evaluate(() => document.body.innerText)).slice(0, 800)}`);
	}
	await startButton.click();
	console.log("已在启动台点击「开始聊天」，等待聊天视图…");

	await page.waitForSelector(".composer-input", { timeout: 60_000 });
	await verifyDraftAttachments(page);
	await page.fill(".composer-input", "请原样回复一句话，用于验证链路。");
	await page.click(".send-btn", { timeout: 60_000 });
	console.log("消息已发送，等待 pi 经由本地 mock 返回流式回复…");

	await page.waitForFunction((reply) => document.body.innerText.includes(reply), REPLY, { timeout: 90_000 });
	await sleep(500);
	const shotPath = join(artifacts, "cdp-verify.png");
	await page.screenshot({ path: shotPath });

	if (!requests.length) throw new Error("UI 渲染了回复，但本地 mock 没有收到请求，链路不完整。");
	if (requests[0].model !== MODEL_ID) throw new Error(`pi 请求了错误的模型：${requests[0].model}`);
	assert.ok(requests[0].systemText.includes(SKIFF_IDENTITY_PROMPT), "Built-in identity must reach the provider even with an explicitly empty preference");

	// Save through the real settings UI and restart the session. Both the built-in
	// identity and user-authored multiline text must reach the next provider request.
	await page.keyboard.press("Control+Comma");
	const settings = page.getByRole("dialog", { name: "设置", exact: true });
	await settings.getByRole("button", { name: "系统提示词", exact: true }).click();
	const editor = settings.getByRole("textbox", { name: "附加指令" });
	assert.equal(await editor.inputValue(), "", "The editor must not contain built-in instructions");
	const customPrompt = "自定义验证指令：用简洁中文回答。\n保留用户的第二行指令。";
	await editor.fill(customPrompt);
	await settings.getByRole("button", { name: "保存并重启", exact: true }).click();
	await settings.waitFor({ state: "detached" });
	await page.fill(".composer-input", "再次验证附加指令。");
	await page.click(".send-btn", { timeout: 60_000 });
	await page.waitForFunction((reply) => [...document.querySelectorAll(".md")].filter((node) => node.textContent.includes(reply)).length >= 2, REPLY, { timeout: 90_000 });
	assert.equal(requests.length, 2);
	assert.ok(requests[1].systemText.includes(SKIFF_IDENTITY_PROMPT), "Identity must survive saving user instructions and reconnecting");
	assert.ok(requests[1].systemText.includes(customPrompt.replace(/\n/g, " ")), "Multiline user instructions must survive the native CLI argument path");
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.prompt.append")), customPrompt);
	for (const request of requests) {
		assert.ok(!request.systemText.includes("You can inspect PI_* environment variables"), "Skiff must remove pi's model-lookup guidance before the provider request");
		assert.ok(request.systemText.includes("Use read to examine files"), "Other built-in tool rules must survive");
	}
	console.log("身份提示词验证通过：已存空值、自定义多行指令、保存重启均到达真实 pi 请求。");
	if (pageErrors.length) throw new Error(`页面出现未捕获异常：${pageErrors.join(" | ")}`);

	// Exercise the same native command as the model-test buttons, over real IPC.
	// HTTP 200 without a model reply must never pass or leave a successful record.
	for (const modelId of [MODEL_ID, "test-html", "test-empty", "test-error"]) {
		const result = await page.evaluate(async ({ baseUrl, modelId }) => {
			return window.__TAURI_INTERNALS__.invoke("test_provider_connection", {
				baseUrl, apiKey: "dummy-local-key", modelId, protocol: "openai", timeoutSeconds: 5,
				requestId: crypto.randomUUID(),
			});
		}, { baseUrl: `http://127.0.0.1:${mockPort}/v1`, modelId });
		if (result.ok !== (modelId === MODEL_ID) || result.status !== 200) throw new Error(`模型测试误判 ${modelId}: ${JSON.stringify(result)}`);
		console.log(`模型测试 ${modelId}: ${result.ok ? "成功（有真实文本）" : result.error}`);
	}

	await verifyFileTreeRefresh(page, root, artifacts, MODEL_ID, REPLY);
	await verifyGitTree(page, root, artifacts);
	const commitRoot = await verifyGitCommit(page, root, artifacts);
	await verifyFileContextMenu(page, commitRoot, artifacts);
	assert.deepEqual(pageErrors, [], "No uncaught errors after Git Tree verification");
	console.log(`\n验证通过：\n- mock 收到 ${requests.length} 次请求，model=${requests[0].model}，messages=${requests[0].messageCount}\n- 回复已渲染到真实窗口 DOM\n- 页面无未捕获异常\n- 截图：${shotPath}`);
} catch (error) {
	await writeArtifacts();
	console.error(`\n验证失败：${error.message}`);
	console.error(`dev 日志尾部：\n${devLog.join("").slice(-2000)}`);
	process.exitCode = 1;
} finally {
	// 还原真实工作区索引：先写回快照，再重载让应用按自己的规则重新持久化，然后才杀进程。
	if (page && storageSnapshot) {
		const restored = await page.evaluate((snapshot) => {
			localStorage.clear();
			for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
			return Object.keys(localStorage).length;
		}, storageSnapshot).catch(() => 0);
		await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
		// Chromium 的 localStorage 落盘有延迟；立刻 taskkill /F 会让还原值丢在内存里。
		await sleep(8000);
		console.log(`\n已还原 localStorage（${restored} 个键），项目与聊天列表未被污染`);
	}
	if (browser) await browser.close().catch(() => {});
	await cleanup();
}
