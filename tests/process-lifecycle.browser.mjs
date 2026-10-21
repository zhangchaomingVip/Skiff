import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1421";
const shots = process.argv[3] ?? "docs/screenshots/process-lifecycle";
const firstLine = "### 3. write （创建文件）**核对 `settings.json` 的读取方式**，并检查回退规则。";
const narration = `${firstLine}\n第二行正文必须完整保留。`;
const secondNarration = "接下来核对历史消息的解析顺序，并运行完整测试。";
const user = { role: "user", content: "核对每段旁白与终态统计" };
const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
const result = (id, name) => ({ role: "toolResult", toolCallId: id, name, content: "完成" });
const assistant = (content, stopReason) => ({ role: "assistant", content, stopReason });
const first = assistant([{ type: "text", text: narration }, call("bash-a", "bash", { command: "npm test" }), call("web-a", "web_search", { query: "Skiff" })]);
const body = assistant("第一段正文完整保留。后面还会继续执行工具。");
const second = assistant([{ type: "text", text: secondNarration }, call("read-b", "read", { path: "README.md" })]);
const tail = assistant("尾段正文完整保留。", "stop");
await mkdir(shots, { recursive: true });
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1100, height: 750 }, deviceScaleFactor: 1 });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/turn-usage.html`);
		await page.waitForFunction(() => window.turnUsageHarness);
		await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
		const labels = () => page.locator(".turn-process > summary .process-row-label");
		const render = async (messages, running) => {
			await page.evaluate((props) => window.turnUsageHarness.render(props), { messages, running, activeTurnId: running ? "turn:history_0" : undefined });
			await page.waitForFunction((count) => document.querySelectorAll(".turn-process > summary .process-row-label").length >= count, messages.some((message) => message === second) ? 2 : 1);
		};
		await render([user, first, result("bash-a", "bash")], true);
		const liveLabel = await labels().first().textContent();
		assert.match(liveLabel, /^核对 settings\.json 的读取/);
		assert.match(liveLabel, /正在并行运行 2 个工具（1\/2）/);
		assert.doesNotMatch(liveLabel, /[#*`]|3\. write|已执行/);
		assert.match(await page.locator(".msg.assistant .md").first().textContent(), /第二行正文必须完整保留/);
		await page.screenshot({ path: `${shots}/live-${theme}.png`, fullPage: true });

		await render([user, first, result("bash-a", "bash"), body], true);
		await page.waitForFunction(() => document.querySelector(".turn-process > summary .process-row-label")?.textContent?.startsWith("执行了 1 条命令"));
		const frozen = await labels().first().textContent();
		assert.match(frozen, /^执行了 1 条命令 · 联网搜索了 1 次 · 步骤 2/);
		assert.doesNotMatch(frozen, /核对 settings|正在并行|已执行/);
		await render([user, first, result("bash-a", "bash"), result("web-a", "web_search"), body, second], true);
		assert.equal(await labels().first().textContent(), frozen);
		assert.match(await labels().nth(1).textContent(), /^接下来核对历史消息的解析顺序/);
		assert.deepEqual((await page.locator(".msg.assistant .md").allTextContents()).map((text) => text.trim()), ["3. write （创建文件）核对 settings.json 的读取方式，并检查回退规则。\n第二行正文必须完整保留。", "第一段正文完整保留。后面还会继续执行工具。", secondNarration]);
		await page.screenshot({ path: `${shots}/next-segment-${theme}.png`, fullPage: true });

		await render([user, first, result("bash-a", "bash"), result("web-a", "web_search"), body, second, result("read-b", "read"), tail], true);
		await page.waitForFunction(() => [...document.querySelectorAll(".turn-process > summary .process-row-label")][1]?.textContent?.startsWith("读取了 1 个文件"));
		const settled = await labels().allTextContents();
		assert.match(settled[1], /^读取了 1 个文件/);
		await render([user, first, result("bash-a", "bash"), result("web-a", "web_search"), body, second, result("read-b", "read"), tail], false);
		assert.deepEqual(await labels().allTextContents(), settled);
		assert.deepEqual(errors, []);
		await page.screenshot({ path: `${shots}/settled-${theme}.png`, fullPage: true });
		console.log(`${theme}: live=${liveLabel}, frozen=${frozen}, settled=${settled.join(" | ")}`);
		await page.close();
	}
} finally {
	await browser.close();
}
