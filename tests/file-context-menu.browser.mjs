import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const row = (path) => page.locator(`.file-tree-row[title="${path}"]`);
const menu = () => page.getByRole("menu", { name: "src/图片 folder/星空,蓝.png", exact: true });
const reveal = () => page.getByRole("menuitem", { name: "在资源管理器中显示", exact: true });

try {
	await mkdir("dist/file-context-menu", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => {
			window.revealedFiles = [];
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				if (command === "reveal_project_file") {
					window.revealedFiles.push(args);
					if (window.failReveal) throw new Error("路径不可用");
					return;
				}
				const value = await original(command, args);
				if (command === "list_project_directory" && args.path === "src") return { path: "src", truncated: false, entries: [{ path: "src/图片 folder/星空,蓝.png", name: "星空,蓝.png", kind: "file" }] };
				if (command === "get_project_git_status") return { ...value, entries: [{ path: "src/图片 folder/星空,蓝.png", kind: "untracked", selectable: true, rollbackable: false }] };
				return value;
			};
		});
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await row("src").click();
		const file = row("src/图片 folder/星空,蓝.png");
		await file.click({ button: "right" });
		await menu().waitFor();
		assert.equal(await page.locator(".project-preview").count(), 0, "Right click must not open a preview");
		await page.screenshot({ path: `dist/file-context-menu/${theme}-files.png`, animations: "disabled" });
		await page.keyboard.press("Escape");
		assert.equal(await menu().count(), 0);
		assert.equal(await file.evaluate((node) => node === document.activeElement), true);
		await file.click({ button: "right" });
		await page.keyboard.press("Enter");
		await page.waitForFunction(() => window.revealedFiles.length === 1);
		assert.equal(await menu().count(), 0);
		const first = await page.evaluate(() => window.revealedFiles[0]);
		assert.match(first.root, /Skiff$/);
		assert.equal(first.path, "src/图片 folder/星空,蓝.png");
		await row("src").click({ button: "right" });
		await reveal().click();
		assert.equal((await page.evaluate(() => window.revealedFiles[1])).path, "src");
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.getByRole("button", { name: "刷新 Git 状态", exact: true }).click();
		const gitFile = page.getByRole("button", { name: "查看 Diff：src/图片 folder/星空,蓝.png", exact: true });
		await gitFile.click({ button: "right" });
		assert.equal(await page.getByRole("checkbox", { name: "选择 src/图片 folder/星空,蓝.png", exact: true }).isChecked(), false);
		await page.screenshot({ path: `dist/file-context-menu/${theme}-commit.png`, animations: "disabled" });
		await reveal().click();
		assert.deepEqual(await page.evaluate(() => window.revealedFiles[2]), first);
		await gitFile.click({ button: "right" });
		await page.getByRole("tab", { name: "文件", exact: true }).click();
		assert.equal(await menu().count(), 0, "Switching tabs dismisses the menu");
		await file.click({ button: "right" });
		await page.getByRole("button", { name: /^浏览项目：/ }).click();
		assert.equal(await menu().count(), 0, "Outside clicks dismiss the menu");
		await page.getByRole("option", { name: "aiagent", exact: true }).click();
		await row("src").click();
		await file.click({ button: "right" });
		await reveal().click();
		assert.match((await page.evaluate(() => window.revealedFiles[3])).root, /aiagent$/);
		await page.evaluate(() => { window.failReveal = true; });
		await file.click({ button: "right" });
		await reveal().click();
		await page.getByRole("alert").filter({ hasText: "无法在资源管理器中显示" }).waitFor();
		// Verify the existing left-click preview remains available after failure.
		await file.click();
		await page.locator(".project-preview").waitFor();
	}
	assert.deepEqual(errors, []);
	console.log("File context menu: both themes, files, folders, Commit, keyboard activation, dismissal, project paths, failure and left-click preview passed.");
} finally { await browser.close(); }
