// Companion layout and controls on the isolated mock origin; never calls pi.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(new URL("../.playwright-cli/package.json", import.meta.url))("playwright-core");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.argv[2] ?? "http://localhost:1421";
try {
	await page.addInitScript(() => {
		localStorage.setItem("skiff.voyage.sound.v1", "on");
		window.companionAudioCalls = 0;
		window.AudioContext = class { constructor() { window.companionAudioCalls++; } };
	});
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	assert.equal(await page.locator(".voyage-weather-card").count(), 4);
	assert.equal(await page.locator(".voyage-companion-actions").count(), 0);
	assert.equal(await page.locator(".voyage-companion-sound").count(), 0);
	assert.equal(await page.locator(".voyage-dashboard-header button").count(), 1);
	await page.reload();
	await page.waitForFunction(() => window.voyageHarness?.render);
	assert.equal(await page.locator(".voyage-companion-sound").count(), 0);
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const width of [240, 260, 360, 480]) {
			await page.evaluate((width) => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", `${width}px`), width);
			const layout = await page.evaluate(() => {
				const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
				return { grid: rect(".voyage-weather-grid"), art: rect(".voyage-companion-art"), deck: rect(".voyage-deck-companion") };
			});
			const { grid, art, deck } = layout;
			const context = `${theme} ${width}: ${JSON.stringify(layout)}`;
			assert(art.top >= grid.bottom + 32, context);
			assert(Math.abs(deck.left + deck.width / 2 - art.left - art.width / 2) < 1, context);
			assert(art.width <= 320 && art.width > Math.min(deck.width * .75, 240), context);
			assert(art.bottom <= deck.bottom, context);
			assert(await page.locator(".voyage-weather-card").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), context);
		}
	}
	await page.setViewportSize({ width: 360, height: 640 });
	await page.locator(".voyage-companion-stage").scrollIntoViewIfNeeded();
	await page.locator(".voyage-companion-stage").click();
	assert.equal(await page.locator(".voyage-companion-art").getAttribute("src"), "/companion/tap.webp");
	await page.locator(".voyage-companion-stage").dblclick();
	assert.equal(await page.evaluate(() => window.companionAudioCalls), 0);
	await page.getByRole("button", { name: "收起航行台", exact: true }).click();
	await page.getByRole("button", { name: "展开航行台", exact: true }).click();
	assert.equal(await page.locator(".voyage-weather-card").count(), 4);
	assert.deepEqual(errors, []);
	console.log("PASS companion portal: no sound control or audio despite legacy preference, four-card headroom, larger centered navigator, light/dark × 4 widths, mobile interaction and collapse/reopen");
} finally { await browser.close(); }
