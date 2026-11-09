import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(join(process.cwd(), ".playwright-cli/node_modules/playwright-core"));
const origin = process.argv[2] ?? "http://localhost:1421";
const output = join(process.cwd(), "dist/browser-settings");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		await page.goto(`${origin}/tests/preview.html?theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		const open = async () => {
			await page.keyboard.press("Control+Comma");
			await page.getByRole("dialog", { name: "设置", exact: true }).getByRole("button", { name: "AI 浏览器", exact: true }).click();
			await page.locator("#browser-enabled").waitFor();
		};
		await open();
		await page.getByText("浏览器已就绪", { exact: true }).waitFor();
		assert.equal(await page.locator("#browser-enabled").isChecked(), false);
		await page.locator("#browser-enabled").focus();
		await page.keyboard.press("Space");
		await page.getByRole("dialog", { name: "设置", exact: true }).waitFor({ state: "detached" });
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await open();
		assert.equal(await page.locator("#browser-enabled").isChecked(), true);
		await page.screenshot({ path: join(output, `${theme}.png`) });
		await page.setViewportSize({ width: 600, height: 400 });
		assert.equal(await page.getByRole("dialog", { name: "设置", exact: true }).evaluate((el) => el.scrollWidth > el.clientWidth), false);
		await page.screenshot({ path: join(output, `${theme}-narrow.png`) });
		assert.deepEqual(errors, []);
		await page.close();
	}
	console.log("PASS browser settings: both themes, keyboard toggle, reconnect persistence and 600x400 layout");
} finally { await browser.close(); }
