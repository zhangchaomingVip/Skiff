import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/git-groups/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const group = (label) => page.locator("details.git-change-group").filter({ has: page.locator("summary strong", { hasText: new RegExp(`^${label}$`) }) });
const all = (label) => page.getByRole("checkbox", { name: `选择全部 ${label}`, exact: true });
const selectedCount = () => page.locator(".git-selected-count").innerText();
const refresh = async (entries) => {
	await page.evaluate((entries) => { if (entries) window.testGitEntries = entries; window.testGitVersion++; }, entries);
	await page.getByRole("button", { name: "刷新 Git 状态" }).click();
	await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 Git 状态"]').disabled);
	await page.getByText("已选 0 个文件", { exact: true }).waitFor();
};
const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => {
			const entry = (path, kind, selectable = true) => ({ path, kind, indexStatus: kind === "added" ? "A" : " ", worktreeStatus: "M", selectable, rollbackable: kind !== "untracked" });
			window.testGitEntries = [entry("src/App.tsx", "modified"), entry("src/new.ts", "added"), { ...entry("src/renamed.ts", "renamed"), oldPath: "src/old.ts" }, entry("src/conflict.ts", "conflict", false), entry("src/workbench/newFile.ts", "untracked"), entry("notes/计划.md", "untracked")];
			window.testGitVersion = 1;
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const value = await original(command, args);
				return command === "get_project_git_status" ? { ...value, entries: window.testGitEntries, version: `group-${window.testGitVersion}` } : value;
			};
		});
		await tool("文件").click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await refresh();
		const changes = group("Changes");
		const unversioned = group("Unversioned Files");
		assert.equal(await changes.locator(".git-change-row").count(), 4);
		assert.equal(await unversioned.locator(".git-change-row").count(), 2);
		assert.equal(await changes.locator("summary small").innerText(), "4 files");
		assert.equal(await unversioned.locator("summary small").innerText(), "2 files");
		assert.equal(await changes.getByRole("checkbox", { name: "选择 src/conflict.ts", exact: true }).isDisabled(), true);
		assert.equal(await changes.getByRole("button", { name: "查看 Diff：src/renamed.ts", exact: true }).getAttribute("title"), "src/old.ts → src/renamed.ts");
		const nested = unversioned.getByRole("button", { name: "查看 Diff：src/workbench/newFile.ts", exact: true });
		assert.equal(await nested.locator("span").last().innerText(), "newFile.ts");
		assert.equal(await nested.locator("small").innerText(), "src/workbench");
		assert.equal(await nested.locator("small").getAttribute("title"), "src/workbench");

		await all("Changes").check();
		assert.match(await selectedCount(), /3 个文件/);
		assert.equal(await changes.getAttribute("open"), "", "Selecting a group must not collapse it");
		assert.equal(await all("Unversioned Files").isChecked(), false);
		await changes.getByRole("checkbox", { name: "选择 src/App.tsx", exact: true }).uncheck();
		assert.equal(await all("Changes").evaluate((node) => node.indeterminate), true);
		assert.equal(await all("Changes").getAttribute("aria-checked"), "mixed");
		await all("Unversioned Files").check();
		assert.match(await selectedCount(), /4 个文件/);
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-expanded.png`, output)), animations: "disabled" });

		await changes.locator("summary").click({ position: { x: 100, y: 14 } });
		await page.waitForFunction(() => !document.querySelector("details.git-change-group").open);
		assert.equal(await changes.getByRole("button", { name: "查看 Diff：src/App.tsx", exact: true }).isVisible(), false);
		await all("Changes").check();
		assert.equal(await changes.getAttribute("open"), null, "Group selection works while collapsed");
		assert.match(await selectedCount(), /5 个文件/);
		await all("Changes").uncheck();
		assert.match(await selectedCount(), /2 个文件/, "Clearing one group preserves the other group");
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-collapsed.png`, output)), animations: "disabled" });

		// Returning from another project and remounting the panel retain group state.
		await page.getByRole("button", { name: /^浏览项目：/ }).click();
		await page.getByRole("option", { name: "aiagent", exact: true }).click();
		assert.equal(await changes.getAttribute("open"), "");
		await page.getByRole("button", { name: /^浏览项目：/ }).click();
		await page.getByRole("option", { name: "Skiff", exact: true }).click();
		assert.equal(await changes.getAttribute("open"), null);
		await tool("对话").click();
		await tool("文件").click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		assert.equal(await changes.getAttribute("open"), null);
		await page.waitForFunction(() => document.querySelector('input[aria-label="选择全部 Unversioned Files"]')?.checked);
		assert.equal(await all("Unversioned Files").isChecked(), true);
		await page.getByRole("textbox", { name: "提交信息" }).fill("Grouped selection");
		await page.locator(".git-commit-box").getByRole("button", { name: "Commit", exact: true }).click();
		await page.waitForFunction(() => window.skiffPreview.commands.some((item) => item.command === "commit_project_files"));
		assert.deepEqual(await page.evaluate(() => window.skiffPreview.commands.findLast((item) => item.command === "commit_project_files").args.paths), ["src/workbench/newFile.ts", "notes/计划.md"]);
		await page.getByRole("button", { name: "查看 Diff：src/workbench/newFile.ts", exact: true }).click();
		await page.locator(".diff-preview").waitFor();
		assert.equal(await page.evaluate(() => window.skiffPreview.commands.findLast((item) => item.command === "get_project_git_diff").args.path), "src/workbench/newFile.ts");

		await all("Unversioned Files").check();
		await refresh();
		assert.equal(await all("Unversioned Files").isChecked(), false, "A new status version invalidates old selections");
		assert.equal(await changes.getAttribute("open"), null, "Refresh preserves collapsed groups");
		await refresh([{ path: "new.txt", kind: "untracked", selectable: true, rollbackable: false }]);
		assert.equal(await page.locator(".git-change-group").count(), 1);
		assert.equal(await unversioned.locator("summary small").innerText(), "1 file");
		assert.equal(await unversioned.locator(".git-file small").innerText(), ".", "Root files also show their project-relative directory");
		await refresh([{ path: "conflict.txt", kind: "conflict", selectable: false, rollbackable: false }]);
		assert.equal(await all("Changes").isDisabled(), true);
		await refresh([]);
		await page.getByText("工作区没有变更", { exact: true }).waitFor();
		assert.equal(await page.locator(".git-change-group").count(), 0);
	}
	await page.setViewportSize({ width: 600, height: 680 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=dark`);
	await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
	await tool("文件").click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
	await all("Unversioned Files").check();
	await page.screenshot({ path: fileURLToPath(new URL("narrow.png", output)), animations: "disabled" });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	assert.deepEqual(errors, []);
	console.log("Git groups: light/dark, counts, staged additions, mixed/all selection, collapsed selection, disabled entries, project/remount retention, commit paths, Diff, refresh, empty state and narrow drawer passed.");
} finally {
	await browser.close();
}
