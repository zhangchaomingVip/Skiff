import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function themeHarness(saved: unknown, unavailable = false, savedColor: unknown = "default") {
	const listeners = new Map();
	const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
	const media = { matches: true, addEventListener: (_: string, listener: () => void) => listeners.set("media", listener) };
	const writes: string[] = [];
	const stored = new Map([["skiff.theme", saved], ["skiff.themeColor", savedColor]]);
	vm.runInNewContext(source, { document: { documentElement: root }, matchMedia: () => media, localStorage: { getItem: (key: string) => { if (unavailable) throw Error(); return stored.get(key) ?? null; }, setItem: (key: string, value: string) => { if (unavailable) throw Error(); writes.push(`${key}:${value}`); } }, window: { addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), dispatchEvent: () => {} }, Event: class {}, requestAnimationFrame: (fn: () => void) => fn() });
	return { root, media, writes, request: (detail: string) => listeners.get("skiff:theme-request")({ detail }), requestColor: (detail: string) => listeners.get("skiff:theme-color-request")({ detail }), change: (dark: boolean) => { media.matches = dark; listeners.get("media")(); } };
}
test("theme is resolved before React, preserves preferences and follows system only in system mode", () => {
	const light = themeHarness("light");
	assert.equal(light.root.dataset.theme, "light"); light.change(true); assert.equal(light.root.dataset.theme, "light");
	light.request("system"); assert.equal(light.root.dataset.theme, "dark"); light.change(false); assert.equal(light.root.dataset.theme, "light");
	light.request("dark"); light.change(false); assert.equal(light.root.dataset.theme, "dark");
	assert.equal(light.root.style.colorScheme, "dark"); assert.deepEqual(light.writes, ["skiff.theme:system", "skiff.theme:dark"]);
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
	for (const color of ["yellow", "green", "blue", "default"]) {
		value.requestColor(color);
		assert.equal(value.root.dataset.themeColor, color);
		assert.equal(value.root.dataset.theme, "dark");
	}
	assert.deepEqual(value.writes, ["skiff.theme:dark", "skiff.themeColor:yellow", "skiff.themeColor:green", "skiff.themeColor:blue", "skiff.themeColor:default"]);
	value.requestColor("invalid"); assert.equal(value.root.dataset.themeColor, "default");
	assert.equal(themeHarness("light", false, "invalid").root.dataset.themeColor, "default");
	const unavailable = themeHarness("light", true, "green");
	unavailable.requestColor("green"); assert.equal(unavailable.root.dataset.themeColor, "green");
});
