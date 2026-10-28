import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1423";
const output = new URL("../dist/theme-colors/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const ready = () => page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
const open = async () => {
	await page.locator(".settings-trigger").click();
	await page.getByRole("button", { name: "外观", exact: true }).click();
	await dialog().waitFor();
};
const close = async () => {
	await button("关闭设置").click();
	await dialog().waitFor({ state: "detached" });
};
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
const colors = [["紫色", "purple"], ["黄色", "yellow"], ["绿色", "green"], ["蓝色", "blue"]];
const luminance = (hex) => {
	const rgb = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
	return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => {
	const x = luminance(a); const y = luminance(b);
	return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
};

try {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`);
	await ready();
	await open();
	assert.equal(await page.locator(".settings-theme-color").count(), 5);
	assert.equal(await button("默认").getAttribute("aria-pressed"), "true");
	await shot("settings-light-default");

	for (const theme of ["light", "dark"]) {
		await button(theme === "light" ? "浅色" : "深色").click();
		const accents = new Set();
		const backdrops = new Set();
		for (const [label, color] of colors) {
			await button(label).click();
			assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
			assert.equal(await page.locator("html").getAttribute("data-theme-color"), color);
			assert.equal(await page.evaluate(() => localStorage.getItem("skiff.themeColor")), color);
			assert.equal(await button(label).getAttribute("aria-pressed"), "true");
			const presentation = await page.evaluate(() => ({
				accent: getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim(),
				workspace: getComputedStyle(document.querySelector(".workspace")).backgroundImage,
				sidebar: getComputedStyle(document.querySelector(".sidebar")).backgroundImage,
				titlebar: getComputedStyle(document.querySelector(".titlebar")).backgroundImage,
			}));
			assert.match(presentation.workspace, /gradient/);
			assert.match(presentation.sidebar, /gradient/);
			assert.match(presentation.titlebar, /gradient/);
			accents.add(presentation.accent);
			backdrops.add(presentation.workspace);
			const palette = await page.evaluate(() => {
				const style = getComputedStyle(document.documentElement);
				const names = ["--color-text-primary", "--color-text-secondary", "--color-text-tertiary", "--color-accent", "--color-bg-primary", "--color-bg-secondary", "--color-bg-tertiary", "--color-bg-hover", "--color-sidebar-bg", "--selected", "--action-foreground", "--action", "--action-hover", "--action-active"];
				return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
			});
			for (const foreground of ["--color-text-primary", "--color-text-secondary", "--color-text-tertiary", "--color-accent"]) for (const background of ["--color-bg-primary", "--color-bg-secondary", "--color-bg-tertiary", "--color-bg-hover", "--color-sidebar-bg", "--selected"]) {
				assert.ok(contrast(palette[foreground], palette[background]) >= 4.5, `${theme}/${color}: ${foreground} on ${background} must meet 4.5:1`);
			}
			for (const background of ["--action", "--action-hover", "--action-active"]) assert.ok(contrast(palette["--action-foreground"], palette[background]) >= 4.5, `${theme}/${color}: action text on ${background} must meet 4.5:1`);
			await shot(`settings-${theme}-${color}`);
			await close();
			await shot(`homepage-${theme}-${color}`);
			await open();
		}
		assert.equal(accents.size, 4, `${theme}: every color needs its own accent`);
		assert.equal(backdrops.size, 4, `${theme}: every color needs its own backdrop`);
	}

	await button("绿色").click();
	await close();
	await page.evaluate(() => history.replaceState(null, "", "/tests/preview.html?fixture=archive&persist=1"));
	await page.reload();
	await ready();
	assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
	assert.equal(await page.locator("html").getAttribute("data-theme-color"), "green");
	await open();
	assert.equal(await button("深色").getAttribute("aria-pressed"), "true");
	assert.equal(await button("绿色").getAttribute("aria-pressed"), "true");
	await button("浅色").click();
	assert.equal(await page.locator("html").getAttribute("data-theme-color"), "green", "Light/dark switching must preserve theme color");
	await button("默认").click();
	assert.equal(await page.locator("html").getAttribute("data-theme-color"), "default");

	await page.setViewportSize({ width: 550, height: 375 });
	assert.equal(await dialog().evaluate((element) => element.scrollWidth > element.clientWidth), false);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await button("蓝色").scrollIntoViewIfNeeded();
	await shot("settings-narrow");
	assert.deepEqual(errors, []);
	console.log("PASS theme colors: four palettes × light/dark, gradients, accents, 4.5:1 contrast, selected states, reload persistence, narrow layout");
} catch (error) {
	await shot("failure");
	console.error(errors);
	throw error;
} finally {
	await browser.close();
}
