// Isolated mock bridge. No credentials or real model requests.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/models-settings/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const family = () => dialog().getByRole("combobox", { name: "模型家族", exact: true });
const search = () => dialog().getByRole("textbox", { name: "搜索模型名称或提供商", exact: true });
const card = (id) => dialog().getByRole("article", { name: `DeepSeek ${id}`, exact: true });
const row = () => card("deepseek-flash").locator(".model-provider-row");
const testButton = () => row().getByRole("button", { name: "测试连接 官方直连 deepseek-flash", exact: true });
const commands = (command) => page.evaluate((command) => window.skiffPreview.commands.filter((entry) => entry.command === command), command);
const screenshot = (name) => page.screenshot({ animations: "disabled", path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
const layout = async () => {
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	for (const selector of [".settings-content", ".models-toolbar", ".model-card-list"]) assert.equal(await dialog().locator(selector).evaluate((node) => node.scrollWidth > node.clientWidth), false, `${selector} must fit`);
	assert.equal(await dialog().locator(".models-toolbar").evaluate((toolbar) => {
		const boxes = [...toolbar.querySelectorAll("input, select, .settings-toolbar-extras button")].map((node) => node.getBoundingClientRect());
		return boxes.every((box, index) => boxes.slice(index + 1).every((other) => box.right <= other.left || box.left >= other.right || box.bottom <= other.top || box.top >= other.bottom));
	}), true, "Toolbar controls must never overlap");
	assert.equal(await dialog().locator(".model-settings-card .model-settings-card").count(), 0);
};

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1100, height: 750 });
		await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}&color=blue`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.keyboard.press("Control+Comma");
		// Capture the provider controls as the visual contract.
		await button("供应商").click();
		const controlStyle = (node) => {
			const style = getComputedStyle(node);
			return { height: style.height, border: style.border, radius: style.borderRadius, outline: style.outlineStyle, shadow: style.boxShadow };
		};
		const providerSelect = dialog().getByRole("combobox", { name: "供应商来源" });
		const providerResting = await providerSelect.evaluate(controlStyle);
		await providerSelect.focus();
		const providerFocus = await providerSelect.evaluate(controlStyle);
		await button("模型").click();
		assert.equal(await dialog().getByRole("tablist").count(), 0, "Legacy tabs are removed");
		assert.equal(await family().inputValue(), "all");
		const options = await family().getByRole("option").allTextContents();
		for (const label of ["全部家族", "DeepSeek", "Kimi", "GLM", "Auto"]) assert.ok(options.some((option) => option.startsWith(`${label} (`)));
		const total = await dialog().locator(".model-settings-card").count();
		assert.equal(options[0], `全部家族 (${total})`);
		assert.deepEqual(await family().evaluate(controlStyle), providerResting);
		await family().focus();
		assert.deepEqual(await family().evaluate(controlStyle), providerFocus);
		assert.equal(await dialog().locator(".models-toolbar").evaluate((toolbar) => {
			const boxes = [...toolbar.querySelectorAll("input, select, .settings-toolbar-extras button")].map((node) => node.getBoundingClientRect());
			return boxes.every((box) => box.height === 32 && box.top === boxes[0].top);
		}), true, "Toolbar controls share the provider page's baseline and height");
		await layout();
		await screenshot(`${theme}-all`);

		await family().selectOption("deepseek");
		assert.equal(await dialog().locator(".model-settings-card h3").filter({ hasText: /^DeepSeek$/ }).count(), 0, "No repeated family heading");
		assert.ok((await dialog().locator(".model-settings-card h3").allTextContents()).includes("deepseek-v4-pro"));
		await search().fill("SILICONFLOW.CN");
		assert.equal(await dialog().locator(".model-provider-main strong").count(), 2);
		assert.ok((await dialog().locator(".model-provider-main strong").allTextContents()).every((name) => name === "硅基低价"));
		assert.equal(await family().getByRole("option", { name: "DeepSeek (2)", exact: true }).count(), 1);
		await search().fill("官方直连");
		assert.ok((await dialog().locator(".model-provider-main strong").allTextContents()).every((name) => name === "官方直连"));
		await search().fill("sk-mock");
		await dialog().getByText("没有匹配的模型，请调整搜索或家族筛选。", { exact: true }).waitFor();
		await button("清空模型搜索").click();
		assert.equal(await search().evaluate((node) => node === document.activeElement), true);
		assert.equal(await row().locator(".provider-row-test-status").textContent(), "待测试");
		assert.equal(await row().getByRole("button").count(), 2);
		assert.equal(await row().getByRole("button").evaluateAll((nodes) => nodes.every((node) => !node.textContent.trim() && !!node.getAttribute("aria-label"))), true);
		assert.equal(await row().locator("small").first().textContent(), "api.deepseek.com/v1");

		// Per-model test status, cancellation and stale-record handling.
		await testButton().click();
		await row().locator(".provider-row-test-status.is-success").getByText("137 ms", { exact: true }).waitFor();
		assert.equal(await page.evaluate(() => window.skiffPreview.testRequests.at(-1).modelId), "deepseek-flash");
		await button("供应商").click(); await button("模型").click(); await family().selectOption("deepseek");
		await row().locator(".provider-row-test-status.is-success").waitFor();
		await page.evaluate(() => { window.skiffPreview.metadata.tests.find((test) => test.modelId === "deepseek-flash").configVersion = "stale"; });
		await button("供应商").click(); await button("模型").click(); await family().selectOption("deepseek");
		await row().locator(".provider-row-test-status.is-warning").waitFor();
		await page.evaluate(() => window.skiffPreview.deferTests(true));
		await testButton().click();
		await row().locator(".provider-row-test-status.is-running").waitFor();
		await page.waitForFunction(() => window.skiffPreview.pendingTests.length > 0);
		await row().getByRole("button", { name: "取消测试 官方直连 deepseek-flash", exact: true }).click();
		await row().locator(".provider-row-test-status.is-warning").waitFor();
		await page.evaluate(() => window.skiffPreview.pendingTests.splice(0).forEach((pending) => pending.resolve({ ok: true, latencyMs: 1, status: 200 })));
		assert.equal(await row().locator(".provider-row-test-status").textContent(), "待测试", "Late replies cannot overwrite cancellation");
		await testButton().click();
		await page.waitForFunction(() => window.skiffPreview.pendingTests.length > 0);
		await page.evaluate(() => {
			window.skiffPreview.pendingTests.splice(0).forEach((pending) => pending.resolve({ ok: false, latencyMs: 10000, status: 504, error: "模型请求超时" }));
			window.skiffPreview.deferTests(false);
		});
		await row().locator(".provider-row-test-status.is-error").getByText("连接超时", { exact: true }).waitFor();
		await testButton().click();
		await row().locator(".provider-row-test-status.is-success").waitFor();
		assert.equal(await dialog().locator(".model-provider-row").evaluateAll((rows) => {
			const columns = rows.map((row) => row.querySelector(".provider-row-actions").getBoundingClientRect().left);
			return columns.every((left) => left === columns[0]);
		}), true, "Provider actions share one column across model cards");
		await screenshot(`${theme}-deepseek`);

		// Editing jumps to the exact provider/model. Disabled models use a grey status.
		await row().getByRole("button", { name: "编辑模型 官方直连 deepseek-flash", exact: true }).click();
		await page.locator("#relay-name").waitFor();
		assert.equal(await page.locator("#relay-name").inputValue(), "官方直连");
		await dialog().getByRole("checkbox", { name: "启用模型 deepseek-flash", exact: true }).uncheck();
		await button("保存").click();
		await page.locator("#relay-name").waitFor({ state: "detached" });
		await button("模型").click(); await family().selectOption("deepseek");
		await row().locator(".provider-row-test-status.is-disabled").getByText("停用", { exact: true }).waitFor();
		assert.equal(await testButton().isDisabled(), true);
		assert.equal(await row().getByRole("button", { name: "编辑模型 官方直连 deepseek-flash", exact: true }).isEnabled(), true);
		await button("供应商").click();
		await dialog().getByRole("checkbox", { name: "停用 硅基低价", exact: true }).locator("..").click();
		await page.waitForFunction(() => window.skiffPreview.relays.find((relay) => relay.id === "r2").enabled === false && !document.querySelector('[aria-label="关闭设置"]')?.disabled);
		await button("模型").click(); await family().selectOption("deepseek");
		await dialog().locator('.provider-row-test-status[title="供应商已停用"]').first().waitFor();

		// Manual display entries persist; all-family refresh fetches sources only once.
		await dialog().getByRole("textbox", { name: "展示模型 ID", exact: true }).fill("deepseek-personal");
		await button("添加").click();
		await card("deepseek-personal").waitFor();
		await card("deepseek-personal").getByRole("button", { name: "移出展示清单 deepseek-personal", exact: true }).click();
		assert.equal(await card("deepseek-personal").count(), 0);
		await dialog().getByRole("textbox", { name: "展示模型 ID", exact: true }).fill("deepseek-preserved"); await button("添加").click();
		await family().selectOption("auto");
		assert.equal(await button("刷新目录").isDisabled(), true);
		await family().selectOption("all");
		const fetches = (await commands("fetch_official_pages")).length;
		await button("刷新目录").click();
		await dialog().getByRole("status").filter({ hasText: /已刷新 \d+ 个家族的展示目录/ }).waitFor();
		assert.equal((await commands("fetch_official_pages")).length, fetches + 1);
		await card("deepseek-preserved").waitFor();
		await family().selectOption("kimi");
		const storedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.family-models.v1")));
		await button("刷新目录").click();
		await button("刷新目录").waitFor();
		const storedAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.family-models.v1")));
		assert.deepEqual(storedBefore.deepseek, storedAfter.deepseek);
		assert.deepEqual(storedBefore.glm, storedAfter.glm);
		await family().selectOption("all");
		for (const width of [900, 550, 390]) {
			await page.setViewportSize({ width, height: 750 });
			await layout();
			await screenshot(`${theme}-${width}`);
		}
		await page.setViewportSize({ width: 1100, height: 750 });
		await button("关闭设置").click();
		await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}&persist=1`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.keyboard.press("Control+Comma"); await button("模型").click();
		await card("deepseek-preserved").waitFor();
	}
	assert.deepEqual(errors, []);
	console.log("PASS models settings: family select/counts, model/provider search, shared controls, flat cards, statuses/test/cancel/edit, manual display persistence, scoped/shared refresh, light/dark/narrow layouts");
} catch (error) {
	await screenshot("failure");
	throw error;
} finally {
	await browser.close();
}
