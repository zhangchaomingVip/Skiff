import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
const base = process.argv[2] || "http://127.0.0.1:1421";
const output = process.env.SKIFF_RETRY_SCREENSHOTS;
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
			await emit({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "503 server busy" } });
			await emit({ type: "auto_retry_start", attempt, maxAttempts: 5, errorMessage: "503 server busy" });
			await wait(() => window.retryFixture.currentSession.state.retrying);
			assert.match(await page.locator(".retry-progress").last().innerText(), new RegExp(`服务器繁忙，正在重新连接 ${attempt}/5`));
			assert.equal(await page.locator(".banner.error").count(), 0);
		}
		if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: `${output}/retry-${theme}.png` }); }
		assert.equal(await page.locator(".retry-progress").count(), 5);
		await page.getByRole("button", { name: "停止生成", exact: true }).click();
		await wait(() => !window.retryFixture.currentSession.state.isStreaming);
		assert.equal(await page.evaluate(() => window.retryFixture.currentSession.state.lastOutcome.reason), "manual");
		assert.ok(await page.evaluate(() => window.retryFixture.mock.commands.some((item) => item.command === "rpc_send" && JSON.parse(item.args.message).type === "abort")));
		console.log(`PASS ${theme}: inline 1/5–5/5, no error toast, stopping during backoff sends abort`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
