import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "../.playwright-cli/node_modules/playwright-core");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] || "http://localhost:1421";
await mkdir("dist", { recursive: true });
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, reducedMotion: "reduce" });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/preview.html?theme=${theme}`, { waitUntil: "domcontentloaded" });
		await page.locator(".settings-trigger").waitFor();
		await page.locator(".settings-trigger").click();
		await page.getByRole("button", { name: "联网搜索", exact: true }).click();
		const settings = page.locator(".web-search-settings");
		await settings.waitFor();

		assert.equal(await settings.locator(".settings-group").count(), 3, `${theme}: toggles, engine/key and runtime read as three cards`);
		assert.equal(await settings.locator(".settings-row-title", { hasText: "联网搜索" }).count(), 1, `${theme}: the feature row keeps its title`);
		const switches = settings.locator(".settings-row .switch");
		assert.equal(await switches.count(), 2, `${theme}: both feature toggles remain reachable`);
		const alignment = await settings.locator(".settings-row").first().evaluate((row) => {
			const toggle = row.querySelector(".switch").getBoundingClientRect(), box = row.getBoundingClientRect();
			return { distance: box.right - toggle.right - parseFloat(getComputedStyle(row).paddingRight), centered: (toggle.top + toggle.bottom) / 2 - (box.top + box.bottom) / 2 };
		});
		assert.ok(Math.abs(alignment.distance) < 1, `${theme}: switches sit on the row's right edge, not inline with the title`);
		assert.ok(Math.abs(alignment.centered) < 1, `${theme}: switches stay vertically centered`);

		const engine = page.getByRole("group", { name: "搜索引擎", exact: true });
		assert.equal(await engine.getByRole("button").count(), 2, `${theme}: engine options become a segmented control`);
		await engine.getByRole("button", { name: "Exa", exact: true }).click();
		await page.getByText("Exa API Key", { exact: true }).waitFor();
		assert.equal(await page.locator("#web-search-key").getAttribute("placeholder"), "exa-…", `${theme}: switching engine re-labels the key field`);
		await settings.getByText("语义搜索，适合技术文档与观点类内容，按量计费；无法检索 X（Twitter）原帖。").waitFor();

		assert.equal(await page.locator(".web-search-badge").textContent(), "尚未配置密钥", `${theme}: an empty key reads as a badge, not a console row`);
		assert.equal(await page.locator(".web-search-footer .ui-button[data-variant=primary]").count(), 1, `${theme}: the footer keeps a single primary action`);
		assert.equal(await page.getByText("删除已保存的 Key", { exact: true }).count(), 0, `${theme}: clearing moved inline, not into the footer`);
		assert.equal(await page.locator(".web-search-status-actions").getByRole("button", { name: "安装扩展", exact: true }).count(), 1, `${theme}: extension install lives beside the runtime status`);

		await page.locator("#web-search-key").fill("exa-0123456789abcdef");
		await page.getByRole("button", { name: "保存并验证", exact: true }).click();
		await page.locator(".web-search-badge").filter({ hasText: "密钥验证通过" }).waitFor({ timeout: 10000 });
		await settings.getByRole("button", { name: "测试已保存的 Key", exact: true }).waitFor();
		await settings.getByRole("button", { name: "清除已保存的 Key", exact: true }).waitFor();
		assert.ok(await settings.locator(".web-search-chip").filter({ hasText: "服务连通" }).count(), `${theme}: health reads as status chips`);
		assert.equal(await page.locator("#web-search-key").inputValue(), "", `${theme}: saving clears the secret input`);
		await page.screenshot({ path: `dist/web-search-settings-${theme}.png` });

		await page.getByRole("button", { name: "关闭设置", exact: true }).click();
		await page.locator(".settings-dialog").waitFor({ state: "detached" });
		assert.deepEqual(errors, [], `${theme}: no browser errors`);
		console.log(`PASS ${theme}: three cards, right-side switches, segmented engine, inline key actions, runtime chips`);
		await page.close();
	}
} finally {
	await browser.close();
}
