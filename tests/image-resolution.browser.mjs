import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

await mkdir("dist/image-resolution", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
const resolution = () => page.getByRole("group", { name: "分辨率", exact: true });
try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`http://localhost:1421/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name: "生图", exact: true }).click();
		await page.getByRole("button", { name: "配置生成服务", exact: true }).click();
		await settings().getByRole("button", { name: "添加生成服务", exact: true }).click();
		await settings().getByRole("textbox", { name: "API Key", exact: true }).fill("dummy-key");
		await settings().getByRole("button", { name: "保存生成服务", exact: true }).click();
		await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
		assert.equal(await resolution().getByRole("button", { name: "配置 2K 尺寸", exact: true }).isEnabled(), true);
		assert.equal(await resolution().getByRole("button", { name: "配置 4K 尺寸", exact: true }).isEnabled(), true);
		await page.screenshot({ path: `dist/image-resolution/${theme}-unconfigured.png` });
		await resolution().getByRole("button", { name: "配置 2K 尺寸", exact: true }).click();
		await settings().getByRole("button", { name: "编辑生成服务 OpenAI", exact: true }).click();
		const original = await settings().getByRole("textbox", { name: "可用尺寸 1", exact: true }).inputValue();
		await settings().getByRole("button", { name: "添加 2K 尺寸", exact: true }).click();
		await settings().getByRole("button", { name: "添加 4K 尺寸", exact: true }).click();
		const configured = await settings().getByRole("textbox", { name: "可用尺寸 1", exact: true }).inputValue();
		assert.ok(configured.startsWith(original)); assert.match(configured, /2880x2880/); assert.match(configured, /3840x2160/);
		assert.equal(await settings().getByRole("button", { name: "添加 4K 尺寸", exact: true }).isDisabled(), true);
		assert.equal(await settings().getByRole("textbox", { name: "API Key", exact: true }).inputValue(), "");
		await page.screenshot({ path: `dist/image-resolution/${theme}-presets.png` });
		await settings().getByRole("button", { name: "保存生成服务", exact: true }).click();
		await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
		const ratios = page.getByRole("group", { name: "画面比例", exact: true });
		await ratios.getByRole("button", { name: "16:9", exact: true }).click();
		await resolution().getByRole("button", { name: "2K", exact: true }).click();
		assert.match(await page.locator(".generation-image-ratios").innerText(), /2560 × 1440/);
		await resolution().getByRole("button", { name: "4K", exact: true }).click();
		assert.match(await page.locator(".generation-image-ratios").innerText(), /3840 × 2160/);
		await ratios.getByRole("button", { name: "1:1", exact: true }).click();
		assert.equal(await resolution().getByRole("button", { name: "4K", exact: true }).getAttribute("aria-pressed"), "true");
		assert.match(await page.locator(".generation-image-ratios").innerText(), /2880 × 2880/);
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.length), 0, "Configuring/selecting dimensions never generates or charges");
		await page.screenshot({ path: `dist/image-resolution/${theme}-configured.png` });
		await page.setViewportSize({ width: 390, height: 780 });
		assert.equal(await page.locator(".generation-controls").evaluate((element) => element.scrollWidth > element.clientWidth), false);
		await resolution().scrollIntoViewIfNeeded();
		await page.screenshot({ path: `dist/image-resolution/${theme}-narrow.png` });
		console.log(`PASS ${theme}: missing-tier configuration, merged presets, existing key/sizes preserved, 2K/4K selection and square classification, no generation calls, narrow layout`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
