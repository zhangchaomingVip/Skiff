import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/project-picker/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const trigger = () => page.getByRole("button", { name: /^浏览项目：/ });
const picker = () => page.getByRole("dialog", { name: "选择浏览项目", exact: true });
const search = () => page.getByRole("combobox", { name: "搜索项目" });
const activeChat = () => page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		const chatId = await activeChat();
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		assert.equal(await trigger().innerText(), "Skiff");
		await trigger().click();
		await search().waitFor();
		assert.equal(await search().evaluate((el) => el === document.activeElement), true);
		assert.deepEqual(await picker().getByRole("option").allTextContents(), ["Skiff", "aiagent", "cc-switch"]);
		assert.equal(await picker().getByRole("option", { name: "Skiff", exact: true }).getAttribute("aria-selected"), "true");
		assert.equal(await picker().getByRole("option", { name: "aiagent", exact: true }).getAttribute("title"), "D:\\workspace\\aiagent");
		await picker().evaluate(async (el) => { await Promise.all(el.getAnimations().map((animation) => animation.finished)); });
		assert.equal(Math.round((await picker().boundingBox()).width), 260);
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}.png`, output)), animations: "disabled" });
		await search().fill("  AIAGENT  ");
		assert.deepEqual(await picker().getByRole("option").allTextContents(), ["aiagent"]);
		await search().press("Enter");
		await picker().waitFor({ state: "hidden" });
		assert.equal(await trigger().innerText(), "aiagent");
		await page.getByRole("tree", { name: "aiagent 文件树" }).waitFor();
		assert.equal(await activeChat(), chatId, "Browsing another project must preserve the current chat");
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		assert.equal(await trigger().innerText(), "aiagent", "Files and Git share the browsing project");
		await trigger().click();
		await picker().getByRole("button", { name: "回到当前项目" }).click();
		assert.equal(await trigger().innerText(), "Skiff");
		await trigger().focus();
		await trigger().press("ArrowDown");
		await search().press("ArrowDown");
		await search().press("Enter");
		assert.equal(await trigger().innerText(), "aiagent");
		await trigger().click();
		await search().fill("no-such-project");
		await picker().getByRole("status").waitFor();
		assert.equal(await picker().getByRole("option").count(), 0);
		await search().press("Escape");
		assert.equal(await trigger().evaluate((el) => el === document.activeElement), true);
		await trigger().click();
		assert.equal(await search().inputValue(), "");
		await picker().getByRole("button", { name: "新建项目" }).click();
		await page.getByRole("dialog", { name: "创建项目", exact: true }).waitFor();
		await page.getByRole("button", { name: "取消", exact: true }).click();
		await trigger().click();
		await page.locator(".titlebar").click({ position: { x: 450, y: 15 } });
		await picker().waitFor({ state: "hidden" });
	}

	// The picker also lives inside the narrow-screen navigation dialog.
	await page.setViewportSize({ width: 600, height: 680 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
	await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
	await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
	await trigger().click();
	await search().waitFor();
	const bounds = await picker().boundingBox();
	assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 600 && bounds.y + bounds.height <= 680);
	await picker().getByRole("option", { name: "cc-switch", exact: true }).click();
	assert.equal(await trigger().innerText(), "cc-switch");
	await trigger().click();
	await search().press("Escape");
	assert.equal(await page.getByRole("dialog", { name: "项目与聊天导航" }).count(), 1, "Escape closes the picker without closing the drawer");
	assert.deepEqual(errors, []);
	console.log("Project picker: light/dark, search, keyboard, selection, follow, new project, dismissal and narrow drawer passed.");
} finally {
	await browser.close();
}
