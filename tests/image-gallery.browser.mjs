import { openCanvasComposer, openDesignCanvas, workbenchTool } from "./workspace-navigation.mjs";
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
const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt" });
const card = (text) => page.locator(".design-turn").filter({ hasText: text }).locator(".design-result-card");
const openMenu = async (target) => { await target.locator(".generation-card-media").hover(); await target.locator(".generation-more-trigger").click(); };
const library = async () => { await page.getByRole("navigation", { name: "素材", exact: true }).getByRole("button", { name: /^资产库/ }).click(); await page.getByRole("region", { name: "资产库", exact: true }).waitFor(); };
try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.evaluate((image) => {
			const base = { serviceId: "service", serviceName: "Mock", modelId: "test-image", size: "1024x1024", quality: "auto", createdAt: Date.now(), prompt: "保留的作品" };
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: "service", services: [{ id: "service", name: "Mock", configured: true, keyHint: "…test", baseUrl: "https://example.invalid/v1", models: [{ id: "test-image", sizes: ["1024x1024"] }], defaultModel: "test-image" }] }));
			localStorage.setItem("skiff.test.images.jobs", JSON.stringify([{ ...base, id: "saved", status: "completed", path: image, actualSize: "32x32" }, ...["failed", "cancelled", "interrupted"].map((status, i) => ({ ...base, id: `ended-${i}`, status, prompt: `失败提示词 ${i} ${"长提示词，".repeat(70)}`, message: "HTTP 400：服务无法生成此图片。", createdAt: base.createdAt - (i + 1) * 1000 }))]));
			localStorage.setItem("skiff.test.design-assets", JSON.stringify([{ id: "imported", kind: "image", name: "本地导入.png", mime: "image/png", path: image, size: image.length, removed: false, createdAt: Date.now() + 1000 }]));
			localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
			const url = new URL(location.href); url.searchParams.set("persist", "1"); history.replaceState(null, "", url);
		}, `data:image/png;base64,${testImage().toString("base64")}`);
		await page.reload(); await openDesignCanvas(page);

		// Settled jobs live in the flow: one work, three inline failure turns.
		await page.locator(".design-result-card").first().waitFor();
		await page.getByRole("button", { name: "预览图片：本地导入.png", exact: true }).waitFor();
		assert.equal(await page.locator(".design-turn").count(), 5, "One turn per work and per settled failure");
		assert.equal(await page.locator(".design-result-card").count(), 2, "The generated work and the imported work keep their cards");
		assert.equal(await page.locator(".design-failure").count(), 3, "Historical failures sit next to their prompts");
		assert.equal(await page.getByRole("group", { name: "画廊视图", exact: true }).count(), 0, "No status tabs survive");
		const failed = page.locator(".design-turn").filter({ hasText: "失败提示词 0" }).locator(".design-failure");
		assert.match(await failed.innerText(), /生成失败，请调整后重试/);
		assert.equal(await failed.innerText().then((text) => text.includes("HTTP 400")), false, "The error log never leaks into the flow");
		await failed.getByRole("button", { name: "修改后重新生成", exact: true }).click();
		await openCanvasComposer(page);
		assert.match(await prompt().inputValue(), /^失败提示词 0/);
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.length), 0);
		await page.screenshot({ path: `dist/image-gallery/${theme}-failures.png` });

		// A new submission joins the newest slot and settles in place.
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await prompt().fill("停止等待后留在对话里");
		await page.getByRole("button", { name: "生成图片", exact: true }).click(); await page.getByText("正在生成图片…", { exact: true }).waitFor();
		assert.equal(await page.locator(".design-turn").last().evaluate((element) => !!element.querySelector(".generation-pending-card")), true);
		await page.getByRole("button", { name: "停止等待", exact: true }).click();
		await page.locator(".design-failure").filter({ hasText: "服务端可能仍在生成" }).waitFor();
		assert.equal(await page.locator(".design-failure").count(), 4, "The stopped task settles into the flow");

		// Removal keeps the current reference and lands in the library's removed view.
		const generated = card("保留的作品");
		await openMenu(generated); await page.getByRole("menuitem", { name: "以此图生成图片", exact: true }).click();
		await page.locator(".design-composer[data-variant=hero]").waitFor();
		const referenceUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		await openMenu(generated); await page.getByRole("menuitem", { name: "从作品流移除", exact: true }).click();
		await page.waitForFunction(() => document.querySelectorAll(".design-result-card").length === 1);
		assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), referenceUrl, "Removing a work preserves the current reference");
		await library();
		await page.getByRole("group", { name: "画布筛选", exact: true }).getByRole("button", { name: /^已移除/ }).click();
		await page.getByRole("button", { name: /^预览作品：skiff-/ }).first().waitFor();
		await page.screenshot({ path: `dist/image-gallery/${theme}-removed.png` });
		await page.getByRole("button", { name: "恢复", exact: true }).click();
		await page.getByRole("group", { name: "画布筛选", exact: true }).getByRole("button", { name: /^全部/ }).click();
		assert.equal(await page.locator(".generation-gallery-grid .generation-card").count(), 2, "The restored work returns to the library");

		// Imported media is removable from the flow and restorable the same way.
		await page.getByRole("navigation", { name: "创作", exact: true }).getByRole("button", { name: /^首页/ }).click();
		await page.locator(".design-thread").waitFor();
		await openMenu(card("本地导入.png")); await page.getByRole("menuitem", { name: "从作品流移除", exact: true }).click();
		await page.waitForFunction(() => document.querySelectorAll(".design-result-card").length === 1);
		await library();
		await page.getByRole("group", { name: "画布筛选", exact: true }).getByRole("button", { name: /^已移除/ }).click();
		await page.getByRole("button", { name: "预览作品：本地导入.png", exact: true }).click();
		await page.getByRole("dialog", { name: "作品预览", exact: true }).getByRole("button", { name: "恢复到作品流", exact: true }).click();
		await page.getByRole("group", { name: "画布筛选", exact: true }).getByRole("button", { name: /^全部/ }).click();
		assert.equal(await page.locator(".generation-gallery-grid .generation-card").count(), 2);
		await page.screenshot({ path: `dist/image-gallery/${theme}-gallery.png` });

		await page.setViewportSize({ width: 390, height: 780 });
		if (await page.getByRole("dialog", { name: "Design 导航", exact: true }).isVisible()) await page.keyboard.press("Escape");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.screenshot({ path: `dist/image-gallery/${theme}-narrow.png` });
		console.log(`PASS ${theme}: inline failure turns, prompt reuse, in-place pending stop, durable removal/restore for generated and imported works, reference preservation and narrow layout`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
