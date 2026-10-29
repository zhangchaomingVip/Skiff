import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/workbench-tabs", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(10000);
const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
const tab = (name) => page.getByRole("tab", { name, exact: true });

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		assert.equal(await tool("Commit").count(), 0);
		await tool("文件").click();
		await page.getByRole("tabpanel", { name: "文件", exact: true }).waitFor();
		assert.equal(await tab("文件").getAttribute("aria-selected"), "true");
		await page.locator('.file-tree-row[title="src"]').click();
		await page.locator('.file-tree-row[title="src/App.tsx"]').waitFor();
		await page.screenshot({ path: `dist/workbench-tabs/${theme}-files.png`, animations: "disabled" });
		await tab("Commit").click();
		await page.getByRole("checkbox", { name: "选择 src/App.tsx", exact: true }).check();
		await page.getByRole("textbox", { name: "提交信息" }).fill("preserve my commit draft");
		assert.equal(await tool("文件").getAttribute("aria-pressed"), "true");
		assert.equal(await page.getByRole("button", { name: "刷新文件树" }).count(), 0);
		await page.getByRole("button", { name: "刷新 Git 状态" }).waitFor();
		await page.screenshot({ path: `dist/workbench-tabs/${theme}-commit.png`, animations: "disabled" });
		await tab("Commit").focus(); await page.keyboard.press("ArrowLeft");
		assert.equal(await tab("文件").evaluate((element) => document.activeElement === element), true);
		await page.locator('.file-tree-row[title="src/App.tsx"]').waitFor();
		await page.keyboard.press("End");
		assert.equal(await tab("Commit").evaluate((element) => document.activeElement === element), true);
		assert.equal(await page.getByRole("textbox", { name: "提交信息" }).inputValue(), "preserve my commit draft");
		assert.equal(await page.getByRole("checkbox", { name: "选择 src/App.tsx", exact: true }).isChecked(), true);
		await tool("文件").click();
		await page.locator(".workbench-panel").waitFor({ state: "detached" });
		await tool("文件").click();
		assert.equal(await tab("Commit").getAttribute("aria-selected"), "true");
		await tool("对话").click(); await tool("文件").click();
		assert.equal(await tab("Commit").getAttribute("aria-selected"), "true");
		assert.equal(await page.getByRole("textbox", { name: "提交信息" }).inputValue(), "preserve my commit draft");
		await tool("Git Tree").click();
		await page.locator(".git-tree-workspace").waitFor();
		assert.equal(await page.getByRole("tablist", { name: "项目文件与提交" }).count(), 0);
		await tool("文件").click();
		assert.equal(await tab("Commit").getAttribute("aria-selected"), "true");
	}
	assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workbench.v1")).tool), "git");
	await page.setViewportSize({ width: 600, height: 680 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=dark`);
	await tool("文件").click();
	await tab("Commit").click();
	await page.getByRole("tabpanel", { name: "Commit", exact: true }).waitFor();
	assert.equal(await page.locator(".workbench-panel").evaluate((element) => element.scrollWidth <= element.clientWidth), true);
	await page.screenshot({ path: "dist/workbench-tabs/narrow.png", animations: "disabled" });
	console.log("Workbench tabs: light/dark, keyboard, file expansion, selections/drafts, reopen, activity navigation, saved preference and narrow layout passed.");
} finally { await browser.close(); }
