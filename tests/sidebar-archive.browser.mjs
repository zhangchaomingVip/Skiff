import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge", ...(process.env.SKIFF_BROWSER_EXECUTABLE ? { executablePath: process.env.SKIFF_BROWSER_EXECUTABLE } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.addInitScript(() => {
	if (sessionStorage.getItem("skiff.test.invalid-widths") === "true") return;
	localStorage.setItem("skiff.sidebar.width", "9999");
	localStorage.setItem("skiff.voyage.width", "100");
	sessionStorage.setItem("skiff.test.invalid-widths", "true");
});
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const waitUntil = (check, message, timeout = 10000, arg = null) => page.waitForFunction(check, arg, { timeout }).catch(async () => {
	const state = await page.evaluate(() => ({ processes: [...window.skiffPreview.processes.keys()], listeners: [...window.skiffPreview.listeners.keys()], lifecycle: window.skiffPreview.commands.filter(({ command }) => ["plugin:event|listen", "plugin:event|unlisten", "rpc_start", "rpc_stop"].includes(command)).map(({ command, args }) => ({ command, event: args?.event, eventId: args?.eventId, instanceId: args?.options?.instanceId ?? args?.instanceId })) })).catch(() => undefined);
	throw new Error(`${message}${state ? ` (${JSON.stringify(state)})` : ""}`);
});
const countPreviewProcesses = () => page.evaluate(() => window.skiffPreview.processes.size);
const countPreviewListeners = () => page.evaluate(() => window.skiffPreview.listeners.size);
const commandTypes = (prefix) => page.evaluate((prefix) => window.skiffPreview.commands.filter((item) => item.command === "rpc_send" && item.args.instanceId.startsWith(prefix)).map((item) => JSON.parse(item.args.message).type), prefix);
const openSettings = async () => {
	await page.getByRole("button", { name: "设置" }).click();
	await page.getByRole("button", { name: "归档会话", exact: true }).click();
};
const title = () => page.locator(".header-title-row > span:first-child").textContent();

