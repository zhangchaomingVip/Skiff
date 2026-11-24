import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
await fs.mkdir("dist", { recursive: true });

try {
	const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
	const errors = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	await page.goto(`${origin}/tests/preview.html?fixture=title-generation&theme=light`);
	await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	await page.locator(".composer-input").waitFor();
	assert.equal(await page.locator(".sidebar .chat-title").first().innerText(), "新对话");
	await page.locator(".composer-input").fill("帮我给 Skiff 加一个对话标题提取功能，要求能在设置里选择主模型和备用模型，并且尽量使用免费的模型来生成标题");
	await page.locator(".composer-input").press("Enter");
	// The mock answers the summarisation request with a fixed title on a dedicated pi instance.
	await page.waitForFunction(() => [...document.querySelectorAll(".sidebar .chat-title")].some((element) => element.textContent === "示例对话标题"), undefined, { timeout: 30_000 });
	assert.equal(await page.locator(".header-title-row > span").innerText(), "示例对话标题");
	// The title call is one direct HTTP command on the configured primary model — no pi process.
	const titleCalls = await page.evaluate(() => window.skiffPreview.commands.filter(({ command }) => command === "generate_chat_title"));
	assert.equal(titleCalls.length, 1, "exactly one title request");
	assert.equal(titleCalls[0].args.relayId, "r3");
	assert.equal(titleCalls[0].args.modelId, "kimi-k2");
	assert.ok(String(titleCalls[0].args.prompt).includes("生成一个简短的会话标题"));
	assert.equal(await page.evaluate(() => window.skiffPreview.commands.some(({ command, args }) => command === "rpc_start" && String(args?.options?.instanceId ?? "").startsWith("title_"))), false, "no throwaway pi process for titles");
	// The workspace index records the AI title as a custom title, and the visible transcript stays clean.
	const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")));
	const chat = stored.chats.find((item) => item.id === "title-chat");
	assert.equal(chat.title, "示例对话标题");
	assert.equal(chat.customTitle, true);
	assert.equal(await page.locator(".messages .msg").count(), 2, "visible transcript keeps exactly the user turn and the assistant reply");
	// A short first message already shows in full as the derived title: no AI request is spent on it.
	const titleCallsBefore = await page.evaluate(() => window.skiffPreview.commands.filter(({ command }) => command === "generate_chat_title").length);
	await page.keyboard.press("Control+N");
	await page.locator(".composer-input").waitFor();
	await page.locator(".composer-input").fill("你好");
	await page.locator(".composer-input").press("Enter");
	await page.waitForFunction(() => document.querySelector(".msg.assistant"), undefined, { timeout: 30_000 });
	await page.waitForTimeout(2000);
	assert.equal(await page.evaluate(() => window.skiffPreview.commands.filter(({ command }) => command === "generate_chat_title").length), titleCallsBefore, "short first message does not trigger a title request");
	assert.ok(await page.evaluate(() => [...document.querySelectorAll(".sidebar .chat-title")].some((element) => element.textContent === "你好")), "short chat keeps its full first-message title");
	assert.deepEqual(errors, []);
	console.log("PASS title generation: AI title lands in sidebar and workspace via one direct request to the primary model");
	await page.close();

	// The settings page exposes primary/backup rows and the catalog picker in both themes.
	for (const theme of ["light", "dark"]) {
		const settings = await browser.newPage({ viewport: { width: 1440, height: 960 } });
		await settings.goto(`${origin}/tests/preview.html?fixture=title-generation&theme=${theme}`);
		await settings.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await settings.keyboard.press("Control+,");
		await settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "对话", exact: true }).click();
		await settings.getByText("主模型", { exact: true }).waitFor();
		await settings.getByText("备用模型", { exact: true }).waitFor();
		assert.equal(await settings.locator(".settings-row", { hasText: "主模型" }).getByRole("button").first().innerText(), "kimi-k2");
		assert.equal(await settings.locator(".settings-row", { hasText: "备用模型" }).getByRole("button").first().innerText(), "deepseek-chat");
		await settings.screenshot({ path: `dist/title-settings-${theme}.png` });
		await settings.close();
		console.log(`PASS title settings (${theme}): chat category with primary/backup rows`);
	}
} finally {
	await browser.close();
}
