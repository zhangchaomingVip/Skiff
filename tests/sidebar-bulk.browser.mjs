import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1421";
const theme = process.argv[3] ?? "light";
const browser = await chromium.launch({ headless: true, channel: "msedge", ...(process.env.SKIFF_BROWSER_EXECUTABLE ? { executablePath: process.env.SKIFF_BROWSER_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const waitUntil = (check, message, timeout = 10000) => page.waitForFunction(check, null, { timeout }).catch(() => { throw new Error(message); });
const deletedFiles = () => page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "delete_session_file").map((item) => item.args.sessionFile));
const sessions = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("skiff.test.sessions"))));
const row = (title) => page.locator(".project-chats .chat-row").filter({ hasText: title });
const bulkButtons = () => page.locator(".sidebar-bulk-actions .ui-button");
const enterBulk = async () => {
	await page.getByRole("button", { name: "批量选择会话" }).click();
	await page.locator(".sidebar-bulk").waitFor();
};
const title = () => page.evaluate(() => document.querySelector(".header-title-row > span:first-child")?.textContent?.trim());

try {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${encodeURIComponent(theme)}`);
	await waitUntil(() => document.querySelector(".sidebar")?.dataset.connected === "true", "Active pi fixture did not connect");
	assert.equal(await page.locator(".project-chats .chat-row").count(), 3, "Fixture starts with three unarchived chats");

	// A selected chat that is generating must block every bulk action.
	await page.getByRole("textbox", { name: "聊天消息" }).fill("检查批量选择期间的归档限制");
	await page.getByRole("button", { name: "发送消息" }).click();
	await page.getByRole("button", { name: "停止生成" }).waitFor();
	await enterBulk();
	assert.equal(await page.locator(".sidebar-row-actions").count(), 0, "Selection mode hides the per-row hover actions");
	assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 0 \/ 3/);
	await row("当前会话").getByRole("checkbox", { name: "选择会话 当前会话" }).click();
	assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 1 \/ 3/, "Clicking the checkbox toggles selection instead of opening the chat");
	assert.ok((await title()).startsWith("当前会话"), "Toggling a row must not navigate away from the open chat");
	assert.ok(await row("当前会话").evaluate((element) => element.classList.contains("checked")), "Selected row gains the checked state");
	assert.equal(await row("当前会话").getByRole("checkbox").getAttribute("aria-checked"), "true", "The row checkbox exposes its selected state");
	assert.equal(await bulkButtons().nth(0).isDisabled(), true, "Bulk archive is disabled while a selected chat is generating");
	assert.equal(await bulkButtons().nth(1).isDisabled(), true, "Bulk delete is disabled while a selected chat is generating");
	await page.getByRole("button", { name: "停止生成" }).click();
	await waitUntil(() => [...document.querySelectorAll(".sidebar-bulk-actions .ui-button")].every((button) => !button.disabled), "Bulk actions did not re-enable after generation stopped");

	// Select-all and per-row toggles combine into the same set.
	await row("同项目候选").click();
	await page.getByRole("button", { name: "全选" }).click();
	assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 3 \/ 3/);
	await page.getByRole("button", { name: "取消全选" }).click();
	assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 0 \/ 3/);

	// Project rows carry their own tri-state checkbox selecting all of that project's chats.
	const projectCheck = page.locator(".project-row [role=checkbox]");
	assert.equal(await projectCheck.count(), 2, "Each project with chats offers a project-level checkbox");
	await projectCheck.nth(0).click();
	assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 2 \/ 3/, "Project checkbox selects every chat of its project");
	assert.equal(await projectCheck.nth(0).getAttribute("aria-checked"), "true", "A fully selected project reports checked");
	await projectCheck.nth(1).click();
	assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 3 \/ 3/, "Project checkboxes combine into the same global set");
	await page.getByRole("button", { name: "取消全选" }).waitFor();
	await row("当前会话").click();
	assert.equal(await projectCheck.nth(0).getAttribute("aria-checked"), "mixed", "A partially selected project reports mixed");
	await projectCheck.nth(0).click();
	assert.equal(await projectCheck.nth(0).getAttribute("aria-checked"), "true", "Clicking a mixed project completes its selection");
	await row("其他项目会话").click();
	assert.equal(await projectCheck.nth(1).getAttribute("aria-checked"), "false", "Clearing a project's last chat reports unchecked");
	assert.match(await page.locator(".sidebar-bulk-count").textContent(), /已选 2 \/ 3/);

	await page.getByRole("button", { name: "归档", exact: true }).click();
	await waitUntil(() => document.querySelectorAll(".project-chats .chat-row").length === 2, "Batch archive did not leave the remaining chat plus the recycled draft");
	const workspace = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")));
	assert.ok(workspace.chats.find((chat) => chat.id === "archive-active").archivedAt > 0, "Batch archive stamps archivedAt on the first chat");
	assert.ok(workspace.chats.find((chat) => chat.id === "archive-candidate").archivedAt > 0, "Batch archive stamps archivedAt on the second chat");
	assert.equal(workspace.chats.find((chat) => chat.id === "archive-other-chat").archivedAt, undefined, "Unselected chats stay unarchived");
	assert.deepEqual(await deletedFiles(), [], "Archiving must not touch pi session files");
	assert.equal(await title(), "主页", "Archiving the active chat returns home");
	assert.equal(await page.locator(".sidebar-bulk").count(), 0, "Batch actions exit selection mode when they finish");

	await enterBulk();
	await row("其他项目会话").click();
	await page.getByRole("button", { name: "删除", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "批量删除聊天" });
	await dialog.getByRole("button", { name: "永久删除所选聊天" }).click();
	await waitUntil(() => ![...document.querySelectorAll(".chat-row")].some((element) => element.textContent.includes("其他项目会话")), "Permanent batch delete did not drop the row");
	assert.deepEqual(await deletedFiles(), ["archive-other.jsonl"], "Permanent delete must remove the pi session file of the selected chat");
	assert.ok(!(await sessions()).includes("archive-other.jsonl"), "Permanent delete removes the file from the mock pi directory");
	assert.ok((await sessions()).includes("archive-active.jsonl"), "Permanent delete keeps other session files");

	// Sidebar removal keeps the pi file; the recycled draft is replaced by a fresh one.
	await enterBulk();
	await row("新聊天").click();
	await waitUntil(() => [...document.querySelectorAll(".sidebar-bulk-actions .ui-button")].every((button) => !button.disabled), "Bulk actions stayed disabled for the fresh draft");
	await page.getByRole("button", { name: "删除", exact: true }).click();
	await page.getByRole("dialog", { name: "批量删除聊天" }).getByRole("button", { name: "从侧栏移除所选聊天" }).click();
	await waitUntil(() => document.querySelectorAll(".project-chats .chat-row").length === 1, "Sidebar removal did not leave a fresh draft row");
	assert.deepEqual(await deletedFiles(), ["archive-other.jsonl"], "Sidebar removal must not delete any pi session file");
	assert.ok((await sessions()).includes("archive-active.jsonl") && (await sessions()).includes("archive-candidate.jsonl"), "Sidebar removal keeps every pi session file");

	await enterBulk();
	await page.keyboard.press("Escape");
	await waitUntil(() => !document.querySelector(".sidebar-bulk"), "Escape did not exit selection mode");
	assert.equal(await page.locator(".project-chats .chat-row.checked").count(), 0, "Exiting selection clears the checked rows");

	assert.deepEqual(errors, [], `Browser reported errors: ${errors.join("; ")}`);
	console.log("PASS bulk selection toggles, select-all, project-level select-all, streaming guard, batch archive semantics and two-strength batch delete");
} finally {
	await browser.close();
}
