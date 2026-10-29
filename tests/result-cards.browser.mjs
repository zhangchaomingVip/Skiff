import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
await mkdir("dist/result-cards", { recursive: true });

try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
		const showChat = async () => {
			await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "对话", exact: true }).click();
			const drawer = page.getByRole("dialog", { name: "项目与聊天导航", exact: true });
			if (await drawer.isVisible()) { await page.keyboard.press("Escape"); await drawer.waitFor({ state: "hidden" }); }
		};
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		// Give this mock chat another browsing project to verify the shortcut's destination.
		await page.addInitScript(() => {
			const original = Storage.prototype.setItem;
			Storage.prototype.setItem = function (key, value) {
				if (key === "skiff.workspace.v1") {
					const workspace = JSON.parse(value);
					if (!workspace.projects.some((project) => project.id === "result-card-other")) workspace.projects.push({ id: "result-card-other", name: "Other project", path: "D:\\workspace\\other" });
					value = JSON.stringify(workspace);
				}
				return original.call(this, key, value);
			};
		});
		await page.goto(`${origin}/tests/preview.html?fixture=chat-polish-031&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		const card = page.locator(".result-card").filter({ hasText: "已编辑 3 个文件" });
		await card.waitFor();
		assert.equal(await card.getAttribute("open"), "");
		assert.deepEqual(await card.locator(".result-card-item .result-card-path").evaluateAll((paths) => paths.map((path) => path.getAttribute("title"))), ["src/App.tsx", "src/components/MessageItem.tsx", "src/chat/toolRuns.ts"]);
		assert.deepEqual(await card.locator(".result-card-main .result-card-diff > span").allTextContents(), ["+4", "-3"]);
		assert.equal(await card.locator(".result-card-item").count(), 3);
		const single = page.locator(".result-card").filter({ hasText: "已创建 1 个文件" });
		assert.equal(await single.locator(".result-card-item").count(), 1);
		assert.equal(await single.locator(".result-card-diff").count(), 0, "Missing counts remain absent");
		const deleted = page.locator(".result-card").filter({ hasText: "已删除 2 个文件" });
		assert.equal(await deleted.locator(".result-card-item").count(), 2);
		assert.equal(await deleted.locator(".result-card-diff").count(), 0);
		await card.locator("summary").click();
		assert.equal(await card.getAttribute("open"), null);
		await card.locator("summary").focus();
		await page.keyboard.press("Enter");
		assert.equal(await card.getAttribute("open"), "");
		await card.locator("summary").evaluate((element) => element.blur());
		await page.mouse.move(1300, 500);
		await card.screenshot({ path: `dist/result-cards/${theme}.png` });

		const chatId = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);
		await page.locator(".composer-input").fill("保留这条草稿");
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await page.getByRole("button", { name: "浏览项目：Skiff", exact: true }).click();
		await page.getByRole("option", { name: "Other project", exact: true }).click();
		await page.getByRole("button", { name: "浏览项目：Other project", exact: true }).waitFor();
		await showChat();
		await card.getByRole("button", { name: "查看变更", exact: true }).click();
		await page.getByRole("tab", { name: "Commit", exact: true }).waitFor();
		assert.equal(await page.getByRole("tab", { name: "Commit", exact: true }).getAttribute("aria-selected"), "true");
		await page.getByRole("button", { name: "浏览项目：Skiff", exact: true }).waitFor();
		assert.equal(await card.getAttribute("open"), "", "Navigation does not toggle the file list");
		assert.equal(await page.locator(".composer-input").inputValue(), "保留这条草稿");
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId), chatId);
		assert.equal(await page.locator(".primary-view").isVisible(), false, "The shortcut enters the file workspace");
		await showChat();
		const openFile = async (path, name, keyboard = false) => {
			const file = page.getByRole("button", { name: `打开文件：${path}`, exact: true });
			if (keyboard) { await file.focus(); await page.keyboard.press("Enter"); }
			else await file.click();
			await page.locator(".source-preview").waitFor();
			assert.equal(await page.locator(".preview-tab.active .preview-tab-open > span").textContent(), name);
			assert.equal(await page.locator(".preview-mode").getByRole("button", { name: "文件", exact: true }).getAttribute("aria-pressed"), "true");
			const read = await page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "read_project_file").at(-1).args);
			assert.equal(read.root, "D:\\workspace\\Skiff");
			assert.equal(read.path, path);
		};
		assert.equal(await deleted.locator(".result-card-file").count(), 0, "Deleted files have no content to open");
		await openFile("src/App.tsx", "App.tsx", true);
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		await openFile("src/App.tsx", "App.tsx");
		assert.equal(await page.locator(".preview-tab").count(), 1, "Repeated card clicks reuse the file tab");
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		await openFile("docs/preview.md", "preview.md");
		assert.equal(await page.locator(".preview-tab").count(), 2);
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		assert.equal(await page.locator(".composer-input").inputValue(), "保留这条草稿");
		await page.setViewportSize({ width: 600, height: 800 });
		const dialog = page.getByRole("dialog", { name: "项目与聊天导航", exact: true });
		await dialog.waitFor();
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		await page.locator(".composer-input").focus();
		await card.scrollIntoViewIfNeeded();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.mouse.move(580, 20);
		await card.screenshot({ path: `dist/result-cards/${theme}-narrow.png` });
		await card.getByRole("button", { name: "查看变更", exact: true }).click();
		await dialog.waitFor();
		assert.equal(await dialog.getByRole("tab", { name: "Commit", exact: true }).getAttribute("aria-selected"), "true");

		// Only a successful repository lookup enables the Commit shortcut.
		// Refresh into a local-project state, including when Git was cached earlier.
		await page.evaluate(() => {
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.__TAURI_INTERNALS__.invoke = (command, args) => command === "get_project_git_status" ? Promise.reject(new Error("fatal: not a git repository")) : original(command, args);
		});
		await dialog.getByRole("button", { name: "刷新 Git 状态", exact: true }).click();
		await dialog.getByText("Local project", { exact: true }).waitFor();
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		await showChat();
		assert.equal(await card.getByRole("button", { name: "查看变更", exact: true }).count(), 0);
		await card.getByRole("button", { name: "查看文件", exact: true }).click();
		await dialog.waitFor();
		assert.equal(await dialog.getByRole("tab", { name: "文件", exact: true }).getAttribute("aria-selected"), "true");
		await page.getByRole("button", { name: "浏览项目：Skiff", exact: true }).waitFor();
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.locator(".workbench-panel").waitFor();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await showChat();
		await card.getByRole("button", { name: "查看文件", exact: true }).click();
		assert.equal(await page.getByRole("tab", { name: "文件", exact: true }).getAttribute("aria-selected"), "true");
		assert.equal(await page.locator(".composer-input").inputValue(), "保留这条草稿");
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId), chatId);
		await showChat();
		await page.locator(".composer-input").focus();
		await page.mouse.move(1300, 500);
		await card.screenshot({ path: `dist/result-cards/${theme}-local.png` });
		await openFile("src/App.tsx", "App.tsx");
		await page.mouse.move(1300, 500);
		await page.screenshot({ path: `dist/result-cards/${theme}-file-open.png` });
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		await page.setViewportSize({ width: 600, height: 800 });
		await dialog.waitFor();
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		await openFile("src/components/MessageItem.tsx", "MessageItem.tsx");
		assert.equal(await dialog.isVisible(), false, "File content stays visible on narrow screens");
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		assert.equal(await page.locator(".composer-input").inputValue(), "保留这条草稿");
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId), chatId);

		// Check zero counts and paths wider than the viewport using real parsed tool results.
		await page.goto(`${origin}/tests/turn-usage.html`);
		await page.waitForFunction(() => window.turnUsageHarness);
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		await page.setViewportSize({ width: 390, height: 800 });
		await page.evaluate(() => window.turnUsageHarness.render({ messages: [
			{ role: "user", content: "修改根目录文件和长路径文件" },
			{ role: "assistant", content: [
				{ type: "toolCall", id: "root-edit", name: "edit", arguments: { path: "demo.txt" } },
				{ type: "toolCall", id: "long-edit", name: "edit", arguments: { path: "C:\\workspace\\Skiff\\src\\components\\a-very-long-directory-name\\a-very-long-component-name-without-breaks.tsx" } },
			] },
			{ role: "toolResult", toolCallId: "root-edit", name: "edit", content: "ok", details: { diff: "+added line" } },
			{ role: "toolResult", toolCallId: "long-edit", name: "edit", content: "ok", details: { diff: "+another line" } },
			{ role: "assistant", content: "修改完成。", stopReason: "stop" },
		] }));
		const longCard = page.locator(".result-card");
		await longCard.waitFor();
		assert.deepEqual(await longCard.locator(".result-card-main .result-card-diff > span").allTextContents(), ["+2", "-0"]);
		assert.equal(await longCard.getByRole("button", { name: "查看变更", exact: true }).count(), 0, "Read-only previews without navigation do not invent an action");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		assert.equal(await longCard.locator(".result-card-path").evaluateAll((paths) => paths.every((path) => path.scrollWidth <= path.clientWidth)), true);
		await longCard.screenshot({ path: `dist/result-cards/${theme}-long-path.png` });
		assert.deepEqual(errors, []);
		console.log(`PASS ${theme}: cards, Git/local navigation, file clicks and keyboard opening, tab reuse, correct project/path, preserved chat/draft, narrow preview`);
		await page.close();
	}
} finally { await browser.close(); }
