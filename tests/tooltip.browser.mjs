import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		const button = page.locator(".activity-button").first();
		const tooltip = page.locator(".activity-bar .ui-tooltip").first();
		await button.waitFor();
		const visible = () => tooltip.evaluate((element) => !element.hidden && getComputedStyle(element).opacity === "1");
		await button.hover();
		assert.equal(await visible(), true, `${theme}: hover shows the tooltip`);
		await page.mouse.move(800, 400);
		assert.equal(await visible(), false, `${theme}: leaving hides the tooltip`);
		await button.click();
		await page.mouse.move(800, 400);
		assert.equal(await button.evaluate((element) => element === document.activeElement), true);
		assert.equal(await visible(), false, `${theme}: mouse focus must not keep the tooltip open`);
		await button.hover();
		assert.equal(await visible(), true, `${theme}: hovering again shows the tooltip`);
		await page.mouse.move(800, 400);
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		assert.equal(await button.evaluate((element) => element === document.activeElement), true);
		assert.equal(await visible(), true, `${theme}: keyboard focus shows the tooltip`);
		await page.keyboard.press("Escape");
		assert.equal(await visible(), false, `${theme}: Escape dismisses the tooltip`);
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		assert.equal(await visible(), true, `${theme}: refocusing restores the tooltip`);
		await page.keyboard.press("Tab");
		assert.equal(await visible(), false, `${theme}: moving focus hides the tooltip`);
	}
	console.log("Tooltip hover, mouse click/leave, keyboard focus and Escape passed in light/dark themes.");
} finally {
	await browser.close();
}
