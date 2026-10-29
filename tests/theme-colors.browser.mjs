import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1421";
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
const colors = [["薰衣草紫", "purple"], ["暖杏米", "yellow"], ["鼠尾草绿", "green"], ["晴空蓝", "blue"]];
const conversation = () => page.evaluate(() => {
	const selectors = [".workspace", ".chat-header", ".messages", ".composer", ".composer-input"];
	return Object.fromEntries(selectors.map((selector) => {
		const element = document.querySelector(selector);
		if (!element) throw new Error(`Missing conversation element: ${selector}`);
		const style = getComputedStyle(element);
		return [selector, [style.backgroundColor, style.backgroundImage, style.color, style.borderTopColor]];
	}));
});
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
	assert.equal(await page.locator(".settings-theme-color[data-theme-color-option]").count(), 4);
	assert.equal(await page.locator(".settings-theme-color[data-dark-theme-color-option]").count(), 2);
	assert.equal(await button("默认").count(), 0);
	assert.equal(await button("沿用主题色").count(), 0);
	assert.equal(await button("暖杏米").getAttribute("aria-pressed"), "true");
	assert.equal(await button("星空蓝").getAttribute("aria-pressed"), "true");
	await shot("settings-light-default");

	for (const theme of ["light", "dark"]) {
		await button(theme === "light" ? "浅色" : "深色").click();
		await button("暖杏米").click();
		const baseline = await conversation();
		if (theme === "light") assert.equal(baseline[".workspace"][0], "rgb(255, 255, 255)");
		else assert.match(baseline[".workspace"][1], /stars\.svg/);
		const accents = new Set();
		const settingsAccents = new Set();
		const selections = new Set();
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
				selection: getComputedStyle(document.querySelector(".chat-row.selected")).backgroundColor,
				sidebar: getComputedStyle(document.querySelector(".sidebar")).backgroundImage,
				titlebar: getComputedStyle(document.querySelector(".titlebar")).backgroundImage,
			}));
			if (theme === "light") assert.equal(presentation.workspace, "none");
			else assert.match(presentation.workspace, /stars\.svg/);
			assert.deepEqual(await conversation(), baseline, `${theme}/${color}: color selection must not tint the conversation`);
			if (theme === "dark") assert.match(presentation.sidebar, /gradient/);
			if (theme === "light") {
				const surfaces = await page.evaluate(() => [".sidebar", ".msg.user .message-bubble"].map((selector) => getComputedStyle(document.querySelector(selector)).backgroundColor));
				assert.equal(surfaces[0], surfaces[1], "User bubbles must echo the pale sidebar");
			}
			if (theme === "light") assert.ok(!presentation.sidebar.includes("rgb(255, 255, 255)"), "Sidebar gradient must stay tinted across its full height");
			assert.match(presentation.titlebar, /gradient/);
			accents.add(presentation.accent);
			backdrops.add(presentation.titlebar);
			selections.add(presentation.selection);
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
			const settingsPalette = await dialog().evaluate((element) => {
				const style = getComputedStyle(element);
				return Object.fromEntries(["--accent", "--action", "--action-hover", "--action-active", "--selected", "--surface"].map((name) => [name, style.getPropertyValue(name).trim()]));
			});
			settingsAccents.add(settingsPalette["--accent"]);
			for (const background of ["--surface", "--selected"]) assert.ok(contrast(settingsPalette["--accent"], settingsPalette[background]) >= 4.5, `${theme}/${color}: settings selection text contrast`);
			for (const background of ["--action", "--action-hover", "--action-active"]) assert.ok(contrast("#ffffff", settingsPalette[background]) >= 4.5, `${theme}/${color}: settings action contrast`);
			await button("供应商").click();
			const activeFilter = dialog().locator(".provider-status-filter[aria-pressed=true]");
			if (await activeFilter.count()) await activeFilter.click();
			const toggle = dialog().getByRole("checkbox", { name: /^(停用|启用) 官方直连$/ });
			await toggle.waitFor();
			await toggle.check();
			const expectedTrack = settingsPalette["--action"].match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16));
			await page.waitForFunction((rgb) => getComputedStyle(document.querySelector(".settings-dialog .switch input:checked + .slider")).backgroundColor === `rgb(${rgb.join(", ")})`, expectedTrack);
			await shot(`switches-${theme}-${color}`);
			await toggle.uncheck();
			assert.equal(await toggle.isChecked(), false);
			await toggle.check();
			assert.equal(await toggle.isChecked(), true);
			await button("外观").click();
			await close();
			await shot(`homepage-${theme}-${color}`);
			await open();
		}
		assert.equal(accents.size, 1, `${theme}: blue accents must stay stable`);
		assert.equal(settingsAccents.size, theme === "light" ? 4 : 1, `${theme}: controls follow the active mode's palette`);
		assert.equal(selections.size, theme === "light" ? 4 : 1, `${theme}: sidebar selections follow the active mode's palette`);
		assert.equal(backdrops.size, theme === "light" ? 4 : 1, `${theme}: light colors must not change the dark backdrop`);
	}

	await button("鼠尾草绿").click();
	await close();
	await page.evaluate(() => history.replaceState(null, "", "/tests/preview.html?fixture=archive&persist=1"));
	await page.reload();
	await ready();
	assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
	assert.equal(await page.locator("html").getAttribute("data-theme-color"), "green");
	await open();
	assert.equal(await button("深色").getAttribute("aria-pressed"), "true");
	assert.equal(await button("鼠尾草绿").getAttribute("aria-pressed"), "true");
	await button("浅色").click();
	assert.equal(await page.locator("html").getAttribute("data-theme-color"), "green", "Light/dark switching must preserve theme color");
	await button("暖杏米").click();
	assert.equal(await page.locator("html").getAttribute("data-theme-color"), "yellow");

	await page.setViewportSize({ width: 550, height: 375 });
	assert.equal(await dialog().evaluate((element) => element.scrollWidth > element.clientWidth), false);
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await button("晴空蓝").scrollIntoViewIfNeeded();
	await shot("settings-narrow");
	assert.deepEqual(errors, []);
	console.log("PASS theme colors: new defaults, retired options removed, four light palettes, independent dark palette, 4.5:1 contrast, selected states, reload persistence, narrow layout");
} catch (error) {
	await shot("failure");
	console.error(errors);
	throw error;
} finally {
	await browser.close();
}
