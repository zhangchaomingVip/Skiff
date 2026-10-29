import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const openDiff = (path) => page.getByRole("button", { name: `查看 Diff：${path}`, exact: true }).click();
const calls = () => page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "get_project_git_diff").length);
const waitDiff = (path, version = "1", project = "Skiff") => page.locator(".diff-preview", { hasText: `${project}|${path}|${version}` }).waitFor();
const choose = async (name) => {
	await page.getByRole("button", { name: /^浏览项目：/ }).click();
	await page.getByRole("option", { name, exact: true }).click();
};

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(async () => {
			// Isolate demand reads here; diff-preload.browser.mjs covers startup warming.
			const cacheModule = performance.getEntriesByType("resource").find((entry) => entry.name.includes("/src/workbench/projectDiffCache.ts"))?.name;
			const { projectDiffCache } = await import(cacheModule);
			projectDiffCache.prefetch = () => {};
			for (const project of JSON.parse(localStorage.getItem("skiff.workspace.v1")).projects) projectDiffCache.invalidateRoot(project.path);
			window.testDiffDelayed = true;
			window.testDiffPending = [];
			window.testDiffVersions = {};
			window.testDiffFail = false;
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const value = await original(command, args);
				const version = String(window.testDiffVersions[args?.root] ?? "1");
				if (command === "get_project_git_status") return { ...value, version };
				if (command !== "get_project_git_diff") return value;
				if (window.testDiffFail) { window.testDiffFail = false; throw new Error("Temporary Diff failure"); }
				if (window.testDiffDelayed) await new Promise((resolve) => window.testDiffPending.push(resolve));
				return { ...value, version, content: `@@ cached Diff @@\n+${args.root.split("\\").at(-1)}|${args.path}|${version}` };
			};
			window.skiffPreview.commands.length = 0;
			window.dispatchEvent(new Event("focus"));
		});
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
	await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await openDiff("src/App.tsx");
		await page.getByText("正在读取…", { exact: true }).waitFor();
		await openDiff("src/components/ProjectPreview.tsx");
		await openDiff("src/App.tsx");
		await page.waitForFunction(() => window.testDiffPending.length === 2);
		assert.equal(await calls(), 2, "A/B/A clicks must share A's in-flight query");
		await page.evaluate(() => { window.testDiffDelayed = false; for (const resolve of window.testDiffPending.splice(0)) resolve(); });
		await waitDiff("src/App.tsx");

		await openDiff("src/components/ProjectPreview.tsx");
		await waitDiff("src/components/ProjectPreview.tsx");
		await openDiff("src/App.tsx");
		await waitDiff("src/App.tsx");
		assert.equal(await calls(), 2, "Cached tab switches must not invoke Git");
		assert.equal(await page.getByText("正在读取…", { exact: true }).count(), 0);
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await openDiff("src/App.tsx");
		await waitDiff("src/App.tsx");
		await page.getByRole("button", { name: "关闭 App.tsx", exact: true }).click();
		await openDiff("src/App.tsx");
		await waitDiff("src/App.tsx");
		assert.equal(await calls(), 2, "Returning from chat and reopening a closed tab retain the cached Diff");
		await page.getByRole("group", { name: "预览模式" }).getByRole("button", { name: "文件", exact: true }).click();
		await page.locator(".source-preview").waitFor();
		await page.getByRole("group", { name: "预览模式" }).getByRole("button", { name: "Diff", exact: true }).click();
		await waitDiff("src/App.tsx");
		assert.equal(await calls(), 2, "File/Diff switches reuse the Diff cache");

		await choose("aiagent");
		await openDiff("src/App.tsx");
		await waitDiff("src/App.tsx", "1", "aiagent");
		assert.equal(await calls(), 3, "Identical file names in different projects have distinct cache entries");
		await choose("Skiff");
		await openDiff("src/App.tsx");
		await waitDiff("src/App.tsx");
		assert.equal(await calls(), 3);
		await page.evaluate(() => { window.testDiffVersions["D:\\workspace\\Skiff"] = "2"; });
		await page.getByRole("button", { name: "刷新 Git 状态", exact: true }).click();
		await waitDiff("src/App.tsx", "2");
		assert.equal(await calls(), 4, "Changed Git status refreshes the active cached Diff");
		await choose("aiagent");
		await openDiff("src/App.tsx");
		await waitDiff("src/App.tsx", "1", "aiagent");
		assert.equal(await calls(), 4, "Other projects remain cached");

		await page.evaluate(() => { window.testDiffFail = true; window.testDiffVersions["D:\\workspace\\aiagent"] = "2"; });
		await page.getByRole("button", { name: "刷新 Git 状态", exact: true }).click();
		await page.getByText("Temporary Diff failure", { exact: false }).waitFor();
		assert.equal(await page.locator(".diff-preview").count(), 0, "A failed refresh must not display stale content as current");
		await page.getByRole("button", { name: "重试", exact: true }).click();
		await waitDiff("src/App.tsx", "2", "aiagent");

		await page.getByRole("checkbox", { name: "选择 src/App.tsx", exact: true }).check();
		await page.getByRole("textbox", { name: "提交信息", exact: true }).fill("Cache invalidation");
		const beforeCommit = await calls();
		await page.locator(".git-commit-box").getByRole("button", { name: "Commit", exact: true }).click();
		await page.waitForFunction((before) => window.skiffPreview.commands.filter((item) => item.command === "get_project_git_diff").length > before, beforeCommit);
		await waitDiff("src/App.tsx", "2", "aiagent");
	}
	assert.deepEqual(errors, []);
	console.log("Diff cache: light/dark, in-flight deduplication, instant tab/chat/reopen reuse, File/Diff switching, cross-project isolation, status/commit invalidation and error retry passed.");
} finally {
	await browser.close();
}
