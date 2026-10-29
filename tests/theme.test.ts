import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function themeHarness(saved: unknown, unavailable = false, savedColor: unknown = null, savedDarkColor: unknown = null, savedStars: unknown = null) {
	const listeners = new Map();
	const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
	const media = { matches: true, addEventListener: (_: string, listener: () => void) => listeners.set("media", listener) };
	const writes: string[] = [];
	const stored = new Map([["skiff.theme", saved], ["skiff.themeColor", savedColor], ["skiff.darkThemeColor", savedDarkColor], ["skiff.themeStars", savedStars]]);
	vm.runInNewContext(source, { document: { documentElement: root }, matchMedia: () => media, localStorage: { getItem: (key: string) => { if (unavailable) throw Error(); return stored.get(key) ?? null; }, setItem: (key: string, value: string) => { if (unavailable) throw Error(); writes.push(`${key}:${value}`); } }, window: { addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), dispatchEvent: () => {} }, Event: class {}, requestAnimationFrame: (fn: () => void) => fn() });
	return { root, media, writes, request: (detail: string) => listeners.get("skiff:theme-request")({ detail }), requestColor: (detail: string) => listeners.get("skiff:theme-color-request")({ detail }), requestDarkColor: (detail: string) => listeners.get("skiff:dark-theme-color-request")({ detail }), requestStars: (detail: boolean) => listeners.get("skiff:theme-stars-request")({ detail }), storage: (key: string, newValue: string | null) => listeners.get("storage")({ key, newValue }), change: (dark: boolean) => { media.matches = dark; listeners.get("media")(); } };
}
test("theme is resolved before React, preserves preferences and follows system only in system mode", () => {
	const light = themeHarness("light");
	assert.equal(light.root.dataset.theme, "light"); light.change(true); assert.equal(light.root.dataset.theme, "light");
	light.request("system"); assert.equal(light.root.dataset.theme, "dark"); light.change(false); assert.equal(light.root.dataset.theme, "light");
	light.request("dark"); light.change(false); assert.equal(light.root.dataset.theme, "dark");
	assert.equal(light.root.style.colorScheme, "dark"); assert.deepEqual(light.writes, ["skiff.theme:system", "skiff.theme:dark"]);
});

test("star palettes and visibility restore before paint and survive light/system changes", () => {
	const value = themeHarness("dark", false, "green", "star-blue", "false");
	assert.equal(value.root.dataset.darkThemeColor, "star-blue");
	assert.equal(value.root.dataset.themeStars, "false");
	value.request("light");
	assert.equal(value.root.dataset.themeColor, "green");
	assert.equal(value.root.dataset.darkThemeColor, "star-blue");
	value.requestDarkColor("star-black");
	value.requestStars(true);
	value.request("system");
	value.change(false);
	assert.equal(value.root.dataset.theme, "light");
	value.change(true);
	assert.equal(value.root.dataset.theme, "dark");
	assert.equal(value.root.dataset.darkThemeColor, "star-black");
	assert.equal(value.root.dataset.themeStars, "true");
	assert.ok(value.writes.includes("skiff.darkThemeColor:star-black"));
	assert.ok(value.writes.includes("skiff.themeStars:true"));
	value.requestStars(false);
	assert.ok(value.writes.includes("skiff.themeStars:false"));
});

test("star settings validate storage, sync across windows, and work without storage", () => {
	const value = themeHarness("dark", false, "default", "invalid", "invalid");
	assert.equal(value.root.dataset.darkThemeColor, "star-blue");
	assert.equal(value.root.dataset.themeStars, "true");
	value.storage("skiff.darkThemeColor", "star-blue");
	value.storage("skiff.themeStars", "false");
	assert.equal(value.root.dataset.darkThemeColor, "star-blue");
	assert.equal(value.root.dataset.themeStars, "false");
	value.storage("skiff.darkThemeColor", null);
	value.storage("skiff.themeStars", null);
	assert.equal(value.root.dataset.darkThemeColor, "star-blue");
	assert.equal(value.root.dataset.themeStars, "true");
	value.requestDarkColor("invalid");
	assert.equal(value.root.dataset.darkThemeColor, "star-blue");
	const unavailable = themeHarness("dark", true);
	unavailable.requestDarkColor("star-black");
	unavailable.requestStars(false);
	assert.equal(unavailable.root.dataset.darkThemeColor, "star-black");
	assert.equal(unavailable.root.dataset.themeStars, "false");
});
test("invalid, missing and unavailable theme storage fall back to system and remain usable", () => {
	for (const saved of [null, "invalid", "light"]) {
		const value = themeHarness(saved, saved === "light");
		assert.equal(value.root.dataset.themePreference, "system");
		value.change(false); assert.equal(value.root.dataset.theme, "light");
		value.request("dark"); assert.equal(value.root.dataset.theme, "dark");
	}
});
test("theme colors are independent from light/dark mode and persist valid preferences", () => {
	const value = themeHarness("light", false, "purple");
	assert.equal(value.root.dataset.themeColor, "purple");
	value.request("dark"); assert.equal(value.root.dataset.theme, "dark"); assert.equal(value.root.dataset.themeColor, "purple");
	for (const color of ["yellow", "green", "blue"]) {
		value.requestColor(color);
		assert.equal(value.root.dataset.themeColor, color);
		assert.equal(value.root.dataset.theme, "dark");
	}
	assert.deepEqual(value.writes, ["skiff.theme:dark", "skiff.themeColor:yellow", "skiff.themeColor:green", "skiff.themeColor:blue"]);
	value.requestColor("invalid"); assert.equal(value.root.dataset.themeColor, "yellow");
	assert.equal(themeHarness("light", false, "invalid").root.dataset.themeColor, "yellow");
	const unavailable = themeHarness("light", true, "green");
	unavailable.requestColor("green"); assert.equal(unavailable.root.dataset.themeColor, "green");
});

test("new and retired default palettes resolve to warm apricot and star blue before paint", () => {
	for (const saved of [null, "default", "invalid"]) {
		const value = themeHarness("system", false, saved, saved);
		assert.equal(value.root.dataset.themeColor, "yellow");
		assert.equal(value.root.dataset.darkThemeColor, "star-blue");
		value.change(false);
		assert.equal(value.root.dataset.theme, "light");
		value.change(true);
		assert.equal(value.root.dataset.theme, "dark");
		value.requestColor("default");
		value.requestDarkColor("default");
		assert.equal(value.root.dataset.themeColor, "yellow");
		assert.equal(value.root.dataset.darkThemeColor, "star-blue");
	}
	const unavailable = themeHarness("system", true);
	assert.equal(unavailable.root.dataset.themeColor, "yellow");
	assert.equal(unavailable.root.dataset.darkThemeColor, "star-blue");
	const custom = themeHarness("dark", false, "purple", "star-black", "false");
	assert.equal(custom.root.dataset.themeColor, "purple");
	assert.equal(custom.root.dataset.darkThemeColor, "star-black");
	assert.equal(custom.root.dataset.themeStars, "false");
});
