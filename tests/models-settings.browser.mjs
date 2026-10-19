// Run on the preview port: node tests/models-settings.browser.mjs http://localhost:1423
// Uses the local mock bridge only: no real keys, no paid model calls.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1423";
const output = new URL("../features/027-model-family-settings/screenshots/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
const open = async (theme = "light", { reset = false, persist = false } = {}) => {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}${persist ? "&persist=1" : ""}`);
	if (reset) await page.evaluate(() => localStorage.removeItem("skiff.family-models.v1"));
	await page.reload();
	await page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
	await page.keyboard.press("Control+Comma");
	await dialog().waitFor();
	await button("模型").click();
};
const close = async () => { await button("关闭设置").click(); await dialog().waitFor({ state: "detached" }); };

try {
	// 1. Seeded family view: tabs for the families, and the selected family card
	// lists its two default models plus an Auto card below.
	await open(undefined, { reset: true });
	await shot("models-light");
	const tabs = await dialog().locator(".family-model-tab").allTextContents();
	for (const family of ["DeepSeek", "Kimi", "GLM"]) assert.ok(tabs.some((tab) => tab.includes(family)), `Family tab ${family} must exist`);
	assert.equal(await dialog().locator(".switch").count(), 0, "Models entry must not expose route toggles");
	const deepseekCard = dialog().locator(".family-card", { hasText: "DeepSeek" }).first();
	assert.deepEqual(await deepseekCard.locator(".provider-row-title strong").allTextContents(), ["deepseek-v4-pro", "deepseek-flash"], "Seeded defaults must list the flagship and the flash variant");

	// 2. Route availability counters come from enabled routes on enabled relays.
	const counts = await deepseekCard.locator(".model-family-meta").allTextContents();
	assert.ok(counts.every((text) => /路线可用|未接路线/.test(text)), `Every model row must report route availability, saw ${JSON.stringify(counts)}`);
	assert.ok(counts.some((text) => text.includes("未接路线")), `Unwired models cross-link to the routes page, saw ${JSON.stringify(counts)}`);
	assert.ok(counts.some((text) => text.includes("1 条路线可用")), `deepseek-flash is wired on one route, saw ${JSON.stringify(counts)}`);

	// 3. Per-model tests: every row carries one, the unwired model is disabled,
	// and name/result/action share the same tracks so rows line up top to bottom.
	const rows = deepseekCard.locator(".model-family-row");
	assert.equal(await rows.count(), 2, "Both DeepSeek models render as testable rows");
	assert.equal(await rows.getByRole("button", { name: "测试", exact: true }).count(), 2, "Every model row has a test action");
	assert.equal(await rows.filter({ hasText: "deepseek-v4-pro" }).getByRole("button", { name: "测试", exact: true }).isDisabled(), true, "An unwired model cannot be tested yet");
	const wiredRow = rows.filter({ hasText: "deepseek-flash" });
	await wiredRow.getByRole("button", { name: "测试", exact: true }).click();
	await wiredRow.locator(".test-result.ok").waitFor();
	assert.match(await wiredRow.locator(".test-result").textContent(), /官方直连 · 成功 · 137 ms/);
	const geometry = await rows.evaluateAll((items) => items.map((row) => {
		const box = row.getBoundingClientRect();
		const action = row.querySelector(".provider-row-actions")?.getBoundingClientRect();
		return { top: Math.round(box.top), height: Math.round(box.height), actionLeft: Math.round(action?.left ?? -1) };
	}));
	assert.equal(new Set(geometry.map((item) => item.actionLeft)).size, 1, `All test actions must share one column, saw ${JSON.stringify(geometry)}`);
	assert.equal(new Set(geometry.map((item) => item.height)).size, 1, `All model rows must keep one height, saw ${JSON.stringify(geometry)}`);
	assert.equal(geometry[0].top < geometry[1].top, true, "Rows stack top to bottom");
	await shot("models-tested");

	// 4. Auto card: one fixed row, no test action of its own.
	const autoCard = dialog().locator(".family-card", { hasText: "Auto" }).first();
	assert.equal(await autoCard.locator(".provider-row").count(), 1, "Auto shows a single row");
	assert.ok((await autoCard.locator(".provider-row-title").textContent()).includes("自动选择"), "Auto row explains itself");
	assert.equal(await autoCard.getByRole("button", { name: "测试", exact: true }).count(), 0, "Auto is not a concrete model, so it gets no test");

	// 5. Dark theme rendering.
	await shot("models-list");
	await button("外观").click();
	await button("深色").click();
	await button("模型").click();
	await shot("models-dark");

	// 6. Editing: rename an entry as manual, add a manual model, delete an auto one.
	await button("编辑家族模型").click();
	await dialog().getByText("每个家族最多保留两个自动更新的模型").waitFor();
	const deepseekSection = dialog().locator(".family-card", { hasText: "DeepSeek" }).first();
	await shot("models-edit");
	// Every edit row also offers its own test.
	assert.equal(await deepseekSection.locator(".model-family-row").getByRole("button", { name: "测试", exact: true }).count(), 2, "Edit rows keep the per-model test");
	// Add a manual model; it lands first with the manual tag.
	await deepseekSection.getByRole("button", { name: "添加模型" }).click();
	await deepseekSection.getByLabel("DeepSeek 新模型 ID").fill("deepseek-mine");
	await deepseekSection.getByRole("button", { name: "添加", exact: true }).click();
	let modelIds = await deepseekSection.locator(".provider-row-title strong").allTextContents();
	assert.deepEqual(modelIds[0], "deepseek-mine", "Manual additions must be listed first");
	assert.ok((await deepseekSection.locator(".provider-row", { hasText: "deepseek-mine" }).locator(".provider-tag").textContent()).includes("手动"), "Manual entries are tagged");
	// Deleting an entry updates the draft list (the delete icon sits beside the test action).
	await deepseekSection.getByRole("button", { name: "删除 deepseek-v4-pro", exact: true }).click();
	modelIds = await deepseekSection.locator(".provider-row-title strong").allTextContents();
	assert.ok(!modelIds.includes("deepseek-v4-pro"), "Deleted entries leave the list");
	await shot("models-edited");

	// 7. Persistence: the edit survives a page reload (localStorage-backed config).
	await close();
	await open(undefined, { persist: true });
	const persisted = dialog().locator(".family-card", { hasText: "DeepSeek" }).first();
	const persistedIds = await persisted.locator(".provider-row-title strong").allTextContents();
	assert.deepEqual(persistedIds, ["deepseek-mine", "deepseek-flash"], `Manual edits must survive reload, saw ${JSON.stringify(persistedIds)}`);
	assert.ok((await persisted.locator(".provider-row", { hasText: "deepseek-mine" }).locator(".provider-tag").textContent()).includes("手动"), "Manual tag persists");

	// 8. Online refresh replaces auto entries but keeps the manual one (mock pages agree with the seed).
	await persisted.getByRole("button", { name: "联网更新" }).click();
	await dialog().getByText("目录显示没有更新的模型。").waitFor();
	await shot("models-refreshed");

	// 9. Empty fixture: no routes anywhere, rows cross-link to the routes page and tests stay disabled.
	await close();
	await page.evaluate(() => localStorage.removeItem("skiff.family-models.v1"));
	await page.goto(`${origin}/tests/preview.html?fixture=empty&theme=light`);
	await page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
	await page.keyboard.press("Control+Comma");
	await button("模型").click();
	const links = await dialog().getByRole("button", { name: "未接路线，去配置" }).count();
	assert.equal(links, 3, "The overlaid DeepSeek model rows and Auto cross-link without routes");
	assert.equal(await dialog().locator(".model-family-row").getByRole("button", { name: "测试", exact: true }).count(), 2);
	assert.equal(await dialog().locator(".model-family-row").getByRole("button", { name: "测试", exact: true }).first().isDisabled(), true);
	await dialog().getByRole("button", { name: "未接路线，去配置" }).first().click();
	await dialog().getByText(/还没有供应商|还没添加路线/).first().waitFor();
	await shot("models-empty-routes");

	await close();
	assert.deepEqual(errors, []);
	console.log("PASS family tabs with route counters, per-model tests and aligned rows, Auto card, manual add/delete with persistence, refresh notice, empty-state cross-link, dark theme");
} catch (error) {
	await shot("failure");
	console.error(errors);
	throw error;
} finally { await browser.close(); }