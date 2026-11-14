import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/generation-picker", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const chip = (label) => page.getByRole("button", { name: new RegExp(`^${label}：`) });
const list = (label) => page.getByRole("listbox", { name: label, exact: true });
const focusedPicker = () => page.evaluate(() => document.activeElement?.classList.contains("generation-picker-trigger"));

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		// Seed after the harness has written its own startup state.
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => {
			const serviceId = crypto.randomUUID();
			const sizes = ["1024x1024", "1536x864"];
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: serviceId, services: [{ id: serviceId, name: "灵感工作室", baseUrl: "https://example.invalid/v1", configured: true, keyHint: "…test", defaultModel: "image-studio", models: [{ id: "image-studio", sizes }, { id: "seedream-5.5", sizes }, { id: "nano-banana", sizes }] }] }));
			localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
		});
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
		// The previous theme leaves the stored kind on the video tab; start on images.
		await page.getByRole("group", { name: "创作类型", exact: true }).getByRole("button", { name: "图片", exact: true }).click();
		await page.locator(".design-gallery-route:not([hidden]) .design-composer").waitFor();

		// Service, model and quality are popover chips, never native selects.
		assert.equal(await page.locator(".design-composer .generation-settings select").count(), 0, "The design composer has no native select");
		assert.equal(await chip("模型").getAttribute("aria-label"), "模型：image-studio");

		await chip("模型").click();
		await list("模型").waitFor();
		assert.equal(await list("模型").getByRole("option").count(), 3);
		assert.equal(await list("模型").getByRole("option", { name: /^image-studio/ }).getAttribute("aria-selected"), "true");
		await page.screenshot({ path: `dist/generation-picker/${theme}-model.png` });
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");
		await list("模型").waitFor({ state: "detached" });
		assert.equal(await chip("模型").getAttribute("aria-label"), "模型：seedream-5.5");
		assert.equal(await focusedPicker(), true, "Choosing a model returns focus to its chip");

		await chip("模型").click();
		await list("模型").waitFor();
		await page.keyboard.press("Escape");
		await list("模型").waitFor({ state: "detached" });
		assert.equal(await focusedPicker(), true, "Escape restores focus to the chip");

		await chip("质量").click();
		await list("质量").waitFor();
		await list("质量").getByRole("option", { name: "高", exact: true }).click();
		await list("质量").waitFor({ state: "detached" });
		assert.equal(await chip("质量").getAttribute("aria-label"), "质量：高");

		await chip("生成服务").click();
		await list("生成服务").waitFor();
		assert.match(await list("生成服务").innerText(), /灵感工作室/);
		await page.screenshot({ path: `dist/generation-picker/${theme}-service.png` });
		await page.keyboard.press("Escape");

		// The video tab reuses the same chip and stays disabled until a service exists.
		await page.getByRole("group", { name: "创作类型", exact: true }).getByRole("button", { name: "视频", exact: true }).click();
		await page.locator(".design-gallery-route:not([hidden]) .design-composer").waitFor();
		assert.equal(await page.locator(".design-gallery-route:not([hidden])").getByRole("button", { name: "模型", exact: true }).isDisabled(), true);
		assert.equal(await page.locator(".design-gallery-route:not([hidden]) .generation-picker-trigger").count(), 2);

		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.length), 0, "Choosing settings never generates");
		console.log(`PASS ${theme}: chip labels, listbox options, keyboard select, escape focus, quality and video disabled states`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
