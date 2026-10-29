import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(10000);
const calls = () => page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "get_project_git_diff").length);
const warm = async () => {
	const deadline = Date.now() + 10000;
	while (!await page.evaluate(async () => {
		const cacheModule = performance.getEntriesByType("resource").find((entry) => entry.name.includes("/src/workbench/projectDiffCache.ts"))?.name;
		if (!cacheModule) return false;
		const { projectDiffCache } = await import(cacheModule);
		const projects = JSON.parse(localStorage.getItem("skiff.workspace.v1")).projects;
		return projects.length > 0 && projects.every((project) => projectDiffCache.get(project.path, "src/App.tsx") && projectDiffCache.get(project.path, "src/components/ProjectPreview.tsx"));
	})) {
		assert.ok(Date.now() < deadline, "Startup preloading did not finish");
		await page.waitForTimeout(100);
	}
};

try {
	await mkdir("dist/diff-preload", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await warm();
		assert.equal(await calls(), 6, "Startup warms changes before the Commit tab is opened");
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.getByRole("button", { name: "查看 Diff：src/App.tsx", exact: true }).click();
		await page.locator(".diff-preview").waitFor();
		assert.equal(await calls(), 6, "First click uses startup cache without another RPC");
		assert.equal(await page.getByText("正在读取…", { exact: true }).count(), 0);
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await warm();
		assert.equal(await calls(), 6, "Unchanged status keeps warmed Diffs");
		await page.screenshot({ path: `dist/diff-preload/${theme}.png`, animations: "disabled" });
		await page.evaluate(() => {
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.preloadDelayed = true; window.preloadPending = [];
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const value = await original(command, args);
				if (command === "get_project_git_status") return { ...value, version: "changed-after-startup" };
				if (command !== "get_project_git_diff") return value;
				if (window.preloadDelayed) await new Promise((resolve) => window.preloadPending.push(resolve));
				return { ...value, content: "@@ changed @@\n+new content after edit" };
			};
			window.dispatchEvent(new Event("focus"));
		});
		await page.getByText("正在读取…", { exact: true }).waitFor();
		assert.equal(await page.locator(".diff-preview").count(), 0, "Invalidated results cannot masquerade as current content");
		await page.evaluate(() => { window.preloadDelayed = false; for (const resolve of window.preloadPending.splice(0)) resolve(); });
		await page.locator(".diff-preview", { hasText: "new content after edit" }).waitFor();
		await warm();
		await page.reload(); await warm();
		assert.equal(await calls(), 6, "A fresh application run warms its cache again");
	}
	console.log("Diff preload: startup/restart warming, immediate first open, unchanged polling reuse and edited-content invalidation passed in both themes.");
} finally { await browser.close(); }
