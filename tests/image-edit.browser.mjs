import { openCanvasComposer, openDesignCanvas, workbenchTool } from "./workspace-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/image-edit", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const tool = (name) => workbenchTool(page, name);
const generate = () => page.getByRole("button", { name: "生成图片", exact: true });
const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt", exact: true });
const reference = () => page.locator('input[aria-label="上传图生图参考图"]');
const original = { name: "保留透明度.png", mimeType: "image/png", buffer: testImage() };
// A screenshot on the clipboard arrives as a File on a paste event, not through the picker.
const pasteImage = (name = "剪贴板.png") => prompt().evaluate((element, { bytes, name }) => {
	const data = new DataTransfer();
	data.items.add(new File([new Uint8Array(bytes)], name, { type: "image/png" }));
	element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
}, { bytes: [...original.buffer], name });
const pasteTextPrevented = () => prompt().evaluate((element) => {
	const data = new DataTransfer();
	data.setData("text/plain", "保留正文");
	return !element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
});
try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.evaluate(() => { window.revoked = []; const revoke = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = (url) => { window.revoked.push(url); revoke(url); }; });
		await tool("生图").click();
		await page.getByRole("button", { name: "配置生成服务", exact: true }).click();
		const settings = page.getByRole("dialog", { name: "设置", exact: true });
		await settings.getByRole("button", { name: "添加生成服务", exact: true }).click();
		await settings.getByRole("textbox", { name: "API Key", exact: true }).fill("dummy-key");
		await settings.getByRole("button", { name: "保存生成服务", exact: true }).click();
		await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
		await prompt().fill("保留主体，背景改为清晨的花园");
		await reference().setInputFiles(original);
		let imageUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		await reference().setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("bad") });
		await page.getByRole("alert").filter({ hasText: "请选择 PNG" }).waitFor();
		assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), imageUrl);
		await page.getByRole("button", { name: "关闭参考图提示", exact: true }).click();
		// A screenshot on the clipboard takes the same slot as the picker.
		assert.equal(await pasteTextPrevented(), false, "Pasting plain text reaches the textarea untouched");
		await pasteImage();
		const pastedUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		assert.match(pastedUrl, /^blob:http/, "A pasted screenshot becomes the reference blob");
		assert.equal(await page.locator(".generation-reference-caption > span[title]").textContent(), "剪贴板.png");
		await reference().setInputFiles(original);
		imageUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		assert.equal(await page.evaluate((url) => window.revoked.includes(url), pastedUrl), true, "Replacing a pasted reference releases its blob");
		await tool("生成视频").click();
		assert.equal(await page.locator(".generation-reference-image img").count(), 0, "Image and video references are independent");
		await page.locator('input[aria-label="上传首帧参考图"]').setInputFiles({ ...original, name: "独立视频参考.png" });
		const videoUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		await tool("生图").click(); assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), imageUrl);
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await generate().click(); await page.getByText("正在生成图片…", { exact: true }).waitFor();
		await openCanvasComposer(page);
		await prompt().fill("第二张");
		assert.equal(await generate().isEnabled(), true, "An accepted edit leaves capacity for another task");
		const first = await page.evaluate(() => window.skiffPreview.generation.calls);
		assert.equal(first.length, 1); assert.equal(first[0].reference.name, original.name); assert.equal(first[0].reference.dataPrefix, "data:image/png;base64,");
		await page.getByRole("button", { name: "移除图生图参考图", exact: true }).click();
		assert.equal(await page.evaluate((url) => window.revoked.includes(url), imageUrl), true);
		assert.equal(await page.evaluate((url) => window.revoked.includes(url), videoUrl), false);
		await page.getByRole("button", { name: "停止等待", exact: true }).click();
		await page.locator(".design-failure").filter({ hasText: "已停止等待" }).last().waitFor();
		await openDesignCanvas(page);
		await page.locator(".design-failure").filter({ hasText: "已停止等待" }).last().waitFor();
		await page.evaluate(() => window.skiffPreview.generation.setMode("success"));
		await reference().setInputFiles(original); await generate().click();
		await page.locator(".design-result-card").first().waitFor();
		assert.match(await page.locator(".design-turn").last().innerText(), /第二张/, "The settled edit keeps its prompt in the flow");
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.at(-1).reference?.name), original.name, "The successful edit carries its reference");
		const card = page.locator(".design-result-card");
		// The mock result is 1×1, so the hover-only action button sits outside the
		// card; the card's context menu opens the same actions at any image size.
		await card.locator(".generation-card-preview").click({ button: "right" });
		await page.getByRole("menuitem", { name: "用作参考图", exact: true }).click();
		await page.locator(".generation-reference.has-image").waitFor();
		const sharedUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		await page.screenshot({ path: `dist/image-edit/${theme}-reference.png` });
		await page.getByRole("button", { name: "移除图生图参考图", exact: true }).click();
		assert.equal(await page.evaluate((url) => window.revoked.includes(url), sharedUrl), false, "Removing a shared reference keeps its original alive");
		await card.locator(".generation-card-preview").click({ button: "right" });
		await page.getByRole("menuitem", { name: "用作参考图", exact: true }).click();
		await prompt().fill("参考图片生成失败测试");
		await page.evaluate(() => window.skiffPreview.generation.setMode("failure")); await generate().click();
		// Detailed edit errors now sit behind the "查看原因" disclosure.
		const editFailure = page.locator(".design-failure[data-prominent]").last();
		await editFailure.getByRole("button", { name: "查看原因", exact: true }).click();
		await editFailure.locator(".design-failure-reason").filter({ hasText: /图生图失败：.*未自动改为文生图/ }).waitFor();
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.length), 3);
		await openCanvasComposer(page);
		await page.getByRole("button", { name: "移除图生图参考图", exact: true }).click();
		await prompt().fill("移除参考图后重新生成");
		await page.evaluate(() => window.skiffPreview.generation.setMode("success")); await generate().click();
		await page.waitForFunction(() => document.querySelectorAll(".design-result-card").length === 2);
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.at(-1).reference), undefined, "Removing reference restores ordinary text generation");
		await page.setViewportSize({ width: 600, height: 800 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.screenshot({ path: `dist/image-edit/${theme}-narrow.png` });
		console.log(`PASS ${theme}: reference upload/validation, independent video draft, snapshot, URL cleanup, asset reuse, edits failure without fallback, text mode and narrow layout`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
