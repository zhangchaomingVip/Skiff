import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
await fs.mkdir("dist", { recursive: true });

try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		const recent = page.getByRole("region", { name: "最近会话", exact: true });
		const recentTitles = async () => (await recent.locator(".chat-title").allTextContents()).map((title) => title.split(" · ")[0]);
		const expected = ["同项目候选", "其他项目会话", "当前会话"];
		assert.deepEqual(await recentTitles(), expected, "Expanded projects retain every recent chat in timestamp order");
		assert.equal(await page.locator(".project-chats .chat-row").count(), 3);
		const assertCurrentRow = async (container, title) => {
			assert.equal(await page.locator(".sidebar .chat-row.selected").count(), 1, "Only one occurrence of the current chat is highlighted");
			assert.equal(await page.locator('.sidebar .chat-link[aria-current="page"]').count(), 1);
			assert.equal((await container.locator(".chat-row.selected .chat-title").textContent()).split(" · ")[0], title);
		};
		const projectChats = page.locator(".project-chats");
		await assertCurrentRow(projectChats, "当前会话");
		await recent.locator(".chat-row").filter({ hasText: "当前会话" }).locator(".chat-link").click();
		await assertCurrentRow(recent, "当前会话");
		await projectChats.locator(".chat-row").filter({ hasText: "当前会话" }).locator(".chat-link").click();
		await assertCurrentRow(projectChats, "当前会话");
		await recent.locator(".chat-row").filter({ hasText: "同项目候选" }).locator(".chat-link").click();
		await assertCurrentRow(recent, "同项目候选");
		await projectChats.locator(".chat-row").filter({ hasText: "同项目候选" }).click({ button: "right" });
		await page.getByRole("menu").getByRole("button", { name: "打开", exact: true }).click();
		await assertCurrentRow(projectChats, "同项目候选");
		await page.mouse.move(1000, 500);
		await page.screenshot({ path: `dist/sidebar-single-highlight-${theme}.png` });

		const projectsToggle = page.getByRole("button", { name: "项目", exact: true });
		await projectsToggle.click();
		await page.locator(".project-group").first().waitFor({ state: "detached" });
		await assertCurrentRow(recent, "同项目候选");
		assert.deepEqual(await recentTitles(), expected, "Collapsing the project section does not change recent chats");
		await projectsToggle.click();
		await page.locator(".project-group").first().waitFor();
		assert.deepEqual(await recentTitles(), expected, "Reopening the project section does not hide recent chats");

		const project = page.locator(".project-select").filter({ hasText: "Skiff Archive" });
		await project.click();
		await project.click();
		await page.waitForFunction(() => document.querySelector(".project-select")?.getAttribute("aria-expanded") === "false");
		assert.deepEqual(await recentTitles(), expected, "Collapsing one project leaves recent chats unchanged");
		await project.click();
		await page.waitForFunction(() => document.querySelector(".project-select")?.getAttribute("aria-expanded") === "true");
		assert.deepEqual(await recentTitles(), expected, "Expanding one project leaves recent chats unchanged");

		const recentToggle = recent.getByRole("button", { name: "最近", exact: true });
		await recentToggle.click();
		await recent.locator(".chat-row").first().waitFor({ state: "detached" });
		await assertCurrentRow(projectChats, "同项目候选");
		assert.equal(await page.locator(".project-chats .chat-row").count(), 3, "Recent collapse does not affect project rows");
		await recentToggle.click();
		await recent.locator(".chat-row").first().waitFor();
		assert.deepEqual(await recentTitles(), expected);

		// Both views share chat state, but only the row being edited gets an input.
		await recent.locator(".chat-row").filter({ hasText: "同项目候选" }).click({ button: "right" });
		await page.getByRole("menu").getByRole("button", { name: "重命名", exact: true }).click();
		assert.equal(await page.getByRole("textbox", { name: "新名称" }).count(), 1);
		assert.equal(await recent.getByRole("textbox", { name: "新名称" }).count(), 1);
		await recent.getByRole("textbox", { name: "新名称" }).fill("重命名后的会话");
		await recent.getByRole("textbox", { name: "新名称" }).press("Enter");
		await page.locator(".project-chats .chat-title").filter({ hasText: /^重命名后的会话$/ }).waitFor();
		assert.ok((await recentTitles()).includes("重命名后的会话"));

		await page.getByRole("button", { name: "批量选择会话", exact: true }).click();
		await recent.getByRole("checkbox", { name: "选择会话 重命名后的会话", exact: true }).click();
		assert.equal(await page.locator(".project-chats").getByRole("checkbox", { name: "取消选择会话 重命名后的会话", exact: true }).getAttribute("aria-checked"), "true");
		assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 1 \/ 3/);
		await page.keyboard.press("Escape");
		await recent.getByRole("button", { name: "归档聊天 重命名后的会话", exact: true }).click();
		await page.waitForFunction(() => ![...document.querySelectorAll(".sidebar .chat-title")].some((element) => element.textContent === "重命名后的会话"));
		assert.deepEqual(await recentTitles(), ["其他项目会话", "当前会话"], "Archiving removes the chat from both views");
		await page.screenshot({ path: `dist/sidebar-recent-${theme}.png` });
		assert.deepEqual(errors, []);
		console.log(`PASS ${theme}: single current-chat highlight, click/context-menu selection, collapse fallback, independent project/recent expansion, ordering, rename, shared bulk selection and archive`);
		await page.close();
	}
} finally {
	await browser.close();
}
