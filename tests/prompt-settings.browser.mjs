// Focused prompt preferences regression; uses the isolated mock preview origin.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SKIFF_IDENTITY_PROMPT } from "../src/chat/prompt.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? join(process.cwd(), ".playwright-cli/node_modules/playwright-core"));
const origin = process.argv[2] ?? "http://localhost:1421";
const output = join(process.cwd(), "dist/identity-settings");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = page.getByRole("dialog", { name: "设置", exact: true });
const editor = dialog.getByRole("textbox", { name: "附加指令" });
const open = async () => {
	await page.keyboard.press("Control+Comma");
	await dialog.getByRole("button", { name: "系统提示词", exact: true }).click();
	await editor.waitFor();
};
const save = async () => {
	const count = await page.evaluate(() => window.promptStarts.length);
	await dialog.getByRole("button", { name: "保存并重启", exact: true }).click();
	await dialog.waitFor({ state: "detached" });
	await page.waitForFunction((previous) => window.promptStarts.length > previous, count);
	await page.waitForFunction(() => document.querySelector(".composer-input")?.disabled === false);
	return page.evaluate(() => window.promptStarts.at(-1));
};

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1100, height: 750 });
		await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar-footer")?.textContent.includes("pi 已连接"));
		await page.evaluate(() => {
			window.promptStarts = [];
			const invoke = window.__TAURI_INTERNALS__.invoke;
			window.__TAURI_INTERNALS__.invoke = (command, args, ...rest) => {
				if (command === "rpc_start") window.promptStarts.push(args.options.appendSystemPrompt);
				return invoke(command, args, ...rest);
			};
		});
		await open();
		assert.equal(await editor.inputValue(), "");
		assert.match(await dialog.locator(".prompt-hint").innerText(), /清空仅移除自定义指令/);
		await page.screenshot({ path: join(output, `prompt-${theme}.png`) });
		const custom = "请使用中文。\n保留这条多行自定义指令。";
		await editor.fill(custom);
		assert.equal(await save(), `${SKIFF_IDENTITY_PROMPT}\n\n${custom}`);
		await open();
		assert.equal(await editor.inputValue(), custom, "Reopening shows only the saved user instructions");
		await dialog.getByRole("button", { name: "清空", exact: true }).click();
		assert.equal(await editor.inputValue(), "");
		await page.setViewportSize({ width: 600, height: 400 });
		await dialog.locator(".prompt-hint").scrollIntoViewIfNeeded();
		assert.equal(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth), false);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.screenshot({ path: join(output, `prompt-${theme}-600.png`) });
		assert.equal(await save(), SKIFF_IDENTITY_PROMPT, "Clearing must preserve built-in identity at session startup");
		assert.equal(await page.evaluate(() => localStorage.getItem("skiff.prompt.append")), "");
	}
	assert.deepEqual(errors, []);
	console.log("PASS: prompt editing, save/restart, clear/restart, built-in identity, light/dark and 600x400 layout.");
} finally {
	await browser.close();
}
