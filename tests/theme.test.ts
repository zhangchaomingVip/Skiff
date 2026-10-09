import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/theme-init.js", import.meta.url), "utf8");
function themeHarness(saved: unknown, unavailable = false) {
	const listeners = new Map();
	const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
	const media = { matches: true, addEventListener: (_: string, listener: () => void) => listeners.set("media", listener) };
	const writes: string[] = [];
	vm.runInNewContext(source, { document: { documentElement: root }, matchMedia: () => media, localStorage: { getItem: () => { if (unavailable) throw Error(); return saved; }, setItem: (_: string, value: string) => { if (unavailable) throw Error(); writes.push(value); } }, window: { addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener), dispatchEvent: () => {} }, Event: class {}, requestAnimationFrame: (fn: () => void) => fn() });
	return { root, media, writes, request: (detail: string) => listeners.get("skiff:theme-request")({ detail }), change: (dark: boolean) => { media.matches = dark; listeners.get("media")(); } };
}
test("theme is resolved before React, preserves preferences and follows system only in system mode", () => {
	const light = themeHarness("light");
	assert.equal(light.root.dataset.theme, "light"); light.change(true); assert.equal(light.root.dataset.theme, "light");
	light.request("system"); assert.equal(light.root.dataset.theme, "dark"); light.change(false); assert.equal(light.root.dataset.theme, "light");
	light.request("dark"); light.change(false); assert.equal(light.root.dataset.theme, "dark");
	assert.equal(light.root.style.colorScheme, "dark"); assert.deepEqual(light.writes, ["system", "dark"]);
});
test("invalid, missing and unavailable theme storage fall back to system and remain usable", () => {
	for (const saved of [null, "invalid", "light"]) {
		const value = themeHarness(saved, saved === "light");
		assert.equal(value.root.dataset.themePreference, "system");
		value.change(false); assert.equal(value.root.dataset.theme, "light");
		value.request("dark"); assert.equal(value.root.dataset.theme, "dark");
	}
});
