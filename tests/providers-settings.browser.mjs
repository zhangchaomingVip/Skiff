// Run on the preview port: node tests/providers-settings.browser.mjs http://127.0.0.1:1423
// Uses the local mock bridge only: no real keys, no paid model calls.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1423";
const output = new URL("../features/025-provider-settings-split/screenshots/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const loose = (pattern) => dialog().getByRole("button", { name: pattern });
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
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
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`);
	await page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
	await open();

	// 1. 供应商 is an entry of its own: providers only, no route rows.
	await button("供应商").click();
	assert.equal(await pressed("供应商"), "true");
	assert.equal(await button("编辑 官方直连").count(), 1, "Providers entry must list providers");
	assert.equal(await button("编辑 官方直连 的线路").count(), 0, "Providers entry must not list routes");
	await shot("providers-light");

	// 2. Directory → custom provider → live connection test → save.
	await button("添加供应商").click();
	await page.getByRole("textbox", { name: "搜索供应商" }).waitFor();
	await shot("provider-directory");
	await loose(/自定义供应商/).click();
	await page.locator("#relay-name").fill("验证中转");
	await page.locator("#relay-base").fill("https://api.example.com/v1");
	await page.locator("#relay-key").fill("sk-preview-key");
	await button("测试连接").click();
	await dialog().getByText(/连接成功/).waitFor();
	await button("添加").click();
	await button("编辑 验证中转").waitFor();
	const notice = await dialog().getByRole("status").first().textContent();
	assert.match(notice, /已为「验证中转」自动添加 \d+ 条线路/, "Discovered models must create routes from the provider page");
	await shot("provider-saved");

	// 3. The notice links across; the route entry lists routes, not providers.
	await button("查看模型线路").click();
	await button("编辑 验证中转 的线路").first().waitFor();
	assert.equal(await pressed("模型线路"), "true");
	assert.equal(await button("编辑 官方直连").count(), 0, "Route entry must not list providers");
	assert.equal(await button("编辑 验证中转 的线路").count(), 3, "Discovered routes must be reachable from the route entry");
	await shot("routes-light");

	// 4. Both entries render in the dark theme as well.
	await button("外观").click();
	await button("深色").click();
	await button("供应商").click();
	await shot("providers-dark");
	await button("模型线路").click();
	await shot("routes-dark");

	// 5. Without providers the route entry explains the dependency and links back.
	await button("供应商").click();
	for (const name of ["验证中转", "官方直连", "硅基低价", "官方"]) await removeProvider(name);
	await dialog().getByText("还没添加供应商").waitFor();
	await shot("providers-empty");
	await button("模型线路").click();
	await dialog().getByText("还没有供应商").waitFor();
	assert.equal(await button("编辑 官方直连 的线路").count(), 0, "Empty route entry must not list routes");
	await loose(/去添加供应商/).click();
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