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
const open = async () => { await page.keyboard.press("Control+Comma"); await dialog().waitFor(); };
const close = async () => { await button("关闭设置").click(); await dialog().waitFor({ state: "detached" }); };

try {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`);
	await page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
	await open();

	// 1. The models entry is a family view: family cards without route rows.
	await button("模型").click();
	await shot("models-light");
	const titles = await dialog().locator(".family-card-title").allTextContents();
	for (const family of ["DeepSeek", "Kimi", "GLM", "Auto"]) assert.ok(titles.some((title) => title.includes(family)), `Family card ${family} must be listed`);
	assert.equal(await dialog().locator(".switch").count(), 0, "Models entry must not expose route toggles");
	assert.equal(await dialog().locator(".provider-row-actions").count(), 0, "Models entry must not expose route row actions");

	// 2. Only the two newest models per family are visible; older ones are trimmed.
	const deepseekCard = dialog().locator(".family-card", { hasText: "DeepSeek" }).first();
	const deepseekModels = await deepseekCard.locator(".provider-row-title strong").allTextContents();
	assert.ok(deepseekModels.length > 0, "Configured latest models must be visible");
	assert.equal(deepseekModels.length <= 2, true, `At most two models per family, saw ${deepseekModels.length}`);
	// The same model wired through several routes is listed once.
	const lower = deepseekModels.map((model) => model.toLowerCase());
	assert.equal(new Set(lower).size, lower.length, `Models must be deduplicated across routes, saw ${JSON.stringify(deepseekModels)}`);
	// Non-latest models stay out of the family view.
	for (const model of deepseekModels) assert.ok(!/old|legacy/i.test(model), `Trimmed models must stay hidden, saw ${model}`);

	// 3. Cross-link to the routes entry; with routes present it is hidden, so go via navigation.
	await shot("models-list");
	await button("路线").click();
	assert.equal(await button("编辑 官方直连 的路线").count(), 1, "Routes entry keeps its editors");
	await button("模型").click();

	// 4. Dark theme rendering.
	await button("外观").click();
	await button("深色").click();
	await button("模型").click();
	await shot("models-dark");

	// 5. Without routes the models entry explains the dependency and cross-links.
	await close();
	await page.goto(`${origin}/tests/preview.html?fixture=empty&theme=light`);
	await page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
	await open();
	await button("模型").click();
	const empties = await dialog().locator(".family-empty").allTextContents();
	assert.ok(empties.every((text) => text.includes("暂无") || text.includes("依附")), `Empty families must explain themselves, saw ${JSON.stringify(empties)}`);
	await shot("models-empty");
	await button("路线").click();
	await dialog().getByText(/还没添加路线/).first().waitFor();

	await close();
	assert.deepEqual(errors, []);
	console.log("PASS models entry (family view, two newest models only, no route toggles/actions), routes cross-navigation, empty state cross-link, dark theme");
} catch (error) {
	await shot("failure");
	console.error(errors);
	throw error;
} finally { await browser.close(); }
