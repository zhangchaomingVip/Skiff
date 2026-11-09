import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const base = process.argv[2] || "http://127.0.0.1:1421";
const output = process.env.SKIFF_RETRY_SCREENSHOTS;
const providerError = '503: {"message":"No available workers (all circuits open or unhealthy)","type":"Service Unavailable","code":"no_available_workers","request_id":"retry-request-123"}';
const errors = []; page.on("pageerror", (error) => errors.push(error.message));
const wait = (fn) => page.waitForFunction(fn);
const emit = (event) => page.evaluate((event) => { const f = window.retryFixture, session = f.currentSession; const id = [...f.mock.processes.keys()].find((id) => f.mock.processes.get(id).file === session.sessionFile); f.mock.emit(id, event); }, event);
try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${base}/tests/preview.html?theme=${theme}`);
		await wait(() => !!window.skiffPreview);
		await page.goto(`${base}/tests/retry.html?theme=${theme}`);
		await wait(() => window.retryFixture?.currentSession?.connected);
		const input = page.getByRole("textbox", { name: "聊天消息", exact: true });
		await input.fill("测试自动重连"); await input.press("Enter");
		await wait(() => window.retryFixture.currentSession.state.isStreaming);
		await page.evaluate(() => { const f = window.retryFixture; const process = [...f.mock.processes.values()].find((p) => p.file === f.currentSession.sessionFile); clearTimeout(process.timer); process.isStreaming = false; });
		for (let attempt = 1; attempt <= 5; attempt++) {
			await emit({ type: "message_start", message: { role: "assistant" } });
			await emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: providerError } });
			await emit({ type: "auto_retry_start", attempt, maxAttempts: 5, errorMessage: providerError });
			await wait(() => window.retryFixture.currentSession.state.retrying);
			assert.match(await page.locator(".retry-progress").last().innerText(), new RegExp(`服务器繁忙，正在重新连接 ${attempt}/5`));
			assert.equal(await page.locator(".banner.error").count(), 0);
			assert.equal(await page.locator(".retry-progress").filter({ hasText: "正在重新连接" }).count(), 1);
		}
		const current = page.locator(".retry-progress").last();
		await current.getByRole("button", { name: /服务器繁忙/ }).click();
		assert.ok((await current.innerText()).includes("no_available_workers"));
		assert.ok((await current.innerText()).includes("retry-request-123"));
		await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.retryCopiedError = text; }; });
		await current.getByRole("button", { name: "复制错误", exact: true }).click();
		assert.equal(await page.evaluate(() => window.retryCopiedError), providerError);
		if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: `${output}/retry-${theme}.png` }); }
		assert.equal(await page.locator(".retry-progress").count(), 5);
		await page.getByRole("button", { name: "停止生成", exact: true }).click();
		await wait(() => !window.retryFixture.currentSession.state.isStreaming);
		assert.equal(await page.evaluate(() => window.retryFixture.currentSession.state.lastOutcome.reason), "manual");
		assert.equal(await page.locator(".retry-progress").filter({ hasText: "正在重新连接" }).count(), 0);
		assert.ok((await current.innerText()).includes("已停止重试"));
		assert.ok((await current.innerText()).includes("no_available_workers"));
		assert.ok(await page.evaluate(() => window.retryFixture.mock.commands.some((item) => item.command === "rpc_send" && JSON.parse(item.args.message).type === "abort")));
		console.log(`PASS ${theme}: inline 1/5–5/5, no error toast, stopping during backoff sends abort`);

		// Exhaustion must leave an inspectable error and an explicit retry action.
		await input.fill("验证重试耗尽"); await input.press("Enter");
		await wait(() => window.retryFixture.currentSession.state.isStreaming);
		await page.evaluate(() => { const f = window.retryFixture; const process = [...f.mock.processes.values()].find((p) => p.file === f.currentSession.sessionFile); clearTimeout(process.timer); process.isStreaming = false; });
		await emit({ type: "message_start", message: { role: "assistant" } });
		await emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: providerError } });
		await emit({ type: "auto_retry_start", attempt: 5, maxAttempts: 5, errorMessage: providerError });
		await emit({ type: "message_start", message: { role: "assistant" } });
		await emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: providerError } });
		await emit({ type: "auto_retry_end", success: false, finalError: providerError });
		await emit({ type: "agent_settled" });
		const failure = page.locator(".request-failure").last();
		await failure.getByRole("button", { name: "请求失败", exact: true }).click();
		assert.ok((await failure.innerText()).includes("No available workers"));
		assert.equal(await failure.locator(".tool-output").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true, "Long provider responses must wrap inside the error card");
		await failure.scrollIntoViewIfNeeded();
		if (output) await page.screenshot({ path: `${output}/exhausted-${theme}.png` });
		await failure.getByRole("button", { name: "重试", exact: true }).click();
		await wait(() => window.retryFixture.currentSession.state.isStreaming);
		await page.getByRole("button", { name: "停止生成", exact: true }).click();
		await wait(() => !window.retryFixture.currentSession.state.isStreaming);
		console.log(`PASS ${theme}: error details, copy, exhaustion and explicit retry`);

		await input.fill("验证中断回复"); await input.press("Enter");
		await wait(() => window.retryFixture.currentSession.state.isStreaming);
		await page.evaluate(() => { const f = window.retryFixture; const process = [...f.mock.processes.values()].find((p) => p.file === f.currentSession.sessionFile); clearTimeout(process.timer); process.isStreaming = false; });
		const partial = "首先检查配置。未完成的片段。";
		const completed = "首先检查配置。完整结论。";
		await emit({ type: "message_start", message: { role: "assistant" } });
		await emit({ type: "message_end", message: { role: "assistant", content: partial, stopReason: "error", errorMessage: "request timeout" } });
		await emit({ type: "auto_retry_start", attempt: 1, maxAttempts: 5, errorMessage: "request timeout" });
		await emit({ type: "message_start", message: { role: "assistant" } });
		assert.equal(await page.getByText(partial, { exact: true }).isVisible(), true, "Keep the partial reply until a replacement arrives");
		await emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: completed } });
		await emit({ type: "message_end", message: { role: "assistant", content: completed, stopReason: "stop" } });
		await emit({ type: "auto_retry_end", success: true });
		await emit({ type: "agent_settled" });
		const reply = page.locator(".assistant-reply").last();
		const old = reply.locator(".retry-superseded");
		await old.waitFor();
		assert.equal(await page.getByText(partial, { exact: true }).isVisible(), false);
		assert.equal(await page.getByText(completed, { exact: true }).isVisible(), true);
		await old.getByRole("button", { name: "已中断的回复 · 已重新生成" }).click();
		assert.equal(await page.getByText(partial, { exact: true }).isVisible(), true, "The failed attempt remains inspectable");
		await old.getByRole("button", { name: "已中断的回复 · 已重新生成" }).click();
		await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.retryCopiedText = text; }; });
		await reply.getByRole("button", { name: "复制消息", exact: true }).click();
		assert.equal(await page.evaluate(() => window.retryCopiedText), completed);
		if (output) await page.screenshot({ path: `${output}/recovered-${theme}.png` });
		console.log(`PASS ${theme}: partial reply folds after recovery, remains inspectable, copy contains only the replacement`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
