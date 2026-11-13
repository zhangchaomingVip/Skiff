import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/git-tree", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const openHistory = async () => {
	await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).waitFor();
	if (!await page.getByRole("tab", { name: "Git Tree", exact: true }).isVisible()) await tool("文件").click();
	await page.getByRole("tab", { name: "Git Tree", exact: true }).click();
};
const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
const update = () => page.getByRole("button", { name: "Update Project", exact: true });
const assertUpdateLocation = async (selector) => {
	await page.locator(selector).getByRole("button", { name: "Update Project", exact: true }).waitFor();
	assert.equal(await update().count(), 1);
};
try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		const chat = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);
		assert.deepEqual(await page.locator(".activity-button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["对话", "文件", "设置"]);
		await openHistory();
		await page.locator(".commit-metadata h2").waitFor();
		await assertUpdateLocation(".workbench-header-actions");
		assert.equal(await page.locator(".git-branches .workbench-toolbar").count(), 0);
		assert.equal(await page.getByRole("option").count(), 13);
		const files = page.getByRole("region", { name: "提交变更文件", exact: true });
		await files.getByRole("button", { name: "全部折叠", exact: true }).click();
		assert.equal(await files.locator("details[open]").count(), 0);
		assert.equal(await files.getByRole("button", { name: "GitTree.tsx A", exact: true }).isVisible(), false);
		await files.getByRole("button", { name: "全部展开", exact: true }).click();
		assert.equal(await files.locator("details:not([open])").count(), 0);
		assert.equal(await files.getByRole("button", { name: "GitTree.tsx A", exact: true }).isVisible(), true);
		await page.mouse.move(700, 700);
		await page.screenshot({ path: `dist/git-tree/${theme}.png` });
		await tool("文件").click();
		await assertUpdateLocation(".git-log-toolbar");
		await page.getByRole("button", { name: "分支", exact: true }).click();
		await assertUpdateLocation(".workbench-header-actions");
		const reads = await page.evaluate(() => window.skiffPreview.commands.filter((item) => ["get_project_git_history", "get_project_git_commit"].includes(item.command)).length);
		await page.locator(".commit-log-list, .commit-details").evaluateAll((elements) => elements.forEach((element) => { element.dataset.retained = "yes"; }));
		await page.getByRole("textbox", { name: "搜索已加载提交" }).fill("主题");
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.getByRole("tab", { name: "Git Tree", exact: true }).click();
		await page.locator(".commit-metadata h2").waitFor();
		assert.equal(await page.getByRole("textbox", { name: "搜索已加载提交" }).inputValue(), "主题");
		assert.equal(await page.locator(".commit-log-list, .commit-details").evaluateAll((elements) => elements.every((element) => element.dataset.retained === "yes")), true);
		assert.equal(await page.evaluate(() => window.skiffPreview.commands.filter((item) => ["get_project_git_history", "get_project_git_commit"].includes(item.command)).length), reads, "Reopening unchanged history must reuse the list and details without new reads");
		await page.getByRole("textbox", { name: "搜索已加载提交" }).fill("");
		await page.getByRole("option").nth(1).focus();
		await page.keyboard.press("ArrowDown");
		assert.equal(await page.getByRole("option").nth(2).getAttribute("aria-selected"), "true");
		await page.getByRole("button", { name: "GitTree.tsx A", exact: true }).click();
		await page.locator(".history-diff .diff-preview").waitFor();
		assert.match(await page.locator(".history-diff").textContent(), /GitTreeWorkspace/);
		await page.getByRole("button", { name: "关闭历史 Diff" }).click();
		await page.getByRole("textbox", { name: "搜索已加载提交" }).fill("主题");
		assert.equal(await page.getByRole("option").count(), 2);
		assert.equal(await page.locator(".commit-graph path").count(), 0);
		await page.getByRole("textbox", { name: "搜索已加载提交" }).fill("");
		await page.getByRole("textbox", { name: "搜索分支或标签" }).fill("git-tree");
		await page.getByRole("button", { name: "feature/git-tree", exact: true }).click();
		await page.waitForFunction(() => document.querySelectorAll(".commit-log-row").length === 12);
		await page.getByRole("textbox", { name: "搜索分支或标签" }).fill("");
		await page.getByRole("button", { name: "所有分支", exact: true }).click();
		await page.waitForFunction(() => document.querySelectorAll(".commit-log-row").length === 13);
		await page.getByRole("button", { name: /^浏览项目：/ }).click();
		await page.getByRole("option", { name: "aiagent", exact: true }).click();
		await page.waitForFunction(() => document.querySelector(".git-tree-scope")?.textContent.includes("aiagent"));
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId), chat);
		await page.getByRole("tab", { name: "文件", exact: true }).click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.getByRole("textbox", { name: "提交信息", exact: true }).waitFor();
		await openHistory();
		await page.locator(".commit-metadata h2").waitFor();
		await page.getByRole("button", { name: "返回对话", exact: true }).click();
		await page.locator(".git-tree-workspace").waitFor({ state: "hidden" });
		console.log(`PASS ${theme}: branches, graph, keyboard, details, diff, search, projects and tool switching`);
	}
	// Delayed responses from another project must not replace the visible history.
	await openHistory();
	await page.locator(".commit-metadata h2").waitFor();
	await page.evaluate(() => {
		const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
		window.historyMode = "delay";
		window.__TAURI_INTERNALS__.invoke = async (command, args) => {
			const value = await original(command, args);
			if (command !== "get_project_git_history") return value;
			if (window.historyMode === "delay" && args.root.endsWith("aiagent")) return new Promise((resolve) => { window.releaseHistory = () => resolve({ ...value, commits: value.commits.map((commit) => ({ ...commit, subject: "STALE PROJECT" })) }); });
			if (window.historyMode === "error") throw new Error("History unavailable");
			if (window.historyMode === "empty") return { ...value, commits: [], hasMore: false };
			if (window.historyMode === "more") return { ...value, hasMore: args.limit === 100 };
			return value;
		};
	});
	await update().click();
	await page.waitForFunction(() => window.releaseHistory);
	assert.equal(await page.getByRole("option").count(), 13, "Refreshing must keep the existing commits visible");
	assert.equal(await page.locator(".commit-metadata h2").isVisible(), true, "Refreshing must keep the selected details visible");
	await page.getByRole("button", { name: /^浏览项目：/ }).click();
	await page.getByRole("option", { name: "Skiff", exact: true }).click();
	await page.locator(".commit-metadata h2").waitFor();
	await page.evaluate(() => window.releaseHistory());
	assert.doesNotMatch(await page.locator(".commit-log").innerText(), /STALE PROJECT/);
	for (const mode of ["error", "empty", "more"]) {
		await page.evaluate((mode) => { window.historyMode = mode; }, mode);
		await update().click();
		if (mode === "error") await page.getByRole("alert").filter({ hasText: "History unavailable" }).waitFor();
		if (mode === "empty") await page.getByText("此范围暂无提交", { exact: true }).waitFor();
		if (mode === "more") {
			await page.getByRole("button", { name: "加载更多提交" }).click();
			await page.locator(".commit-metadata h2").waitFor();
			assert.equal(await page.getByRole("button", { name: "加载更多提交" }).count(), 0);
		}
	}
	console.log("PASS delayed project responses, retry/empty states and load more");
	await page.setViewportSize({ width: 600, height: 800 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
	await openHistory();
	await assertUpdateLocation(".workbench-header-actions");
	await page.getByRole("button", { name: "HEAD · 当前提交", exact: true }).click();
	await page.locator(".commit-metadata h2").waitFor();
	await assertUpdateLocation(".git-log-toolbar");
	await page.screenshot({ path: "dist/git-tree/narrow.png" });
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await page.getByRole("button", { name: "分支", exact: true }).click();
	await assertUpdateLocation(".workbench-header-actions");
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