try {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light&persist=1`);
	await waitUntil(() => document.querySelector(".sidebar-footer")?.textContent.includes("pi 已连接"), "Active pi fixture did not connect");
	await waitUntil(() => document.querySelector(".voyage-rail.expanded"), "Desktop rail did not expand on initial load");
	assert.match((await title())?.trim(), /^当前会话/);
	assert.equal(await page.getByRole("separator", { name: "调整左侧导航宽度" }).getAttribute("aria-valuenow"), "240", "Invalid left width should use its default");
	assert.equal(await page.getByRole("separator", { name: "调整右侧航行台宽度" }).getAttribute("aria-valuenow"), "260", "Invalid right width should use its default");
	assert.equal(await page.locator(".project-chats .chat-row").count(), 3, "Unarchived chats appear exactly once");
	const projectCount = await page.locator(".project-row").filter({ hasText: "Skiff Archive" }).locator(".project-count").textContent();
	assert.equal(projectCount, "2", "Archived chats must not affect project counts");
	const beforeArchiveSearch = await page.locator(".sidebar-scroll .chat-row").count();
	await page.getByRole("button", { name: "搜索项目与聊天" }).click();
	await page.getByRole("textbox", { name: "搜索项目与聊天" }).fill("已归档会话");
	assert.equal(await page.locator(".sidebar-scroll .chat-row").count(), 0, "Archived chats must not appear in sidebar search");
	await page.getByRole("textbox", { name: "搜索项目与聊天" }).press("Escape");
	assert.ok(beforeArchiveSearch > 0);
	await page.locator(".project-chats .chat-row").filter({ hasText: "当前会话" }).click({ button: "right" });
	const chatMenu = page.getByRole("menu");
	await chatMenu.getByRole("button", { name: "归档", exact: true }).waitFor();
	await page.keyboard.press("Escape");
	await chatMenu.waitFor({ state: "detached" });


	const baselineProcesses = await countPreviewProcesses();
	const baselineListeners = await countPreviewListeners();
	const workspaceBeforePreview = await page.evaluate(() => {
		const workspace = JSON.parse(localStorage.getItem("skiff.workspace.v1"));
		return { activeId: workspace.activeId, model: workspace.chats.find((chat) => chat.id === workspace.activeId)?.selectedModel };
	});
	await openSettings();
	assert.equal(await page.locator(".archive-session-row").count(), 3);
	const archiveSearch = page.getByRole("textbox", { name: "搜索归档会话和项目" });
	await archiveSearch.fill("Other Project");
	assert.equal(await page.locator(".archive-session-row").count(), 1, "Archive list should search project names");
	await archiveSearch.fill("已归档会话");
	assert.equal(await page.locator(".archive-session-row").count(), 1, "Archive list should search chat titles");
	await archiveSearch.fill("");
	await page.locator(".archive-session-row").filter({ hasText: "缺失文件归档" }).getByRole("button", { name: "查看" }).click();
	const missingPreview = page.locator(".archive-preview-dialog");
	await missingPreview.getByRole("alert").waitFor();
	assert.ok(await missingPreview.getByRole("button", { name: "重试" }).isVisible());
	assert.ok(await missingPreview.getByRole("button", { name: /恢复并继续/ }).isEnabled());
	assert.ok(await missingPreview.getByRole("button", { name: /删除索引记录/ }).isEnabled());
	await missingPreview.getByRole("button", { name: "重试" }).click();
	await missingPreview.getByRole("alert").waitFor();
	await missingPreview.getByRole("button", { name: "关闭归档预览" }).click();
	await waitUntil((baseline) => window.skiffPreview.processes.size === baseline.processes && window.skiffPreview.listeners.size === baseline.listeners, "Failed preview left a process or listener behind", 10000, { processes: baselineProcesses, listeners: baselineListeners });

	await page.locator(".archive-session-row").filter({ hasText: "已归档会话" }).getByRole("button", { name: "查看" }).click();
	const preview = page.locator(".archive-preview-dialog");
	await preview.locator(".message-image").waitFor();
	assert.ok(await preview.locator(".thinking").count(), "Read-only preview should include reasoning");
	assert.ok(await preview.locator(".tool .tool-output").filter({ hasText: "归档工具输出" }).count(), "Read-only preview should include tool results");
	assert.ok(await preview.getByRole("button", { name: "复制消息" }).count());
	assert.equal(await preview.getByRole("textbox").count(), 0, "Read-only preview must not expose a composer");
	for (const label of ["编辑并重发", "重新生成", "删除本轮及后续消息", "继续生成"]) assert.equal(await preview.locator(`[aria-label="${label}"]`).count(), 0, `${label} must not be available in read-only preview`);
	const archiveCommands = await commandTypes("archive_");
	assert.deepEqual(archiveCommands.filter((type) => type !== "switch_session" && type !== "get_messages"), [], "Preview may only switch and read history");
	const workspaceDuringPreview = await page.evaluate(() => {
		const workspace = JSON.parse(localStorage.getItem("skiff.workspace.v1"));
		return { activeId: workspace.activeId, model: workspace.chats.find((chat) => chat.id === workspace.activeId)?.selectedModel };
	});
	assert.deepEqual(workspaceDuringPreview, workspaceBeforePreview, "Preview must not change the active workspace or model");
	await preview.getByRole("button", { name: "关闭归档预览" }).click();
	await waitUntil((baseline) => window.skiffPreview.processes.size === baseline.processes && window.skiffPreview.listeners.size === baseline.listeners, "Successful preview left a process or listener behind", 10000, { processes: baselineProcesses, listeners: baselineListeners });

	await page.locator(".archive-session-row").filter({ hasText: "空白归档" }).getByRole("button", { name: "查看" }).click();
	const emptyPreview = page.locator(".archive-preview-dialog");
	await emptyPreview.getByText("此归档没有消息").waitFor();
	await emptyPreview.getByRole("button", { name: "关闭归档预览" }).click();

	await page.locator(".archive-session-row").filter({ hasText: "已归档会话" }).getByRole("button", { name: "恢复" }).click();
	await waitUntil(() => document.querySelector(".header-title-row > span:first-child")?.textContent?.trim().startsWith("已归档会话"), "Restore did not enter the conversation");
	assert.equal(await page.locator("dialog[open]").count(), 0, "Restore should close settings");
	assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "archive-record").archivedAt), undefined);
	const activeArchiveButton = page.locator(".project-chats").getByRole("button", { name: "归档聊天 已归档会话" });
	const activeChatRow = page.locator(".project-chats .chat-row").filter({ hasText: "已归档会话" });
	await waitUntil(() => !document.querySelector(".project-chats .chat-row.selected .sidebar-row-actions button[aria-label='归档聊天 已归档会话']")?.disabled, "Active archive action remained disabled after session restore");
	await activeArchiveButton.scrollIntoViewIfNeeded();
	await activeChatRow.hover();
	await waitUntil(() => getComputedStyle(document.querySelector(".project-chats .chat-row.selected .sidebar-row-actions")).pointerEvents === "auto", "Recent row actions did not become interactive");
	const actionPoint = await activeArchiveButton.evaluate((button) => { const rect = button.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; });
	await page.mouse.click(actionPoint.x, actionPoint.y);
	await waitUntil(() => document.querySelector(".header-title-row > span:first-child")?.textContent?.trim() === "主页", "Archiving the active chat did not return home");
	assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId), "archive-candidate", "Active archive should select the latest unarchived chat in its project");
	assert.equal(await page.locator(".project-row").filter({ hasText: "Skiff Archive" }).locator(".project-count").textContent(), "2");

	await openSettings();
	await page.locator(".archive-session-row").filter({ hasText: "已归档会话" }).getByRole("button", { name: "删除归档" }).click();
	await page.getByRole("button", { name: "确认删除" }).click();
	await waitUntil(() => ![...document.querySelectorAll(".archive-session-row")].some((row) => row.textContent.includes("已归档会话")), "Archive index entry was not deleted");
	assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.test.sessions"))["archive-record.jsonl"]), "Deleting the archive must retain its pi session file");
	await page.getByRole("button", { name: "关闭设置", exact: true }).click();

	await page.locator(".project-chats .chat-link[title^='同项目候选']").click({ position: { x: 20, y: 16 } });
	await waitUntil(() => document.querySelector(".voyage-rail.expanded"), "Desktop rail did not expand");
	const modelTrigger = page.getByRole("button", { name: "选择模型" });
	assert.match((await modelTrigger.textContent()) ?? "", /Skiff Long Model Alias/);
	assert.doesNotMatch((await modelTrigger.textContent()) ?? "", /DeepSeek/);
	assert.match(await modelTrigger.getAttribute("title"), /route-deepseek-r1/);
	await waitUntil(() => !document.querySelector(".model-trigger")?.disabled, "Model menu remained disabled after chat selection");
	await modelTrigger.press("Enter");
	await waitUntil(() => document.querySelector(".model-trigger")?.getAttribute("aria-expanded") === "true", "Keyboard did not open the model menu");
	const modelPicker = page.getByRole("dialog", { name: "选择模型" });
	const modelSearch = modelPicker.getByRole("combobox", { name: "搜索家族、提供商或模型" });
	await modelSearch.waitFor();
	await modelSearch.fill("deepseek-chat");
	assert.equal(await modelPicker.getByRole("option").count(), 2, "Model menu should preserve both routes for the same model");
	await modelSearch.press("ArrowDown");
	await modelSearch.press("Enter");
	await waitUntil(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "archive-candidate")?.selectedModel?.routeId === "route-deepseek-r2", "Keyboard model selection did not switch to the selected route");
	assert.match(await modelTrigger.getAttribute("title"), /route-deepseek-r2/);
	assert.equal(await page.locator(".model-trigger-label").evaluate((element) => getComputedStyle(element).textOverflow), "ellipsis", "Long model aliases should truncate without changing the trigger layout");
	await page.keyboard.press("Control+Comma");
	await page.getByRole("button", { name: "深色", exact: true }).click();
	await page.getByRole("button", { name: "关闭设置", exact: true }).click();
	await waitUntil(() => document.documentElement.dataset.theme === "dark", "Dark theme did not apply");
	assert.ok(await modelTrigger.isVisible(), "Model selector should remain visible in dark theme");

	await page.getByRole("textbox", { name: "聊天消息" }).fill("检查生成期间归档限制");
	await page.getByRole("button", { name: "发送消息" }).click();
	await page.getByRole("button", { name: "停止生成" }).waitFor();
	await waitUntil(() => document.querySelector(".project-chats .chat-row.selected .sidebar-row-actions button[aria-label^='归档聊天']")?.disabled === true, "Archive action should be disabled while generating");
	await page.getByRole("button", { name: "停止生成" }).click();
	await waitUntil(() => document.querySelector(".project-chats .chat-row.selected .sidebar-row-actions button[aria-label^='归档聊天']")?.disabled === false, "Archive action did not re-enable after generation stopped");

	const leftSeparator = page.getByRole("separator", { name: "调整左侧导航宽度" });
	const drag = async (separator, deltaX) => {
		const rect = await separator.boundingBox();
		await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
		await page.mouse.down();
		await page.mouse.move(rect.x + rect.width / 2 + deltaX, rect.y + rect.height / 2, { steps: 5 });
		await page.mouse.up();
	};
	await drag(leftSeparator, 60);
	let leftWidth = Number(await leftSeparator.getAttribute("aria-valuenow"));
	assert.ok(leftWidth >= 300 && leftWidth <= 420, `Unexpected left width ${leftWidth}`);
	await leftSeparator.focus();
	await page.keyboard.press("ArrowRight");
	let keyboardWidth = Number(await leftSeparator.getAttribute("aria-valuenow"));
	assert.equal(keyboardWidth, leftWidth + 12, "Keyboard separator adjustment failed");
	await page.keyboard.press("Home");
	assert.equal(await leftSeparator.getAttribute("aria-valuenow"), "200", "Left separator should honor its minimum");
	await page.keyboard.press("End");
	keyboardWidth = Number(await leftSeparator.getAttribute("aria-valuenow"));
	assert.equal(keyboardWidth, 420, "Left separator should honor its maximum");
	const rightSeparator = page.getByRole("separator", { name: "调整右侧航行台宽度" });
	await drag(rightSeparator, -60);
	const rightWidthAfterDrag = Number(await rightSeparator.getAttribute("aria-valuenow"));
	assert.ok(rightWidthAfterDrag >= 300 && rightWidthAfterDrag <= 480, `Unexpected right width ${rightWidthAfterDrag}`);
	await rightSeparator.focus();
	await page.keyboard.press("ArrowLeft");
	const rightWidth = Number(await rightSeparator.getAttribute("aria-valuenow"));
	assert.equal(rightWidth, rightWidthAfterDrag + 12, "Right separator keyboard adjustment failed");
	assert.ok(await page.locator(".chat").evaluate((element) => element.getBoundingClientRect().width >= 360), "Chat width fell below 360px");
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.sidebar.width")), String(keyboardWidth));
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.voyage.width")), String(rightWidth));

	await page.reload();
	await waitUntil(() => document.querySelector(".sidebar-footer")?.textContent.includes("pi 已连接"), "Reloaded preview did not reconnect");
	assert.equal(await page.getByRole("separator", { name: "调整左侧导航宽度" }).getAttribute("aria-valuenow"), String(keyboardWidth));
	assert.equal(await page.getByRole("separator", { name: "调整右侧航行台宽度" }).getAttribute("aria-valuenow"), String(rightWidth));

	await page.setViewportSize({ width: 800, height: 900 });
	await waitUntil(() => document.querySelector(".chat-and-rail.rail-collapsed"), "Right rail did not temporarily collapse in a narrow workspace");
	assert.equal(await page.getByRole("separator", { name: "调整右侧航行台宽度" }).count(), 0);
	assert.equal(await page.locator(".model-trigger-label").evaluate((element) => getComputedStyle(element).textOverflow), "ellipsis", "Long model aliases should remain truncated in a narrow workspace");
	await page.setViewportSize({ width: 1440, height: 960 });
	await waitUntil(() => document.querySelector(".voyage-rail.expanded"), "Right rail did not restore after the window widened");
	assert.equal(await page.getByRole("separator", { name: "调整右侧航行台宽度" }).getAttribute("aria-valuenow"), String(rightWidth));
	await page.setViewportSize({ width: 600, height: 800 });
	await waitUntil(() => document.querySelector(".ui-dialog[data-variant='drawer'][open]"), "Narrow viewport did not retain the sidebar drawer");
	assert.equal(await page.locator(".resize-separator").count(), 0, "Resize handles must be absent in drawer mode");
	assert.deepEqual(errors, [], `Browser reported errors: ${errors.join("; ")}`);
	console.log("PASS archive search, read-only preview/cleanup, restore/delete semantics, single sidebar list, desktop resizing, persistence, responsive collapse and drawer mode");
} finally {
	await browser.close();
}
