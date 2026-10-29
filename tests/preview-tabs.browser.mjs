import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const origin = process.argv[2] ?? "http://localhost:1421";
page.setDefaultTimeout(10000);
const names = ["README.md", "style-audit.json", "a-very-long-file-name-for-preview-tabs-and-overflow.ts"];
const tab = (name) => page.locator(".preview-tab").filter({ has: page.locator(".preview-tab-open > span", { hasText: new RegExp(`^${name.replaceAll(".", "\\.")}$`) }) });

try {
	await mkdir("dist/preview-tabs", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1200, height: 800 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate((names) => {
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const value = await original(command, args);
				if (command === "list_project_directory" && !args.path) return { ...value, entries: names.map((name) => ({ name, path: name, kind: "file" })) };
				if (command === "get_project_git_status") return { ...value, entries: names.map((path, index) => ({ path, kind: index === 0 ? "untracked" : "modified", selectable: true, rollbackable: index > 0 })) };
				return value;
			};
		}, names);
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await page.getByRole("button", { name: "刷新文件树", exact: true }).click();
		for (const name of names) await page.locator(`.file-tree-row[title="${name}"]`).click();
		await page.locator(".source-preview").waitFor();
		await tab(names[1]).locator(".preview-tab-open").click();
		await page.mouse.move(1100, 750);
		assert.equal(await tab(names[1]).getAttribute("aria-selected"), "true");
		for (const name of names.slice(0, 2)) {
			assert.equal(await tab(name).locator(".preview-tab-open > span").evaluate((element) => element.scrollWidth <= element.clientWidth), true, `${name} must fit without early ellipsis`);
		}
		assert.equal(await tab(names[1]).locator(".preview-tab-close").evaluate((element) => getComputedStyle(element).width), "22px");
		assert.equal(await tab(names[0]).locator(".preview-tab-close").evaluate((element) => getComputedStyle(element).opacity), "0");
		await tab(names[0]).hover();
		assert.equal(await tab(names[0]).locator(".preview-tab-close").evaluate((element) => getComputedStyle(element).opacity), "1");
		await page.screenshot({ path: `dist/preview-tabs/${theme}.png`, animations: "disabled" });
		await page.getByRole("group", { name: "预览模式" }).getByRole("button", { name: "Diff", exact: true }).click();
		await page.locator(".diff-preview").waitFor();
		assert.equal(await tab(names[1]).locator(".preview-tab-open").innerText(), names[1]);
		await page.screenshot({ path: `dist/preview-tabs/${theme}-diff.png`, animations: "disabled" });
		await tab(names[2]).locator(".preview-tab-open").click();
		await page.setViewportSize({ width: 600, height: 680 });
		await page.getByRole("dialog", { name: "项目与聊天导航" }).waitFor();
		await page.keyboard.press("Escape");
		await page.getByRole("dialog", { name: "项目与聊天导航" }).waitFor({ state: "hidden" });
		await tab(names[0]).locator(".preview-tab-open").click();
		await tab(names[2]).locator(".preview-tab-open").click();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.screenshot({ path: `dist/preview-tabs/${theme}-narrow.png`, animations: "disabled" });
		await tab(names[2]).getByRole("button", { name: `关闭 ${names[2]}`, exact: true }).click();
		assert.equal(await page.locator(".preview-tab").count(), 2);
		await tab(names[1]).getByRole("button", { name: `关闭 ${names[1]}`, exact: true }).click();
		assert.equal(await tab(names[0]).getAttribute("aria-selected"), "true");
	}
	console.log("Preview tabs: light/dark, full short filenames, compact close buttons, hover, selection, filename-only Diff tabs, long-name overflow and close behavior passed.");
} finally { await browser.close(); }
