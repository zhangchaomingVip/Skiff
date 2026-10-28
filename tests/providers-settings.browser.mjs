// Run on the preview port: node tests/providers-settings.browser.mjs http://127.0.0.1:1423
// Uses the local mock bridge only: no real keys, no paid model calls.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1423";
const output = new URL(process.env.SKIFF_SETTINGS_SCREENSHOTS ?? "../features/028-settings-information-redesign/screenshots/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const loose = (pattern) => dialog().getByRole("button", { name: pattern });
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`providers-settings-${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
const pressed = (name) => button(name).getAttribute("aria-pressed");
const open = async () => { await page.keyboard.press("Control+Comma"); await dialog().waitFor(); };
const close = async () => { await button("关闭设置").click(); await dialog().waitFor({ state: "detached" }); };
const removeProvider = async (name) => {
	await button(`编辑 ${name}`).click();
	await button("删除").click();
	await page.getByRole("dialog", { name: "删除供应商", exact: true }).getByRole("button", { name: "确认删除" }).click();
	await page.locator("#relay-name").waitFor({ state: "detached" });
};

try {
	await page.addInitScript(() => {
		window.copiedValues = [];
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => window.copiedValues.push(value) } });
	});
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`);
	await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	await open();

	// 1. 供应商 is an entry of its own: providers only, no route rows.
	await button("供应商").click();
	assert.equal(await pressed("供应商"), "true");
	assert.equal(await button("编辑 官方直连").count(), 1, "Providers entry must list providers");
	assert.equal(await button("编辑 官方直连 的路线").count(), 0, "Providers entry must not list routes");
	await shot("providers-light");
	const providerRow = dialog().locator(".provider-relay-row").filter({ hasText: "官方直连" }).first();
	assert.equal(await providerRow.locator(".settings-badge").count(), 0, "The accent bar and switch already identify enabled providers");
	const spacing = await page.evaluate(() => {
		const list = document.querySelector(".provider-list"); const tabs = document.querySelector(".provider-source-tabs"); const row = list.querySelector(".provider-relay-row");
		const side = row.querySelector(".provider-row-side"); const key = side.querySelector(".settings-key-fingerprint"); const actions = side.querySelector(".provider-row-actions");
		return { groupGap: getComputedStyle(list).gap, tabGap: getComputedStyle(tabs).gap, tabRadius: getComputedStyle(tabs).borderRadius, sideGap: getComputedStyle(side).gap, keyGap: getComputedStyle(key).marginRight, actionGap: getComputedStyle(actions).gap };
	});
	assert.deepEqual(spacing, { groupGap: "12px", tabGap: "4px", tabRadius: "8px", sideGap: "8px", keyGap: "8px", actionGap: "6px" });
	const iconColor = await providerRow.locator(".provider-edit-button").evaluate((button) => getComputedStyle(button).color);
	const inactiveIconColor = await providerRow.evaluate((row) => { row.classList.add("disabled"); const color = getComputedStyle(row.querySelector(".provider-edit-button")).color; row.classList.remove("disabled"); return color; });
	assert.equal(inactiveIconColor, iconColor, "Disabling a provider must not dim its action icons");
	await providerRow.getByRole("button", { name: "复制 API 密钥 官方直连", exact: true }).click();
	assert.deepEqual(await page.evaluate(() => window.copiedValues), ["sk-mock-0000abcd"]);
	await providerRow.getByRole("button", { name: "测试连接 官方直连", exact: true }).click();
	await page.waitForFunction(() => window.skiffPreview.metadata.tests.some((record) => record.relayId === "r1"));
	assert.equal(await page.evaluate(() => window.skiffPreview.testRequests.at(-1).modelId), "deepseek-flash");
	await providerRow.getByText(/最近测试 137 ms/).waitFor();
	await page.evaluate(() => window.skiffPreview.deferTests(true));
	await providerRow.getByRole("button", { name: "测试连接 官方直连", exact: true }).click();
	await providerRow.locator(".provider-test-icon.is-spinning").waitFor();
	await page.waitForFunction(() => window.skiffPreview.pendingTests.length > 0);
	await page.evaluate(() => {
		window.skiffPreview.pendingTests.splice(0).forEach((pending) => pending.resolve({ ok: false, latencyMs: 10000, status: null, error: "timeout" }));
		window.skiffPreview.deferTests(false);
	});
	const failedStatus = providerRow.locator(".provider-row-test-status.is-error");
	await failedStatus.waitFor();
	assert.equal((await failedStatus.textContent()).trim(), "· 连接失败");
	const dangerColor = await page.evaluate(() => { const node = document.createElement("span"); node.style.color = "var(--danger)"; document.body.append(node); const color = getComputedStyle(node).color; node.remove(); return color; });
	assert.equal(await failedStatus.evaluate((node) => getComputedStyle(node).color), dangerColor);

	// 2. Directory → custom provider → live connection test → save.
	await button("添加供应商").click();
	await page.getByRole("textbox", { name: "搜索供应商" }).waitFor();
	await shot("provider-directory");
	await loose(/自定义供应商/).click();
	await page.locator("#relay-name").fill("验证中转");
	await page.locator("#relay-base").fill("https://api.example.com/v1");
	await page.locator("#relay-key").fill("sk-preview-key");
	await button("测试延迟").click();
	await dialog().getByText(/延迟 \d+ms · 密钥有效/).waitFor();
	await button("获取模型列表").click();
	await dialog().getByText(/获取到 \d+ 个模型/).waitFor();
	// Models without a family stay in the list and suggest a one-click family.
	await button("添加模型").click();
	const draftIds = dialog().getByRole("textbox", { name: /^模型 ID / });
	await draftIds.last().fill("gpt-5.2");
	await dialog().getByText(/发现新家族：GPT/).waitFor();
	await dialog().locator(".provider-model-editor-row").last().getByText("未配置家族").waitFor();
	await button("一键创建家族").click();
	await dialog().getByText(/已创建家族 GPT/).waitFor();
	assert.equal(await dialog().locator(".provider-model-editor-row").last().getByText("GPT").count(), 1, "Created family takes over its models");
	// A single tested model carries the connection evidence, so renaming it
	// invalidates the save until the ID is restored.
	await dialog().locator(".provider-model-test").first().getByRole("button", { name: "测试", exact: true }).click();
	await dialog().locator(".provider-model-test .test-result.ok").first().waitFor();
	const testedId = await page.evaluate(() => window.skiffPreview.testRequests.at(-1).modelId);
	const ids = dialog().getByRole("textbox", { name: /^模型 ID / });
	const testedIndex = await ids.evaluateAll((nodes, id) => nodes.findIndex((node) => node.value === id), testedId);
	await ids.nth(testedIndex).fill("deepseek-changed-model");
	assert.equal(await button("添加").isDisabled(), true, "A test for the previous model ID cannot validate its replacement");
	await ids.nth(testedIndex).fill(testedId);
	await page.locator("#relay-name").fill("仅改名称");
	assert.equal(await button("添加").isEnabled(), true, "A label change does not invalidate connection evidence");
	await page.locator("#relay-name").fill("验证中转");
	await button("添加").click();
	await button("编辑 验证中转").waitFor();
	const notice = await dialog().getByRole("status").first().textContent();
	assert.match(notice, /已保存「验证中转」，同步 \d+ 个模型到 \d+ 条路线/, "Discovered models must create routes from the provider page");
	assert.match(notice, /个未配置家族的模型暂不进入选择器/, "Family-less models save with the provider but stay out of the picker");
	assert.ok(await page.evaluate(() => window.skiffPreview.families.some((family) => family.id === "gpt" && family.routes.some((route) => route.models.some((model) => model.modelId === "gpt-5.2")))), "One-click family must gain a route on save");
	await shot("provider-saved");

	// 3. The notice links across; the route entry lists routes, not providers.
	await button("查看DeepSeek路线").click();
	await page.locator("#route-relay").waitFor();
	assert.equal(await page.locator("#route-relay").inputValue(), await page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "save_relay").at(-1).args.relay.id));
	await page.keyboard.press("Escape");
	assert.equal(await pressed("路线"), "true");
	assert.equal(await button("编辑 官方直连").count(), 0, "Route entry must not list providers");
	assert.equal(await button("更多 验证中转 的路线操作").count(), 1, "Saved destination selects its family");
	await shot("routes-light");

	// 3.5 The one-click family mirrors onto the models entry as a routed overview.
	await button("模型").click();
	await dialog().getByRole("tab", { name: "GPT" }).click();
	const gptCard = dialog().locator(".family-card").filter({ hasText: "GPT" });
	await gptCard.getByText("gpt-5.2").waitFor();
	assert.match(await gptCard.textContent(), /1 条路线可用/, "Custom family card lists its routed models");
	assert.equal(await gptCard.getByRole("button", { name: "联网更新" }).count(), 0, "Custom families have no official refresh source");
	await button("供应商").click();

	// 4. Both entries render in the dark theme as well.
	await button("外观").click();
	await button("深色").click();
	await button("供应商").click();
	await shot("providers-dark");
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Provider settings must fit a mobile viewport");
	assert.equal(await dialog().locator(".settings-content").evaluate((node) => node.scrollWidth > node.clientWidth), false, "Provider settings content must not overflow on mobile");
	assert.equal(await dialog().locator(".provider-list").evaluate((node) => node.scrollWidth > node.clientWidth), false, "Provider cards must not overflow on mobile");
	assert.equal(await dialog().locator(".provider-relay-row").first().evaluate((row) => {
		const title = row.querySelector(".provider-row-title strong"); const main = row.querySelector(".provider-relay-main").getBoundingClientRect(); const side = row.querySelector(".provider-row-side").getBoundingClientRect();
		return title.clientWidth >= title.scrollWidth && side.top >= main.bottom;
	}), true, "Mobile cards must preserve the provider name and place actions below its details");
	await shot("providers-mobile-dark");
	await page.setViewportSize({ width: 1100, height: 750 });
	await button("路线").click();
	await shot("routes-dark");

	// 5. Without providers the route entry explains the dependency and links back.
	await button("供应商").click();
	for (const name of ["验证中转", "官方直连", "硅基低价", "官方"]) await removeProvider(name);
	// The status filter stays 启用-only after the row switches; clearing it reveals the empty state.
	await dialog().getByRole("button", { name: /^启用 / }).click();
	await dialog().getByText("还没添加供应商").waitFor();
	await shot("providers-empty");
	await button("路线").click();
	await dialog().getByText("还没有供应商").waitFor();
	assert.equal(await button("编辑 官方直连 的路线").count(), 0, "Empty route entry must not list routes");
	await loose(/去添加供应商/).click();
	// Returning remounts the entry, so the 启用-only filter needs clearing again.
	await dialog().getByRole("button", { name: /^启用 / }).click();
	await dialog().getByText("还没添加供应商").waitFor();
	assert.equal(await pressed("供应商"), "true", "Cross-link must select the provider entry");
	assert.equal(await button("编辑 官方直连").count(), 0, "Providers were deleted on purpose");

	await close();
	assert.deepEqual(errors, []);
	console.log("PASS provider entry (list, directory, editor, test, delete), route entry separation, cross-links, empty state and dark theme");
} catch (error) {
	await shot("failure");
	console.error(errors);
	throw error;
} finally { await browser.close(); }
