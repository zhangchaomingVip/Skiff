import { workbenchTool } from "./workspace-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/image-gallery", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const tool = (name) => workbenchTool(page, name);
const view = (name) => page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: new RegExp(`^${name} `) });
try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.evaluate((image) => {
			const base = { serviceId: "service", serviceName: "Mock", modelId: "test-image", size: "1024x1024", quality: "auto", createdAt: Date.now(), prompt: "保留的作品" };
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: "service", services: [{ id: "service", name: "Mock", configured: true, keyHint: "…test", baseUrl: "https://example.invalid/v1", models: [{ id: "test-image", sizes: ["1024x1024"] }], defaultModel: "test-image" }] }));
			localStorage.setItem("skiff.test.images.jobs", JSON.stringify([{ ...base, id: "saved", status: "completed", path: image, actualSize: "32x32" }, ...["failed", "cancelled", "interrupted"].map((status, i) => ({ ...base, id: `ended-${i}`, status, prompt: `失败提示词 ${i} ${"长提示词，".repeat(70)}`, message: "HTTP 400：服务无法生成此图片。" }))]));
			localStorage.setItem("skiff.test.design-assets", "[]");
			localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
			const url = new URL(location.href); url.searchParams.set("persist", "1"); history.replaceState(null, "", url);
		}, `data:image/png;base64,${testImage().toString("base64")}`);
		// The previous theme leaves the stored collection on its last view.
		await page.reload(); await view("作品").click();
		// Jobs load asynchronously, so wait for the persisted work instead of sampling the list.
		await page.locator(".generation-card").first().waitFor();
		assert.equal(await page.locator(".generation-card").count(), 1);
		assert.equal(await page.locator(".generation-task-list").count(), 0, "Historical failures never occupy the gallery");
		assert.equal(await view("失败记录").innerText(), "失败记录 3");
		await view("失败记录").click(); assert.equal(await page.locator(".generation-task").count(), 3); assert.equal(await page.locator(".generation-card").count(), 0);
		const failed = page.locator('.generation-task[data-status="failed"]');
		await failed.getByText("查看完整记录", { exact: true }).click(); assert.equal(await failed.locator("details").evaluate((details) => details.open), true);
		await failed.getByRole("button", { name: "使用提示词", exact: true }).click();
		assert.match(await page.getByRole("textbox", { name: "提示词 Prompt" }).inputValue(), /^失败提示词 0/);
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.length), 0);
		await page.screenshot({ path: `dist/image-gallery/${theme}-failures.png` });
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await page.getByRole("button", { name: "生成图片", exact: true }).click(); await page.getByText("正在生成图片…", { exact: true }).waitFor();
		assert.equal(await view("作品").getAttribute("aria-pressed"), "true"); assert.equal(await page.locator(".generation-task-list").count(), 0);
		await page.getByRole("button", { name: "停止等待", exact: true }).click();
		await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="画廊视图"] button')].some((button) => button.textContent === "失败记录 4"));
		assert.equal(await page.locator(".generation-task-list").count(), 0);
		const card = page.locator(".generation-card");
		await card.getByRole("button", { name: /^更多作品操作/ }).click(); await page.getByRole("menuitem", { name: "以此图生成图片", exact: true }).click();
		const referenceUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		await card.getByRole("button", { name: /^更多作品操作/ }).click(); await page.getByRole("menuitem", { name: "从画廊移除", exact: true }).click();
		await page.waitForFunction(() => document.querySelectorAll(".generation-card").length === 0);
		assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), referenceUrl, "Removing from gallery preserves current reference");
		await page.reload(); assert.equal(await page.locator(".generation-card").count(), 0);
		await view("已移除").click(); await page.locator(".generation-card").waitFor();
		await page.screenshot({ path: `dist/image-gallery/${theme}-removed.png` });
		await page.getByRole("button", { name: "恢复到画廊", exact: true }).click();
		await view("作品").click(); await page.locator(".generation-card").waitFor();
		await page.locator('input[aria-label="导入图片作品"]').setInputFiles({ name: "本地导入.png", mimeType: "image/png", buffer: testImage() });
		await page.getByRole("button", { name: "预览图片：本地导入.png", exact: true }).click();
		await page.getByRole("dialog", { name: "图片预览", exact: true }).getByRole("button", { name: "从画廊移除", exact: true }).click();
		await view("已移除").click(); await page.getByRole("button", { name: "恢复到画廊", exact: true }).click();
		await view("作品").click(); assert.equal(await page.locator(".generation-card").count(), 2);
		await page.screenshot({ path: `dist/image-gallery/${theme}-gallery.png` });
		await page.setViewportSize({ width: 390, height: 780 });
		if (await page.getByRole("dialog", { name: "项目与聊天导航", exact: true }).isVisible()) await page.keyboard.press("Escape");
		await view("失败记录").click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.screenshot({ path: `dist/image-gallery/${theme}-narrow.png` });
		console.log(`PASS ${theme}: separate failure page, compact/full errors, pending stays visible, durable removal/restore, reference preservation, imported preview removal and narrow layout`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
