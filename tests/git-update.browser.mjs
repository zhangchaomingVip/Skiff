import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/git-update", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const updates = () => page.getByRole("button", { name: "Update Project", exact: true });
const assertUpdateLocation = async (selector) => {
	await page.locator(selector).getByRole("button", { name: "Update Project", exact: true }).waitFor();
	assert.equal(await updates().count(), 1);
	assert.equal(await updates().evaluate((element, selector) => !!element.closest(selector), selector), true);
};
const notice = () => page.locator(".commit-log > .workbench-banner").first();
try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		if (!await page.getByRole("tab", { name: "Git Tree", exact: true }).isVisible()) await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await page.getByRole("tab", { name: "Git Tree", exact: true }).click();
		await page.locator(".commit-metadata h2").waitFor();
		await assertUpdateLocation(".workbench-header-actions");
		assert.match(await updates().getAttribute("title"), /当前分支 main/);
		assert.equal(await updates().locator("svg path").getAttribute("d"), "M19 5 5 19M5 5v14h14");
		await page.evaluate(() => {
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.updateMode = "deferred";
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const value = await original(command, args);
				if (command !== "update_project_from_remote") return value;
				if (window.updateMode === "deferred") return new Promise((resolve) => { window.finishUpdate = () => resolve({ ...value, status: "updated" }); });
				if (window.updateMode === "error") throw new Error("存在未提交改动，已停止更新");
				return { ...value, status: window.updateMode };
			};
		});
		const before = await page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "list_project_directory").length);
		await updates().click();
		await page.waitForFunction(() => window.finishUpdate);
		assert.equal(await updates().isDisabled(), true);
		await page.getByRole("button", { name: "分支", exact: true }).click();
		await assertUpdateLocation(".git-log-toolbar");
		assert.equal(await updates().isDisabled(), true, "Collapsing the sidebar must preserve the pending update lock");
		await page.evaluate(() => window.finishUpdate());
		await page.waitForFunction(() => document.querySelector(".commit-log > .workbench-banner")?.textContent.includes("快进更新到"));
		await page.getByRole("button", { name: "分支", exact: true }).click();
		await assertUpdateLocation(".workbench-header-actions");
		await page.waitForFunction((before) => window.skiffPreview.commands.filter((item) => item.command === "list_project_directory").length > before, before);
		await page.getByRole("button", { name: "分支", exact: true }).click();
		await assertUpdateLocation(".git-log-toolbar");
		for (const [mode, expected] of [["upToDate", "已是最新"], ["ahead", "领先远程"], ["diverged", "已分叉"], ["error", "未提交改动"]]) {
			await page.evaluate((mode) => { window.updateMode = mode; }, mode);
			await updates().click();
			await page.waitForFunction((text) => document.querySelector(".commit-log > .workbench-banner")?.textContent.includes(text), expected);
			assert.equal(await notice().getAttribute("role"), mode === "error" ? "alert" : "status");
		}
		await page.screenshot({ path: `dist/git-update/${theme}.png` });
		await page.getByRole("button", { name: "分支", exact: true }).click();
		await assertUpdateLocation(".workbench-header-actions");
		await page.evaluate(() => { window.updateMode = "deferred"; window.finishUpdate = undefined; });
		await updates().click();
		await page.waitForFunction(() => window.finishUpdate);
		await page.getByRole("button", { name: /^浏览项目：/ }).click();
		await page.getByRole("option", { name: "aiagent", exact: true }).click();
		await page.waitForFunction(() => document.querySelector(".git-tree-scope")?.textContent.includes("aiagent"));
		await page.evaluate(() => window.finishUpdate());
		await page.waitForFunction(() => document.querySelector(".workbench-header-actions .git-update-project")?.disabled === false);
		assert.equal(await page.locator(".commit-log > .workbench-banner").count(), 0, "Old project result cannot appear in new project");
		console.log(`PASS ${theme}: single update button follows sidebar visibility, pending lock, status/error messages, file-tree invalidation and project isolation`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
