import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
await mkdir("dist/file-workspace", { recursive: true });

try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
		const empty = page.getByRole("region", { name: "文件工作区", exact: true });
		const chat = page.locator(".primary-view");
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.locator(".composer-input").fill("文件区切换后保留草稿");
		const chatId = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);
		await tool("文件").click();
		await empty.waitFor();
		assert.equal(await chat.isVisible(), false);
		assert.equal(await empty.locator("h1").innerText(), "打开一个文件");
		await page.screenshot({ path: `dist/file-workspace/${theme}-empty.png` });
		// Hiding the tree keeps the current workspace and active activity icon.
		await tool("文件").click();
		assert.equal(await tool("文件").getAttribute("aria-pressed"), "true");
		assert.equal(await tool("文件").getAttribute("aria-expanded"), "false");
		assert.equal(await empty.isVisible(), true);
		await tool("文件").click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		assert.equal(await empty.isVisible(), true);
		await page.getByRole("tab", { name: "文件", exact: true }).click();
		await page.locator('.file-tree-row[title="README.md"]').click();
		await page.locator(".source-preview").waitFor();
		assert.equal(await empty.count(), 0);
		await tool("对话").click();
		await chat.waitFor({ state: "visible" });
		assert.equal(await page.locator(".project-preview").count(), 0);
		assert.equal(await page.locator(".composer-input").inputValue(), "文件区切换后保留草稿");
		await tool("文件").click();
		await page.locator(".source-preview").waitFor();
		assert.equal(await page.locator(".preview-tab.active .preview-tab-open > span").innerText(), "README.md");
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		await chat.waitFor({ state: "visible" });
		assert.equal(await tool("对话").getAttribute("aria-pressed"), "true");
		await tool("文件").click();
		await page.getByRole("button", { name: "关闭 README.md", exact: true }).click();
		await empty.waitFor();
		assert.equal(await chat.isVisible(), false, "Closing the final file stays in the file workspace");
		await page.getByRole("button", { name: "浏览项目：Skiff", exact: true }).click();
		await page.getByRole("option", { name: "aiagent", exact: true }).click();
		assert.match(await empty.locator(".file-workspace-project").innerText(), /^aiagent/);
		await tool("Git Tree").click();
		await page.locator(".git-tree-workspace").waitFor();
		await tool("文件").click();
		await empty.waitFor();
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId), chatId);
		await page.setViewportSize({ width: 390, height: 760 });
		const drawer = page.getByRole("dialog", { name: "项目与聊天导航", exact: true });
		await drawer.waitFor();
		await page.keyboard.press("Escape");
		await drawer.waitFor({ state: "hidden" });
		await empty.waitFor();
		assert.equal(await chat.isVisible(), false);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.screenshot({ path: `dist/file-workspace/${theme}-narrow.png` });
		await tool("对话").click();
		await page.keyboard.press("Escape");
		await drawer.waitFor({ state: "hidden" });
		assert.equal(await page.locator(".composer-input").inputValue(), "文件区切换后保留草稿");
		assert.deepEqual(errors, []);
		console.log(`PASS ${theme}: file empty state, final close, workspace/tab restoration, project metadata, draft/chat preservation, collapsed tree and narrow layout`);
		await page.close();
	}
} finally { await browser.close(); }
