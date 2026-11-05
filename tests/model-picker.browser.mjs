import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const base = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const trigger = page.getByRole("button", { name: "选择模型", exact: true });
const search = page.getByRole("combobox", { name: "搜索家族、提供商或模型" });
const catalog = page.getByRole("dialog", { name: "切换模型", exact: true });
const open = async () => { await trigger.click(); await page.getByRole("button", { name: "更多模型…", exact: true }).click(); await search.waitFor(); };
const assertFits = async (selector) => {
	const bounds = await page.locator(selector).evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
	});
	assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width + 1 && bounds.bottom <= bounds.height + 1, JSON.stringify(bounds));
	assert.ok(bounds.scrollWidth <= bounds.clientWidth + 1, `${selector} has horizontal overflow`);
};

try {
	await mkdir("dist/model-picker", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${base}/tests/preview.html?fixture=picker&theme=${theme}&static=1&persist=1`);
		await page.locator(".model-trigger:not(:disabled)").waitFor();
		await trigger.press("Enter");
		assert.equal(await page.locator(".model-quick-option:focus").count(), 1);
		const levels = page.getByRole("group", { name: "推理等级", exact: true });
		await levels.getByRole("button", { name: "低", exact: true }).click();
		await page.waitForFunction(() => document.querySelector(".model-trigger-thinking")?.textContent.includes("思考 低"));
		await levels.getByRole("button", { name: "关闭", exact: true }).click();
		await page.waitForFunction(() => document.querySelector(".model-trigger-thinking")?.textContent.includes("关闭思考"));
		await page.keyboard.press("Escape");
		assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
		await open();
		assert.equal(await search.evaluate((element) => element === document.activeElement), true);
		assert.equal(await catalog.getByRole("option", { selected: true }).count(), 1, "Current model stays visible even when outside the display list");
		await page.getByRole("group", { name: "按提供商筛选" }).getByRole("button", { name: "硅基低价", exact: true }).click();
		assert.ok(await catalog.getByRole("option").count() > 0);
		assert.ok((await page.locator(".model-catalog-meta").allTextContents()).every((text) => text.startsWith("硅基低价")));
		await search.fill(" DeepSeek-V4-Pro ");
		assert.equal(await catalog.getByRole("option").count(), 1);
		await page.getByRole("button", { name: "收藏 硅基低价 deepseek-v4-pro", exact: true }).click();
		assert.equal(await page.getByRole("button", { name: "取消收藏 硅基低价 deepseek-v4-pro", exact: true }).getAttribute("aria-pressed"), "true");
		assert.equal(await catalog.isVisible(), true, "Favoriting must not select or close the catalog");
		await page.getByRole("group", { name: "按提供商筛选" }).getByRole("button", { name: "全部", exact: true }).click();
		assert.equal(await catalog.getByRole("option").count(), 2, "Identical model IDs on different relays remain separate");
		assert.equal(await page.getByRole("button", { name: "收藏 官方直连 deepseek-v4-pro", exact: true }).getAttribute("aria-pressed"), "false");
		await search.fill("no-such-model");
		await search.press("Enter");
		assert.equal(await catalog.getByRole("option").count(), 0);
		assert.equal(await catalog.isVisible(), true);
		await search.fill("deepseek-flash");
		await search.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
		assert.equal(await catalog.isVisible(), true, "IME confirmation must not select a model");
		await page.getByRole("group", { name: "按提供商筛选" }).getByRole("button", { name: "官方直连", exact: true }).click();
		await search.press("End");
		await search.press("Enter");
		await page.waitForFunction(() => document.querySelector(".model-trigger-label")?.textContent === "deepseek-flash");
		assert.equal(await catalog.count(), 0);
		assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
		await trigger.click();
		assert.equal(await page.locator(".model-quick-option").count(), 2, "Quick list contains current and favorite models");
		await page.keyboard.press("ArrowDown");
		assert.equal(await page.locator(".model-quick-option:focus").innerText(), "deepseek-v4-pro");
		await page.keyboard.press("Escape");
		const saved = await page.evaluate(() => localStorage.getItem("skiff.model-favorites.v1"));
		await page.reload();
		await page.locator(".model-trigger:not(:disabled)").waitFor();
		assert.equal(await page.evaluate(() => localStorage.getItem("skiff.model-favorites.v1")), saved, "Favorites survive reload");
		await open();
		await page.getByRole("button", { name: "取消收藏 硅基低价 deepseek-v4-pro", exact: true }).click();
		await page.keyboard.press("Escape");
		await trigger.click();
		assert.equal(await page.locator(".model-quick-option").count(), 1, "Removing a favorite updates the quick list");
		await page.keyboard.press("Escape");
		await open();
		await search.press("Shift+Tab");
		assert.equal(await page.getByRole("button", { name: "关闭模型选择" }).evaluate((element) => element === document.activeElement), true);
		await page.keyboard.press("Shift+Tab");
		assert.equal(await catalog.getByRole("button", { name: "管理提供商", exact: true }).evaluate((element) => element === document.activeElement), true, "Tab stays inside the catalog");
		await page.keyboard.press("Enter");
		const settings = page.getByRole("dialog", { name: "设置", exact: true });
		await settings.getByRole("heading", { name: "供应商", exact: true }).waitFor();
		assert.equal(await catalog.count(), 0);
		await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
		const collapseSidebar = page.getByRole("button", { name: "收起侧栏", exact: true });
		if (await collapseSidebar.count()) await collapseSidebar.click();
		for (const [width, height] of [[1200, 900], [900, 700], [600, 400]]) {
			await page.setViewportSize({ width, height });
			if (await page.getByRole("dialog", { name: "项目与聊天导航", exact: true }).count()) await page.keyboard.press("Escape");
			await trigger.click();
			await assertFits(".model-popover");
			await page.screenshot({ path: `dist/model-picker/quick-${theme}-${width}.png` });
			await page.getByRole("button", { name: "更多模型…", exact: true }).click();
			await assertFits(".model-catalog-dialog");
			await page.screenshot({ path: `dist/model-picker/catalog-${theme}-${width}.png` });
			await page.keyboard.press("Escape");
		}
		await page.setViewportSize({ width: 1200, height: 900 });
	}
	assert.deepEqual(errors, []);
	console.log("Model picker passed: search, provider filters, exact-route favorites, persistence, reasoning, IME, keyboard selection, focus restoration; both themes at 1200, 900 and 600px.");
} finally {
	await browser.close();
}
