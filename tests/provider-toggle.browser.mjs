// Isolated mock bridge; provider switches must not reload sessions inside settings.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/provider-toggle/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => settings().getByRole("button", { name, exact: true });
const ready = () => page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
const starts = () => page.evaluate(() => window.skiffPreview.commands.filter((entry) => entry.command === "rpc_start").length);

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=chat&theme=${theme}`);
		await ready();
		const before = await starts();
		await page.keyboard.press("Control+Comma");
		await button("供应商").click();
		await button("启用 3").click();
		await page.evaluate(() => {
			window.toggleRestrictions = [];
			window.toggleObserver = new MutationObserver(() => {
				for (const node of document.querySelectorAll(".settings-restriction")) window.toggleRestrictions.push(node.textContent);
			});
			window.toggleObserver.observe(document.querySelector(".settings-dialog"), { subtree: true, childList: true, attributes: true });
		});
		const bounds = await settings().boundingBox();
		for (const name of ["官方直连", "硅基低价"]) {
			for (const enabled of [false, true]) {
				await settings().getByRole("checkbox", { name: `${enabled ? "启用" : "停用"} ${name}`, exact: true }).locator("..").click();
				await page.waitForFunction(({ name, enabled }) => window.skiffPreview.relays.find((relay) => relay.name === name)?.enabled === enabled, { name, enabled });
				await page.waitForFunction(() => !document.querySelector('[aria-label="关闭设置"]')?.disabled);
				// Give startup/reconciliation effects time to expose a reconnect.
				await page.waitForTimeout(100);
				assert.equal(await starts(), before, "Saving a switch must not restart pi while settings is open");
				assert.deepEqual(await settings().boundingBox(), bounds);
				assert.deepEqual(await page.evaluate(() => window.toggleRestrictions), [], "Switches must not inject global loading restrictions");
				assert.equal(await button("模型").isEnabled(), true);
			}
		}
		await button("模型").click();
		await button("供应商").click();
		assert.equal(await starts(), before, "Changing settings categories must not release the pending reload");
		await page.screenshot({ path: new URL(`${theme}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
		await button("关闭设置").click();
		await page.waitForFunction((before) => window.skiffPreview.commands.filter((entry) => entry.command === "rpc_start").length === before + 1, before);
		await ready();
		await page.waitForTimeout(100);
		assert.equal(await starts(), before + 1, "Closing settings applies the latest configuration in one reload");
		assert.equal(await page.locator(".composer-input").count(), 1);
	}
	assert.deepEqual(errors, []);
	console.log("PASS provider toggle: current/other provider, off/on, stable settings, category changes, one reload on close, light/dark");
} finally {
	await page.evaluate(() => window.toggleObserver?.disconnect()).catch(() => {});
	await browser.close();
}
