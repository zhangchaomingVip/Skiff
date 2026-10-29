import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/star-themes/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const ready = () => page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const open = async () => {
	await page.locator(".settings-trigger").click();
	await page.getByRole("button", { name: "外观", exact: true }).click();
	await dialog().waitFor();
};
const close = () => button("关闭设置").click();
const shot = (name) => page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, output)) });
const background = () => page.locator(".workspace").evaluate((element) => getComputedStyle(element).backgroundImage);
const stars = () => dialog().getByRole("checkbox", { name: "显示星星", exact: true });
const contrast = (a, b) => {
	const luminance = (color) => color.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
	const x = luminance(a); const y = luminance(b);
	return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};

try {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`);
	await ready();
	await open();
	assert.equal(await button("默认").count(), 0);
	assert.equal(await button("沿用主题色").count(), 0);
	assert.equal(await button("暖杏米").getAttribute("aria-pressed"), "true");
	assert.equal(await button("星空蓝").getAttribute("aria-pressed"), "true");
	await shot("settings-defaults-light");
	await button("深色").click();
	assert.match(await background(), /stars\.svg/);
	await shot("settings-defaults-dark");
	await button("浅色").click();
	await button("鼠尾草绿").click();
	const lightBackground = await background();
	await button("星空蓝").click();
	assert.equal(await background(), lightBackground, "Dark palette must not affect light mode");
	await button("深色").click();
	assert.equal(await stars().isChecked(), true);
	for (const [label, color] of [["星空黑", "star-black"], ["星空蓝", "star-blue"]]) {
		await button(label).click();
		assert.equal(await button(label).getAttribute("aria-pressed"), "true");
		assert.equal(await page.evaluate(() => localStorage.getItem("skiff.darkThemeColor")), color);
		assert.match(await background(), /stars\.svg/);
		const palette = await page.evaluate(() => {
			const style = getComputedStyle(document.documentElement);
			return Object.fromEntries(["--color-text-primary", "--color-text-secondary", "--color-text-tertiary", "--color-accent", "--color-bg-primary", "--color-bg-secondary", "--color-bg-tertiary", "--color-bg-hover", "--color-sidebar-bg", "--selected"].map((key) => [key, style.getPropertyValue(key).trim()]));
		});
		for (const fg of ["--color-text-primary", "--color-text-secondary", "--color-text-tertiary", "--color-accent"]) for (const bg of ["--color-bg-primary", "--color-bg-secondary", "--color-bg-tertiary", "--color-bg-hover", "--color-sidebar-bg", "--selected"]) assert.ok(contrast(palette[fg], palette[bg]) >= 4.5, `${color}: ${fg} on ${bg}`);
		await shot(`settings-${color}`);
		await close();
		await shot(`${color}-stars`);
		await open();
		await stars().uncheck();
		assert.doesNotMatch(await background(), /stars\.svg/);
		await close();
		await shot(`${color}-plain`);
		// The decorative image cannot intercept composer clicks or typing.
		await page.locator(".composer-input").fill("星空主题输入检查");
		await page.locator(".composer-input").fill("");
		await open();
		await stars().check();
	}
	await stars().uncheck();
	await page.evaluate(() => history.replaceState(null, "", "/tests/preview.html?fixture=archive&persist=1"));
	await page.reload();
	await ready();
	assert.equal(await page.locator("html").getAttribute("data-dark-theme-color"), "star-blue");
	assert.doesNotMatch(await background(), /stars\.svg/);
	await open();
	assert.equal(await stars().isChecked(), false);
	await button("浅色").click();
	assert.equal(await background(), lightBackground);
	assert.equal(await button("鼠尾草绿").getAttribute("aria-pressed"), "true");
	await shot("light-preserved");
	await button("跟随系统").click();
	await page.emulateMedia({ colorScheme: "dark" });
	await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
	await stars().check();
	assert.match(await background(), /stars\.svg/);
	await page.emulateMedia({ colorScheme: "light" });
	await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
	assert.equal(await background(), lightBackground);
	await button("深色").click();
	await close();
	// Verify animation in the actual CSS background, not only in a standalone SVG document.
	const brightStar = { x: 650, y: 120, width: 40, height: 40 };
	const frameOne = await page.screenshot({ clip: brightStar });
	await page.waitForTimeout(800);
	const frameTwo = await page.screenshot({ clip: brightStar });
	assert.equal(frameOne.equals(frameTwo), false, "The background image must animate in the app");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.waitForFunction(() => getComputedStyle(document.querySelector(".workspace")).backgroundImage.includes("stars-static.svg"));
	await page.evaluate(async () => { const image = new Image(); image.src = "/themes/stars-static.svg"; await image.decode(); });
	const stillOne = await page.screenshot({ clip: brightStar });
	await page.waitForTimeout(800);
	const stillTwo = await page.screenshot({ clip: brightStar });
	assert.equal(stillOne.equals(stillTwo), true, "Reduced motion must freeze the actual background");
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await open();
	await page.setViewportSize({ width: 550, height: 375 });
	await stars().scrollIntoViewIfNeeded();
	assert.equal(await dialog().evaluate((element) => element.scrollWidth > element.clientWidth), false);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await stars().uncheck();
	await stars().check();
	await shot("settings-narrow");
	await page.setViewportSize({ width: 1440, height: 960 });
	await stars().uncheck();
	assert.doesNotMatch(await background(), /stars\.svg/);
	assert.equal(await page.locator("html").getAttribute("data-theme-color"), "green");
	// Inspect the same SVG used by CSS, including its own reduced-motion media query.
	await page.goto(`${origin}/themes/stars.svg`);
	assert.equal(await page.locator(".beacon").count(), 7);
	const animated = await page.evaluate(() => document.getAnimations().length);
	assert.equal(animated, 7, "Only the selected bright stars should animate");
	const durations = await page.locator(".beacon").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationDuration));
	assert.ok(new Set(durations).size > 1, "Breathing rhythms must differ");
	const first = await page.locator(".beacon").first().evaluate((element) => getComputedStyle(element).opacity);
	await page.waitForTimeout(800);
	const second = await page.locator(".beacon").first().evaluate((element) => getComputedStyle(element).opacity);
	assert.notEqual(first, second, "Bright stars must actually breathe");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
	assert.deepEqual(errors, []);
	console.log("PASS star themes: palettes, contrast, stars on/off, reload, system theme, light preservation, narrow layout, input, staggered breathing and reduced motion");
} catch (error) {
	await shot("failure");
	throw error;
} finally {
	await browser.close();
}
