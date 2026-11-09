import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(join(process.cwd(), ".playwright-cli/node_modules/playwright-core"));
const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
		await page.goto(`${origin}/tests/preview.html?fixture=browser&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => { window.skiffPreview.browser.setEnabled(true); window.skiffPreview.browser.set("browser-a"); window.skiffPreview.browser.set("browser-b"); });
		await page.locator('.browser-screen[data-phase="live"]').waitFor();
		// A pending takeover must not lock a different chat's controls.
		await page.evaluate(() => { window.releaseA = window.skiffPreview.browser.deferControl(); });
		await page.getByRole("button", { name: "接管浏览器", exact: true }).click();
		await page.getByText("正在接管，请等待在途操作结束…", { exact: true }).waitFor();
		await page.locator(".sidebar .chat-link").filter({ hasText: "浏览任务 B" }).first().click();
		await page.waitForFunction(() => document.querySelector(".browser-panel")?.dataset.chatId === "browser-b");
		await page.getByRole("button", { name: "接管浏览器", exact: true }).click();
		await page.getByRole("textbox", { name: "浏览器键盘输入", exact: true }).waitFor();
		await page.evaluate(() => window.releaseA());
		assert.equal(await page.locator(".browser-panel").getAttribute("data-chat-id"), "browser-b");
		await page.locator(".sidebar .chat-link").filter({ hasText: "浏览任务 A" }).first().click();
		await page.getByRole("textbox", { name: "浏览器键盘输入", exact: true }).waitFor();
		// Failed native cleanup keeps index; retry closes browser before archiving.
		await page.evaluate(() => window.skiffPreview.browser.failLifecycle("模拟回收失败"));
		const archive = async () => {
			await page.locator(".sidebar .chat-row").filter({ hasText: "浏览任务 A" }).first().click({ button: "right" });
			await page.getByRole("menu").getByRole("button", { name: "归档", exact: true }).click();
		};
		await archive();
		await page.getByRole("alert").filter({ hasText: "模拟回收失败" }).waitFor();
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "browser-a").archivedAt), undefined);
		await page.evaluate(() => { window.releaseArchive = window.skiffPreview.browser.deferLifecycle(); });
		await archive();
		await page.waitForFunction(() => document.querySelector(".send-btn")?.disabled === true);
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "browser-a").archivedAt), undefined, "Index remains until resource cleanup confirms");
		await page.evaluate(() => window.releaseArchive());
		await page.waitForFunction(() => !!JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "browser-a").archivedAt);
		assert.equal(await page.evaluate(() => window.skiffPreview.browser.entries.has("browser-a")), false);
		assert.equal(await page.evaluate(() => window.skiffPreview.browser.entries.get("browser-b").control), "human");
		await page.keyboard.press("Control+Comma"); await page.getByRole("button", { name: "归档会话", exact: true }).click();
		await page.locator(".archive-session-row").filter({ hasText: "浏览任务 A" }).getByRole("button", { name: "恢复", exact: true }).click();
		await page.waitForFunction(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId === "browser-a" && document.querySelector(".sidebar")?.dataset.connected === "true");
		assert.equal(await page.locator(".browser-panel").count(), 0, "Archive restore never starts or reopens old viewer");
		assert.equal(await page.evaluate(() => window.skiffPreview.browser.entries.has("browser-a")), false);
		await page.evaluate(() => window.skiffPreview.browser.set("browser-a", { generation: "restored-a" }));
		await page.waitForFunction(() => document.querySelector(".browser-panel")?.dataset.generation === "restored-a");
		await archive(); await page.waitForFunction(() => !!JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "browser-a").archivedAt);
		await page.keyboard.press("Control+Comma"); await page.getByRole("button", { name: "归档会话", exact: true }).click();
		await page.getByRole("button", { name: "删除归档 浏览任务 A", exact: true }).click();
		await page.getByRole("button", { name: "确认删除", exact: true }).click();
		await page.waitForFunction(() => !JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.some((chat) => chat.id === "browser-a"));
		assert.ok(await page.evaluate(() => window.skiffPreview.browser.calls.some((call) => call.command === "browser_retire_chat" && call.args.chatId === "browser-a" && call.args.deleteProfile === true)));
		assert.equal(await page.evaluate(() => window.skiffPreview.browser.entries.get("browser-b").control), "human");
		assert.deepEqual(errors, []); await page.close();
	}
	console.log("PASS browser lifecycle: independent pending controls, archive cleanup/failure retry, lazy restore, deletion profile flag and other-chat preservation in both themes");
} finally { await browser.close(); }
