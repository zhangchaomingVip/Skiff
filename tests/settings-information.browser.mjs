// Mock bridge only. No real model service or credentials are used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1421";
const output = new URL(process.env.SKIFF_SETTINGS_SCREENSHOTS ?? "../features/028-settings-information-redesign/screenshots/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`information-${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
const config = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_model_families"));
const row = (id) => dialog().locator(`[data-route-id='${id}']`);
const menu = async (id) => { await row(id).getByRole("button", { name: /^更多/ }).click(); return dialog().getByRole("menu"); };
const layout = async () => {
	assert.equal(await dialog().evaluate((node) => node.scrollWidth > node.clientWidth), false);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	assert.equal(await dialog().locator(".settings-content").evaluate((node) => node.scrollWidth > node.clientWidth), false, "Overflow must stay inside the mapping table");
};
const deferred = async () => page.evaluate(() => window.skiffPreview.deferTests(true));
const resolveTests = async (ok = true) => page.evaluate((ok) => {
	for (const pending of window.skiffPreview.pendingTests.splice(0)) pending.resolve({ ok, latencyMs: ok ? 77 : 42, status: ok ? 200 : 401, error: ok ? null : "模拟失败" });
}, ok);

try {
	await page.goto(`${origin}/tests/preview.html?fixture=settings-info&theme=light`);
	await page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
	await page.keyboard.press("Control+Comma");
	await button("供应商").click();
	const original = await config();
	assert.deepEqual(await dialog().locator(".provider-row-title .provider-tag").allTextContents(), ["官方直连", "中转", "官方直连", "本机", "自定义"]);
	assert.equal(await dialog().locator(".provider-key").count(), 0);
	await button("停用 2").click();
	assert.equal(await dialog().locator(".provider-relay-row").count(), 2);
	const search = dialog().getByRole("textbox", { name: "搜索已配置供应商" });
	await search.fill("LOCALHOST");
	assert.equal(await button("全部 1").count(), 1);
	assert.equal(await button("启用 0").count(), 1);
	await search.fill("sk-mock");
	assert.equal(await dialog().locator(".provider-relay-row").count(), 0);
	await search.fill("");
	await dialog().getByRole("checkbox", { name: "启用 自定义端点", exact: true }).locator("..").click();
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "搜索已配置供应商");
	assert.equal(await button("停用 1").count(), 1);
	await button("全部 5").click();
	await shot("providers-light");
	await button("编辑 硅基低价").click();
	assert.equal(await page.locator("#relay-protocol option").count(), 6);
	assert.equal(await page.locator(".settings-advanced").getAttribute("open"), null);
	assert.match(await page.locator(".settings-advanced summary").textContent(), /超时 123 秒/);
	assert.equal(await button("查看DeepSeek路线").count(), 0, "Drafts never expose a cross-page jump");
	await page.locator(".settings-advanced summary").click();
	await page.locator("#relay-timeout").fill("1");
	await page.locator(".settings-advanced summary").click();
	await button("保存").click();
	await page.waitForFunction(() => document.activeElement?.id === "relay-timeout");
	assert.notEqual(await page.locator(".settings-advanced").getAttribute("open"), null);
	await page.locator("#relay-timeout").fill("123");
	await page.getByLabel("模型 1 显示名", { exact: true }).fill("新的显示名");
	await button("保存").click();
	await page.locator("#relay-name").waitFor({ state: "detached" });
	const saved = await config();
	for (const family of original.families) {
		const after = saved.families.find((item) => item.id === family.id);
		assert.deepEqual(after.routes.map((item) => item.id), family.routes.map((item) => item.id));
		assert.equal(after.defaultRouteId, family.defaultRouteId);
		for (const route of family.routes) {
			const result = after.routes.find((item) => item.id === route.id);
			assert.deepEqual({ ...result, models: [] }, { ...route, models: [] });
			assert.deepEqual(result.models.map(({ alias, ...model }) => model), route.models.map(({ alias, ...model }) => model));
		}
	}
	await button("查看DeepSeek路线").click();
	assert.equal(await page.locator("#route-relay").inputValue(), "r2");
	assert.equal(await button("供应商").isDisabled(), true);
	await page.keyboard.press("Escape");
	assert.equal(await row("route-deepseek-r1").count(), 1);
	assert.equal(await row("route-kimi-r3").count(), 0, "Destination keeps the family filter");
	const beforeFilters = await config();
	await page.getByRole("textbox", { name: "搜索路线" }).fill("manual-history");
	assert.equal(await dialog().locator(".settings-route-entry").count(), 1);
	let actions = await menu("route-deepseek-r2");
	assert.equal(await actions.getByRole("menuitem", { name: "上移 硅基低价 的路线" }).isDisabled(), true);
	await page.keyboard.press("Escape");
	assert.equal(await row("route-deepseek-r2").getByRole("button", { name: /^更多/ }).evaluate((node) => node === document.activeElement), true);
	assert.equal(await dialog().count(), 1);
	await page.getByRole("textbox", { name: "搜索路线" }).fill("");
	await dialog().getByRole("checkbox", { name: "仅看可用", exact: true }).check();
	assert.equal(await dialog().locator(".settings-route-entry").count(), 3, "Custom provider was enabled above");
	await dialog().getByRole("checkbox", { name: "仅看可用", exact: true }).uncheck();
	assert.deepEqual(await config(), beforeFilters, "Search and expansion never write config");
	const route2 = row("route-deepseek-r2");
	assert.deepEqual(await route2.locator(".route-model-summary code").allTextContents(), ["excluded/deepseek-flash", "first/deepseek-v4.1-flash"]);
	await route2.getByRole("button", { name: "查看全部 4 个模型", exact: true }).click();
	assert.equal(await route2.locator(".route-model-prices > div").count(), 4);
	assert.match(await route2.locator(".route-model-prices").textContent(), /输入 0 \/ 输出 0 CNY \/ 百万 token/);
	assert.match(await route2.locator(".route-model-prices").textContent(), /输入 1 \/ 输出 2 USD \/ 百万 token/);
	await shot("routes-light");
	actions = await menu("route-deepseek-r1");
	assert.equal(await actions.getByRole("menuitem", { name: "删除 官方直连 的路线" }).isDisabled(), true);
	await page.keyboard.press("End");
	assert.match(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), /下移/);
	await page.keyboard.press("Escape");
	actions = await menu("route-deepseek-r2");
	await actions.getByRole("menuitem", { name: "上移 硅基低价 的路线" }).click();
	assert.equal(await button("模型").isDisabled(), true);
	await button("保存顺序").click();
	await page.waitForFunction(() => window.skiffPreview.commands.some((item) => item.command === "reorder_routes"));
	assert.deepEqual((await config()).families[0].routes.map((item) => item.id), ["route-deepseek-r2", "route-deepseek-r1", "route-deepseek-custom"]);
	await button("模型").click();
	const modelRow = dialog().locator(".model-family-row", { hasText: "deepseek-flash" });
	assert.match(await modelRow.textContent(), /未指定路线时优先：硅基低价/);
	assert.match(await modelRow.textContent(), /2 条路线可用/);
	await button("查看 DeepSeek 的实际线路映射").click();
	const mapping = dialog().locator(".model-mapping-table tbody tr", { hasText: "官方直连" });
	assert.match(await mapping.textContent(), /默认/);
	assert.equal(await mapping.getByText("优先", { exact: true }).count(), 0, "Unsupported family default cannot be marked preferred");
	const autoCard = dialog().locator(".family-card", { hasText: "Auto" }).last();
	assert.match(await autoCard.textContent(), /未接路线/);
	assert.equal(await autoCard.getByRole("button", { name: "测试", exact: true }).count(), 0);
	await modelRow.getByRole("button", { name: "测试", exact: true }).click();
	await modelRow.locator(".test-result.ok").waitFor();
	const request = await page.evaluate(() => window.skiffPreview.testRequests.at(-1));
	assert.equal(request.modelId, "first/deepseek-v4.1-flash");
	assert.equal(request.protocol, "anthropic");
	assert.equal(request.baseUrl, "https://api.siliconflow.cn/v1");
	assert.equal(request.timeoutSeconds, 123);
	assert.match(await modelRow.locator(".test-result").textContent(), /first\/deepseek-v4.1-flash/);
	await shot("models-mapping-light");
	await deferred();
	await modelRow.getByRole("button", { name: "测试", exact: true }).click();
	await modelRow.getByRole("button", { name: "停止", exact: true }).click();
	await resolveTests();
	assert.equal(await modelRow.locator(".test-result.ok").count(), 0, "Cancelled results cannot return");
	await modelRow.getByRole("button", { name: "测试", exact: true }).click();
	await resolveTests(false);
	await modelRow.locator(".test-result.bad").waitFor();
	assert.match(await modelRow.textContent(), /失败 · 42 ms · HTTP 401/);
	await modelRow.getByRole("button", { name: "测试", exact: true }).click();
	await button("编辑家族模型").click();
	const editCard = dialog().locator(".family-card").first();
	await editCard.getByRole("button", { name: "添加模型", exact: true }).click();
	await dialog().getByRole("textbox", { name: "DeepSeek 新模型 ID" }).fill("manual-history");
	await editCard.getByRole("button", { name: "添加", exact: true }).click();
	await resolveTests();
	await page.keyboard.press("Escape");
	assert.equal(await dialog().locator(".model-family-row").count(), 3, "Manual models are not truncated to two");
	assert.equal(await modelRow.locator(".test-result.ok").count(), 0, "A changed model config invalidates in-flight results");
	await modelRow.getByRole("button", { name: "测试", exact: true }).click();
	await button("路线").click();
	await resolveTests();
	await button("模型").click();
	assert.equal(await modelRow.locator(".test-result.ok").count(), 0, "Unmounted page cannot receive late results");
	assert.ok(await page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "cancel_provider_test").length >= 3));
	await button("路线").click();
	assert.equal(await row("route-kimi-local").getByRole("checkbox").isChecked(), true, "Provider blockers do not change the route's own switch");
	assert.match(await row("route-kimi-local").textContent(), /供应商已停用/);
	assert.equal(await row("route-auto-r2").getByRole("checkbox").isChecked(), true);
	assert.match(await row("route-auto-r2").textContent(), /所有模型已剔除/);
	await button("清空 DeepSeek 默认路线").click();
	await page.keyboard.press("Escape");
	assert.equal((await config()).families[0].defaultRouteId, "route-deepseek-r1");
	await button("清空 DeepSeek 默认路线").click();
	await page.getByRole("dialog", { name: "清空默认路线", exact: true }).getByRole("button", { name: "确认删除" }).click();
	await page.waitForFunction(() => window.skiffPreview.commands.some((item) => item.command === "set_default_route" && item.args.relayId === null));
	assert.equal((await config()).families[0].defaultRouteId, null);
	actions = await menu("route-deepseek-r2");
	await actions.getByRole("menuitem", { name: "将 硅基低价 的路线设为默认" }).click();
	await page.waitForFunction(() => document.querySelector('[data-route-id="route-deepseek-r2"]')?.textContent.includes("默认"));
	assert.equal((await config()).families[0].defaultRouteId, "route-deepseek-r2");
	await page.getByRole("textbox", { name: "搜索路线" }).fill("no-results");
	await dialog().getByRole("checkbox", { name: /失败时自动切换/ }).check();
	assert.equal((await config()).autoFailover, true, "Failover is global even when filters show no routes");
	await page.getByRole("textbox", { name: "搜索路线" }).fill("");
	actions = await menu("route-deepseek-custom");
	await actions.getByRole("menuitem", { name: "删除 自定义端点 的路线" }).click();
	await page.keyboard.press("Escape");
	assert.equal(await row("route-deepseek-custom").getByRole("button", { name: /^更多/ }).evaluate((node) => node === document.activeElement), true);
	actions = await menu("route-deepseek-custom");
	await actions.getByRole("menuitem", { name: "删除 自定义端点 的路线" }).click();
	await page.getByRole("dialog", { name: "删除路线", exact: true }).getByRole("button", { name: "确认删除" }).click();
	await row("route-deepseek-custom").waitFor({ state: "detached" });
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "搜索路线");
	await button("供应商").click();
	await button("编辑 本机服务").click();
	assert.equal(await page.locator("#relay-key").inputValue(), "");
	assert.equal(await button("测试连接").isEnabled(), true, "Known local services can test without a key");
	await page.evaluate(() => window.skiffPreview.deferTests(false));
	await button("测试连接").click();
	await dialog().getByText(/连接成功/).waitFor();
	await page.keyboard.press("Escape");
	const localProvider = dialog().locator(".provider-relay-row").filter({ hasText: "本机服务" });
	const rowTest = localProvider.getByRole("button", { name: "测试连接 本机服务", exact: true });
	assert.equal(await rowTest.isEnabled(), true, "An unconfigured key-optional provider can discover a model before testing");
	await rowTest.click();
	await page.waitForFunction(() => window.skiffPreview.metadata.tests.some((record) => record.relayId === "local"));
	assert.equal(await page.evaluate(() => window.skiffPreview.testRequests.at(-1).modelId), "deepseek-chat");
	await localProvider.getByText(/最近测试 137 ms/).waitFor();

	for (const [width, height] of [[1100, 750], [600, 400], [550, 375]]) {
		await page.setViewportSize({ width, height });
		for (const theme of ["light", "dark"]) {
			await button("外观").click(); await button(theme === "light" ? "浅色" : "深色").click();
			for (const category of ["供应商", "模型", "路线"]) {
				await button(category).click();
				if (category === "模型") {
					await button("查看 DeepSeek 的实际线路映射").click();
					await dialog().locator(".model-mapping-table-wrap").scrollIntoViewIfNeeded();
				}
				if (category === "路线") {
					await row("route-deepseek-r2").getByRole("button", { name: /^更多/ }).scrollIntoViewIfNeeded();
					await menu("route-deepseek-r2");
					const rect = await dialog().getByRole("menu").boundingBox();
					assert.ok(rect.y >= 0 && rect.y + rect.height <= height);
					await shot(`menu-${theme}-${width}`);
					await page.keyboard.press("End");
					assert.equal(await page.evaluate(() => {
						const item = document.activeElement.getBoundingClientRect();
						const menu = document.activeElement.closest("[role=menu]").getBoundingClientRect();
						return item.top >= menu.top && item.bottom <= menu.bottom;
					}), true, "Keyboard navigation scrolls the menu item into view");
					await page.keyboard.press("Escape");
				}
				await layout(); await shot(`${({ "供应商": "providers", "模型": "models", "路线": "routes" })[category]}-${theme}-${width}`);
			}
			await button("供应商").click(); await button("编辑 硅基低价").click();
			await button("保存").scrollIntoViewIfNeeded();
			const rect = await button("保存").boundingBox();
			assert.ok(rect.y >= 0 && rect.y + rect.height <= height);
			await layout(); await shot(`editor-${theme}-${width}`);
			await page.keyboard.press("Escape");
		}
	}
	assert.deepEqual(errors, []);
	console.log("PASS settings information: filters/counts, source tags, advanced validation, config fidelity, exact navigation, route prices/menu/order, alias/protocol tests, cancellation/late results, themes and narrow layouts");
} catch (error) { await shot("failure"); console.error(errors); throw error; }
finally { await browser.close(); }
