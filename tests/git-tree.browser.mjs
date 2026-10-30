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
const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		const chat = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);
		assert.deepEqual(await page.locator(".activity-button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))), ["对话", "文件", "Git 历史"]);
		await tool("Git 历史").click();
		await page.locator(".commit-metadata h2").waitFor();
		assert.equal(await page.getByRole("option").count(), 13);
		await page.mouse.move(700, 700);
		await page.screenshot({ path: `dist/git-tree/${theme}.png` });
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
		await tool("文件").click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.getByRole("textbox", { name: "提交信息", exact: true }).waitFor();
		await tool("Git 历史").click();
		await page.locator(".commit-metadata h2").waitFor();
		await page.getByRole("button", { name: "返回对话", exact: true }).click();
		await page.locator(".git-tree-workspace").waitFor({ state: "detached" });
		console.log(`PASS ${theme}: branches, graph, keyboard, details, diff, search, projects and tool switching`);
	}
	// Delayed responses from another project must not replace the visible history.
	await tool("Git 历史").click();
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
	await page.locator(".git-log-toolbar").getByRole("button", { name: "Update Project", exact: true }).click();
	await page.waitForFunction(() => window.releaseHistory);
	await page.getByRole("button", { name: /^浏览项目：/ }).click();
	await page.getByRole("option", { name: "Skiff", exact: true }).click();
	await page.locator(".commit-metadata h2").waitFor();
	await page.evaluate(() => window.releaseHistory());
	assert.doesNotMatch(await page.locator(".commit-log").innerText(), /STALE PROJECT/);
	for (const mode of ["error", "empty", "more"]) {
		await page.evaluate((mode) => { window.historyMode = mode; }, mode);
		await page.locator(".git-log-toolbar").getByRole("button", { name: "Update Project", exact: true }).click();
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
	await tool("Git 历史").click();
	await page.getByRole("button", { name: "HEAD · 当前提交", exact: true }).click();
	await page.locator(".commit-metadata h2").waitFor();
	await page.screenshot({ path: "dist/git-tree/narrow.png" });
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
