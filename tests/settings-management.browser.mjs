// Isolated mock bridge: no credentials, paid requests or user configuration.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1421";
const output = new URL("../features/029-settings-management-tools/screenshots/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.setDefaultTimeout(10000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => settings().getByRole("button", { name, exact: true });
const bridge = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const config = () => bridge("list_model_families");
const metadata = () => bridge("list_settings_metadata");
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`management-${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
const ready = () => page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
const open = async () => { await ready(); await page.keyboard.press("Control+Comma"); await settings().waitFor(); };
const select = (name) => settings().getByRole("checkbox", { name: `选择 ${name}`, exact: true });
const confirm = (title) => page.getByRole("dialog", { name: title, exact: true });
const modelRow = () => settings().locator(".model-family-row", { hasText: "deepseek-flash" });
const layout = async () => {
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	assert.equal(await settings().locator(".settings-content").evaluate((node) => node.scrollWidth > node.clientWidth), false);
};

try {
	await page.goto(`${origin}/tests/preview.html?fixture=settings-info&theme=light&persist=1`); await open(); await button("供应商").click();
	const original = await config();
	await button("批量管理").focus(); await page.keyboard.press("Enter");
	const search = settings().getByRole("textbox", { name: "搜索已配置供应商" });
	await search.fill("官方"); await settings().getByRole("checkbox", { name: "全选当前结果" }).check();
	assert.equal(await settings().getByRole("checkbox", { name: /^选择 / }).count(), 2);
	await settings().getByRole("combobox", { name: "供应商显示排序" }).selectOption("name");
	assert.equal(await settings().getByRole("checkbox", { name: /^选择 / }).evaluateAll((nodes) => nodes.filter((node) => node.checked).length), 2);
	await settings().getByRole("checkbox", { name: "按来源分组" }).check();
	assert.match(await settings().locator(".settings-batch-bar").textContent(), /已选 0 个/);
	assert.equal(await settings().locator(".settings-source-heading").count(), 1, "No empty groups");
	await settings().getByRole("checkbox", { name: "按来源分组" }).uncheck(); await search.fill("");
	await settings().getByRole("checkbox", { name: "全选当前结果" }).check(); await button("停用 2").click();
	assert.match(await settings().locator(".settings-batch-bar").textContent(), /已选 0 个/);
	await button("全部 5").click(); await select("官方直连").check(); await select("自定义端点").check();
	await button("批量停用").click(); const disable = confirm("批量停用供应商");
	await disable.getByRole("button", { name: "确认操作" }).waitFor();
	assert.match(await disable.textContent(), /影响 2 条关联路线/); assert.match(await disable.textContent(), /DeepSeek/);
	await shot("batch-impact-light");
	await page.evaluate(() => window.skiffPreview.failNextBatch()); await disable.getByRole("button", { name: "确认操作" }).click();
	await disable.getByRole("alert").waitFor(); assert.match(await disable.textContent(), /整批未提交/);
	assert.deepEqual(await config(), original);
	assert.match(await settings().locator(".settings-batch-bar").textContent(), /已选 2 个/);
	await disable.getByRole("button", { name: "确认操作" }).click(); await disable.waitFor({ state: "detached" });
	const disabled = await config(); assert.deepEqual(disabled.families, original.families);
	assert.equal(disabled.relays.find((relay) => relay.id === "r1").enabled, false);
	assert.match(await settings().locator(".settings-batch-bar").textContent(), /已选 0 个/);
	await select("官方直连").check(); await select("自定义端点").check(); await button("批量删除").click();
	const blocked = confirm("批量删除供应商");
	assert.equal(await blocked.getByRole("button", { name: "确认操作" }).isDisabled(), true);
	assert.match(await blocked.textContent(), /整批禁止删除/);
	assert.equal(await blocked.getByRole("button", { name: "去 DeepSeek 调整默认路线" }).count(), 1);
	await shot("batch-default-blocked-light"); await page.keyboard.press("Escape");
	await button("批量启用").click(); const enable = confirm("批量启用供应商");
	await enable.getByRole("button", { name: "确认操作" }).waitFor();
	// Change the latest native-side config after the preview was produced.
	await page.evaluate(() => { window.skiffPreview.relays.find((relay) => relay.id === "custom").name = "自定义端点（已变更）"; });
	await enable.getByRole("button", { name: "确认操作" }).click(); await enable.getByRole("alert").waitFor();
	assert.match(await enable.textContent(), /配置已变化/); assert.equal((await config()).relays.find((relay) => relay.id === "r1").enabled, false);
	await enable.getByRole("button", { name: "确认操作" }).click(); await enable.waitFor({ state: "detached" });
	assert.equal((await config()).relays.find((relay) => relay.id === "r1").enabled, true);
	await button("退出批量管理").click(); await button("模型").click(); await button("供应商").click();
	assert.equal(await button("批量管理").count(), 1);
	assert.deepEqual((await config()).families, original.families, "Display and provider switches never reorder routes");

	await button("模型").click(); await modelRow().getByRole("button", { name: "测试", exact: true }).click();
	await modelRow().locator(".test-result.ok").waitFor();
	let history = await metadata(); assert.equal(history.tests.length, 1); assert.equal(history.tests[0].modelId, "first/deepseek-v4.1-flash");
	assert.equal(history.usage.length, 0, "Tests never count as chat use");
	await page.evaluate(() => window.skiffPreview.deferTests(true));
	await modelRow().getByRole("button", { name: "测试", exact: true }).click(); await modelRow().getByRole("button", { name: "停止", exact: true }).click();
	await page.evaluate(() => { window.skiffPreview.pendingTests.splice(0).forEach((pending) => pending.resolve({ ok: false, latencyMs: 1, status: 500, error: "ignored" })); });
	assert.deepEqual((await metadata()).tests, history.tests);
	await page.reload(); await open(); await button("供应商").click();
	const testedRow = settings().getByRole("button", { name: "编辑 硅基低价" });
	await testedRow.getByText(/最近测试 \d+ ms/).waitFor();
	assert.match(await testedRow.locator(".provider-row-meta").getAttribute("title") ?? "", /最近测试：成功.*first\/deepseek-v4.1-flash/);
	const untestedRow = settings().getByRole("button", { name: "编辑 官方直连" });
	assert.doesNotMatch(await untestedRow.textContent(), /最近测试/, "Untested relays show no inline test hint");
	assert.equal(await untestedRow.locator(".provider-row-meta").getAttribute("title"), "未测试");
	await shot("history-reloaded-light");
	await button("路线").click();
	assert.match(await settings().locator('[data-route-id="route-deepseek-r2"]').textContent(), /最近测试：成功/);
	assert.match(await settings().locator('[data-route-id="route-auto-r2"]').textContent(), /未测试/, "A record cannot spread to another model of the same relay");
	await button("供应商").click(); await button("编辑 硅基低价").click();
	await settings().getByRole("button", { name: "测试", exact: true }).first().click();
	await settings().locator(".provider-model-test .test-result").first().waitFor();
	assert.deepEqual((await metadata()).tests, history.tests, "Unsaved draft does not replace history");
	await page.keyboard.press("Escape"); assert.deepEqual((await metadata()).tests, history.tests);
	await button("编辑 硅基低价").click();
	await settings().getByRole("button", { name: "测试", exact: true }).first().click();
	await settings().locator(".provider-model-test .test-result").first().waitFor(); await button("保存").click();
	await page.locator("#relay-name").waitFor({ state: "detached" });
	assert.ok((await metadata()).tests[0].completedAt >= history.tests[0].completedAt);
	await button("编辑 硅基低价").click(); await settings().locator(".settings-advanced summary").click();
	await page.locator("#relay-timeout").fill("124"); await button("保存").click(); await page.locator("#relay-name").waitFor({ state: "detached" });
	assert.match(await settings().getByRole("button", { name: "编辑 硅基低价" }).locator(".provider-row-meta").getAttribute("title") ?? "", /配置已变化/);
	assert.equal(await page.evaluate(() => (localStorage.getItem("skiff.test.metadata.v1") ?? "").includes("sk-mock")), false);

	await button("路线").click(); const searchRoutes = settings().getByRole("textbox", { name: "搜索路线" });
	await searchRoutes.fill("no-match"); await settings().getByRole("checkbox", { name: "仅看可用", exact: true }).check();
	const beforeOrder = await config();
	const family = settings().locator(".family-card", { has: page.locator(".family-card-title", { hasText: "DeepSeek" }) });
	await family.getByRole("button", { name: "调整切换顺序", exact: true }).click();
	assert.equal(await settings().locator("[data-order-id]").count(), beforeOrder.families[0].routes.length);
	assert.equal(await button("供应商").isDisabled(), true);
	await settings().getByRole("button", { name: "上移 硅基低价", exact: true }).click();
	assert.deepEqual(await config(), beforeOrder, "Keyboard reordering only changes the draft");
	await page.keyboard.press("Escape"); assert.equal(await searchRoutes.inputValue(), "no-match");
	assert.equal(await settings().getByRole("checkbox", { name: "仅看可用", exact: true }).isChecked(), true);
	await family.getByRole("button", { name: "调整切换顺序", exact: true }).click();
	await settings().locator('[data-order-id="route-deepseek-custom"]').dragTo(settings().locator('[data-order-id="route-deepseek-r1"]'));
	const draftOrder = await settings().locator("[data-order-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.orderId));
	assert.equal(draftOrder[0], "route-deepseek-custom");
	await shot("route-order-light"); await page.evaluate(() => window.skiffPreview.failNextOrder()); await button("保存顺序").click();
	await settings().getByRole("alert").waitFor();
	assert.deepEqual(await settings().locator("[data-order-id]").evaluateAll((nodes) => nodes.map((node) => node.dataset.orderId)), draftOrder, "Save failure retains order draft");
	assert.deepEqual((await config()).families[0].routes, beforeOrder.families[0].routes);
	await button("保存顺序").click();
	assert.deepEqual((await config()).families[0].routes.map((route) => route.id), draftOrder);
	assert.equal((await config()).families[0].defaultRouteId, beforeOrder.families[0].defaultRouteId);
	await family.getByRole("button", { name: "调整切换顺序", exact: true }).click();
	await page.evaluate(() => { window.skiffPreview.families[0].routes.pop(); });
	await button("保存顺序").click(); await settings().getByText("路线集合已变化，旧顺序不能保存，请重新加载后调整。").waitFor();
	assert.equal(await button("保存顺序").isDisabled(), true); await button("重新加载顺序").click();
	assert.equal(await settings().locator("[data-order-id]").count(), (await config()).families[0].routes.length);
	await button("取消排序").click(); await searchRoutes.fill(""); await settings().getByRole("checkbox", { name: "仅看可用", exact: true }).uncheck();

	await button("供应商").click(); await button("批量管理").click();
	await select("本机服务").check(); await select("自定义端点").check(); await button("批量删除").click();
	let deletion = confirm("批量删除供应商"); assert.match(await deletion.textContent(), /影响 2 条关联路线/);
	await page.keyboard.press("Escape"); assert.equal((await config()).relays.length, 5);
	await button("批量删除").click(); deletion = confirm("批量删除供应商"); await deletion.getByRole("button", { name: "确认操作" }).click(); await deletion.waitFor({ state: "detached" });
	assert.equal((await config()).relays.length, 3); assert.equal((await config()).families[0].defaultRouteId, "route-deepseek-r1");
	await button("退出批量管理").click();
	assert.equal((await metadata()).tests.length, 0, "Removing the final route model cleans history");
	// A completed chat response counts exactly once; opening settings and history do not.
	await settings().getByRole("combobox", { name: "供应商显示排序" }).selectOption("recent");
	await page.evaluate(async () => {
		const instanceId = [...window.skiffPreview.processes.keys()][0];
		await window.__TAURI_INTERNALS__.invoke("rpc_send", { instanceId, message: JSON.stringify({ type: "set_model", provider: "skiff-relay-r3-kimi", modelId: "kimi-k2", id: "use-model" }) });
		await window.__TAURI_INTERNALS__.invoke("rpc_send", { instanceId, message: JSON.stringify({ type: "prompt", message: "local mock only", id: "use-prompt" }) });
	});
	await page.waitForFunction(() => window.skiffPreview.metadata.usage.length === 1);
	assert.equal((await metadata()).usage[0].relayId, "r3");
		await page.waitForFunction(() => document.querySelector(".provider-relay-btn")?.getAttribute("aria-label") === "编辑 官方");
	assert.equal((await metadata()).usage.length, 1);
	await shot("recent-use-light");
	for (const theme of ["light", "dark"]) {
		await button("外观").click(); await button(theme === "light" ? "浅色" : "深色").click(); await button("供应商").click();
		await settings().getByRole("checkbox", { name: "按来源分组" }).check(); await button("批量管理").click();
		for (const [width, height] of [[1100, 750], [550, 375]]) {
			await page.setViewportSize({ width, height }); await layout(); await shot(`batch-${theme}-${width}`);
			if (width === 550) {
				await settings().getByRole("checkbox", { name: "选择 官方直连", exact: true }).check();
				await button("批量删除").click(); const modal = confirm("批量删除供应商");
				await modal.getByRole("button", { name: "取消", exact: true }).scrollIntoViewIfNeeded();
				assert.equal(await modal.evaluate((node) => node.scrollWidth > node.clientWidth), false);
				await shot(`confirm-${theme}-550`); await page.keyboard.press("Escape");
				await settings().getByRole("checkbox", { name: "选择 官方直连", exact: true }).uncheck();
				await settings().locator(".settings-batch-bar").scrollIntoViewIfNeeded(); await shot(`batch-actions-${theme}-550`);
			}
		}
		await button("退出批量管理").click(); await settings().getByRole("checkbox", { name: "按来源分组" }).uncheck(); await page.setViewportSize({ width: 1100, height: 750 });
	}
	assert.deepEqual(errors, []);
	console.log("PASS settings management: selection scope, stable view sorting/grouping, atomic failure/retry and stale preview, default protection, exact persisted history/drafts/invalidation, full route order keyboard/drag/save/cancel/conflict, themes/narrow layout");
} catch (error) { await shot("failure"); throw error; }
finally { await browser.close(); }
