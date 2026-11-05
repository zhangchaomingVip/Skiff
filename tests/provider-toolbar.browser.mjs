// Isolated preview bridge only; no real providers or credentials.
// SKIFF_PLAYWRIGHT_DIR=.playwright-cli/node_modules/playwright node tests/provider-toolbar.browser.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/provider-toolbar/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const config = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_model_families"));
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=settings-info&theme=${theme}&color=blue`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.keyboard.press("Control+Comma");
		await button("供应商").click();
		const original = await config();
		const source = dialog().getByRole("combobox", { name: "供应商来源" });
		const search = dialog().getByRole("textbox", { name: "搜索已配置供应商" });
		assert.equal(await source.inputValue(), "all");
		assert.deepEqual(await source.getByRole("option").allTextContents(), ["全部 (5)", "官方直连 (2)", "自定义 (2)", "本机 (1)"]);
		assert.equal(await dialog().locator(".provider-source-count").count(), 0);
		assert.equal(await dialog().getByRole("spinbutton", { name: "美元兑人民币汇率" }).count(), 0);
		assert.equal(await dialog().getByText("结算汇率", { exact: true }).count(), 0);
		const borderStyle = (node) => { const style = getComputedStyle(node); return { width: style.borderWidth, color: style.borderColor, style: style.borderStyle }; };
		const restingBorder = await source.evaluate(borderStyle);
		assert.deepEqual(restingBorder, await search.evaluate(borderStyle), "Source and search share the same resting border");
		assert.equal(restingBorder.width, "1px");
		await search.focus();
		const readFocusStyle = (node) => { const style = getComputedStyle(node); return { width: style.borderWidth, color: style.borderColor, outline: style.outlineStyle, shadow: style.boxShadow }; };
		const searchFocusStyle = await search.evaluate(readFocusStyle);
		assert.equal(searchFocusStyle.width, "1px");
		assert.notEqual(searchFocusStyle.color, restingBorder.color);
		assert.equal(searchFocusStyle.outline, "none", "Search focus adds no thick outer frame");
		assert.equal(searchFocusStyle.shadow, "none");
		await shot(`${theme}-search-focus`);
		await page.keyboard.press("Tab");
		assert.equal(await source.evaluate((node) => node === document.activeElement), true, "Keyboard navigation reaches the source filter");
		const focusStyle = await source.evaluate(readFocusStyle);
		assert.deepEqual(searchFocusStyle, focusStyle, "Search and source use the same light focus border");
		assert.equal(focusStyle.width, "1px");
		assert.notEqual(focusStyle.color, restingBorder.color, "Focus highlights the existing border");
		assert.equal(focusStyle.outline, "none", "Focus adds no thick outer frame");
		assert.equal(focusStyle.shadow, "none");
		await shot(`${theme}-source-focus`);
		await source.evaluate((node) => node.blur());
		const geometry = await dialog().locator(".providers-toolbar").evaluate((toolbar) => {
			const controls = [...toolbar.querySelectorAll("input, select, button")].map((node) => {
				const rect = node.getBoundingClientRect();
				return { top: rect.top, height: rect.height, left: rect.left, right: rect.right };
			});
			return { controls, width: toolbar.clientWidth, overflow: toolbar.scrollWidth > toolbar.clientWidth };
		});
		assert.equal(geometry.overflow, false);
		assert.ok(geometry.controls.every((rect) => rect.height === 32 && rect.top === geometry.controls[0].top), "All desktop controls share a 32px baseline");
		assert.ok(geometry.controls.slice(1).every((rect, index) => rect.left >= geometry.controls[index].right), "Controls never overlap");
		assert.equal(await dialog().locator(".provider-status-group").evaluate((group) => {
			const [enabled, disabled] = [...group.children].map((node) => node.getBoundingClientRect());
			return enabled.width === disabled.width && enabled.height === disabled.height && enabled.right === disabled.left;
		}), true, "Status segments have equal, adjacent hit areas");
		assert.equal(await dialog().locator(".provider-list").evaluate((list) => {
			const right = document.querySelector(".settings-toolbar-extras").getBoundingClientRect().right;
			return Math.abs(right - list.getBoundingClientRect().right) < 1;
		}), true, "Toolbar actions align with the right edge of provider cards");
		assert.equal(await dialog().locator(".provider-source-tag").filter({ hasText: "自定义" }).count(), 0);
		assert.deepEqual(await dialog().locator(".provider-source-tag").allTextContents(), ["官方直连", "官方直连"]);
		const testedRow = dialog().locator(".provider-relay-row").filter({ has: page.getByRole("button", { name: "测试连接 官方直连", exact: true }) });
		assert.equal(await testedRow.locator(".provider-row-test-status.is-warning").textContent(), "待测试");
		await page.evaluate(() => window.skiffPreview.deferTests(true));
		const testReply = async (result) => {
			await button("测试连接 官方直连").click();
			await testedRow.getByText("测试中…", { exact: true }).waitFor();
			await page.waitForFunction(() => window.skiffPreview.pendingTests.length > 0);
			await page.evaluate((reply) => window.skiffPreview.pendingTests.splice(0).forEach((test) => test.resolve(reply)), result);
		};
		await testReply({ ok: false, latencyMs: 10000, status: null, error: "request timed out" });
		await testedRow.getByText("连接超时", { exact: true }).waitFor();
		await testReply({ ok: false, latencyMs: 42, status: 401, error: "Invalid API key" });
		await testedRow.getByText("连接失败", { exact: true }).waitFor();
		await testReply({ ok: true, latencyMs: 926, status: 200, error: null });
		await testedRow.getByText("926 ms", { exact: true }).waitFor();
		assert.equal(await testedRow.locator(".provider-row-test-status.is-success .provider-test-dot").count(), 1);
		assert.match(await testedRow.locator(".provider-row-test-status").getAttribute("title"), /连接成功.*926 ms/);
		await page.evaluate(() => window.skiffPreview.deferTests(false));
		await shot(`${theme}-desktop`);

		await source.selectOption("custom");
		assert.equal(await dialog().locator(".provider-relay-row").count(), 1);
		await button("启用 1").click();
		assert.equal(await dialog().locator(".provider-relay-row").count(), 2);
		await button("停用 1").click();
		assert.equal(await dialog().locator(".provider-relay-row").count(), 1);
		await source.selectOption("local");
		assert.match(await dialog().locator(".provider-relay-row").textContent(), /本机服务/);
		await source.selectOption("all");
		await button("停用 2").click();
		await search.fill("siliconflow.cn");
		assert.equal(await dialog().locator(".provider-relay-row").count(), 1);
		assert.equal(await source.getByRole("option", { name: "自定义 (1)", exact: true }).count(), 1);
		await button("清空供应商搜索").click();
		assert.equal(await search.inputValue(), "");
		assert.equal(await search.evaluate((node) => node === document.activeElement), true, "Clearing returns focus to search");
		assert.equal(await dialog().locator(".provider-relay-row").count(), 5);
		await button("批量管理").click();
		await dialog().getByRole("checkbox", { name: "全选当前结果" }).check();
		assert.match(await dialog().locator(".settings-batch-bar").textContent(), /已选 5 个/);
		await source.selectOption("official");
		assert.match(await dialog().locator(".settings-batch-bar").textContent(), /已选 0 个/);
		await button("退出批量管理").click();
		await source.selectOption("all");

		await button("外观").click();
		await button("供应商").click();
		assert.equal((await config()).usdCnyRate, original.usdCnyRate, "Navigation preserves the internal exchange rate");
		assert.equal(await dialog().getByRole("spinbutton", { name: "美元兑人民币汇率" }).count(), 0);
		assert.equal(await page.evaluate(() => window.skiffPreview.commands.some((entry) => entry.command === "set_usd_cny_rate")), false, "The page does not modify exchange rates");
		for (const width of [900, 550, 390]) {
			await page.setViewportSize({ width, height: 750 });
			assert.equal(await dialog().locator(".settings-content").evaluate((node) => node.scrollWidth > node.clientWidth), false, "Narrow windows stay within their content area");
			await shot(`${theme}-${width}`);
		}
		await page.setViewportSize({ width: 1100, height: 750 });
		assert.equal(await testedRow.locator(".provider-row-test-status.is-success").textContent(), "926 ms", "Saved success uses the same compact status after navigation");
		await page.evaluate(() => { window.skiffPreview.metadata.tests.find((test) => test.relayId === "r1").configVersion = "stale-preview-version"; });
		await button("外观").click();
		await button("供应商").click();
		assert.equal(await testedRow.locator(".provider-row-test-status.is-warning").textContent(), "待测试", "Changed configuration invalidates old success");
		assert.match(await testedRow.locator(".provider-row-test-status").getAttribute("title"), /配置已变化/);
	}
	assert.deepEqual(errors, []);
	console.log("PASS provider toolbar: source/status/search, light focus border, hidden rate UI, clear focus, batch selection scope, desktop alignment, light/dark and narrow layouts");
} catch (error) {
	await shot("failure");
	throw error;
} finally {
	await browser.close();
}
