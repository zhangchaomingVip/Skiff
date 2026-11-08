import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const base = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 850 }, reducedMotion: "reduce" });
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const settings = page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => settings.getByRole("button", { name, exact: true });
const savedModels = () => page.evaluate(() => structuredClone(window.skiffPreview.relays.find((relay) => relay.id === "r1").models));
const priceRequests = () => page.evaluate(() => window.skiffPreview.commands.filter((entry) => entry.command === "fetch_public_catalog"));
const withoutPrices = (models) => models.map(({ inputCost, outputCost, cacheReadCost, cacheWriteCost, currency, ...model }) => model);
const openPricing = async () => { await settings.locator('details[data-section="pricing"] > summary').click(); };

try {
	await mkdir("dist/provider-discovery", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${base}/tests/preview.html?fixture=launcher&theme=${theme}&static=1`);
		await page.getByRole("heading", { name: "可用模型", exact: true }).waitFor();
		assert.equal((await priceRequests()).length, 0, "Launcher does not load any public catalog");
		await page.keyboard.press("Control+Comma");
		await button("供应商").click();
		assert.equal(await settings.locator(".settings-nav").getByRole("button", { name: "模型", exact: true }).count(), 0);
		await button("编辑 官方直连").click();
		assert.equal((await priceRequests()).length, 0, "Provider editing does not load reference data");
		await page.evaluate(() => {
			window.skiffPreview.discovery.models = [
				{ id: "deepseek-flash" },
				{ id: "Vendor/Private-v9-special", vision: true, tools: false, reasoning: false, streaming: false, contextWindow: 64000, maxTokens: 2048 },
				{ id: "bare-alias" }, { id: "bare-alias" },
			];
		});
		await button("获取模型列表").click();
		const custom = settings.locator('[data-model-id="Vendor/Private-v9-special"]');
		await custom.waitFor();
		assert.equal(await settings.locator(".provider-model-editor-row").count(), 5, "Discovery merges every provider ID once, without catalog recommendations");
		assert.equal(await custom.getByRole("textbox", { name: /上下文窗口/ }).inputValue(), "64k");
		await custom.locator("summary").click();
		assert.equal(await custom.getByRole("checkbox", { name: "图片输入", exact: true }).isChecked(), true);
		assert.equal(await custom.getByRole("checkbox", { name: "工具调用", exact: true }).isChecked(), false);
		assert.equal(await custom.getByRole("checkbox", { name: "推理支持", exact: true }).isChecked(), false);
		await custom.getByRole("combobox", { name: "家族", exact: true }).selectOption("");
		assert.equal((await priceRequests()).length, 0, "Discovery only calls the supplier, even for custom IDs");
		await button("保存").click();
		await button("编辑 官方直连").waitFor();
		const before = await savedModels();
		const discovered = before.find((model) => model.modelId === "Vendor/Private-v9-special");
		assert.equal(discovered.maxTokens, 2048);
		assert.equal(discovered.familyId, "");
		assert.equal(discovered.inputCost, 0);
		assert.equal(before.find((model) => model.modelId === "bare-alias").contextWindow, 128000);
		await page.evaluate(() => {
			window.skiffPreview.referencePrices.models = ["deepseek-flash", "Vendor/Private-v9-special", "not-a-provider-model"].map((modelId) => ({
				modelId, name: modelId, provider: "openai", inputCost: 1, outputCost: 2, cacheReadCost: 0.2, cacheWriteCost: 1,
				currency: "USD", contextWindow: 999, maxTokens: 99, vision: false, tools: true, reasoning: true, status: null,
			}));
		});
		await button("编辑 官方直连").click();
		await openPricing();
		await button("同步参考价格").click();
		await settings.getByText(/已同步 2 个模型的参考价格/).waitFor();
		assert.equal((await priceRequests()).length, 1);
		assert.equal((await priceRequests())[0].args.refresh, true);
		await settings.screenshot({ path: `dist/provider-discovery/pricing-${theme}.png` });
		await button("保存").click();
		await button("编辑 官方直连").waitFor();
		const after = await savedModels();
		assert.deepEqual(withoutPrices(after), withoutPrices(before), "Explicit sync never imports models or changes identity, limits, family, alias, switches or capabilities");
		assert.equal(after.find((model) => model.modelId === "Vendor/Private-v9-special").inputCost, 7.2);
		assert.equal(after.find((model) => model.modelId === "bare-alias").inputCost, 0);
		await page.evaluate(() => { window.skiffPreview.referencePrices.fail = true; });
		await button("编辑 官方直连").click();
		await openPricing();
		await button("同步参考价格").click();
		await settings.getByText("Error: 参考价格查询失败", { exact: true }).waitFor();
		await button("取消").click();
		assert.deepEqual(await savedModels(), after, "A failed price lookup leaves the saved provider untouched");
		await settings.screenshot({ path: `dist/provider-discovery/providers-${theme}.png` });
	}
	assert.deepEqual(errors, []);
	console.log("Provider discovery/pricing passed: no models settings or background catalog calls, exact custom IDs, provider/default capabilities, deduplication, explicit price-only sync, unmatched prices and failure preservation; both themes.");
} finally {
	await browser.close();
}
