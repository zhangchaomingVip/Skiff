import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TYPOGRAPHY, normalizeTypography, readTypographyPreference, saveTypographyPreference } from "../src/typography.ts";

test("font preferences survive storage and reject invalid sizes and families", () => {
	const values = new Map<string, string>();
	const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
	assert.deepEqual(readTypographyPreference(storage), DEFAULT_TYPOGRAPHY);
	saveTypographyPreference({ size: 18, family: "serif" }, storage);
	assert.deepEqual(readTypographyPreference(storage), { size: 18, family: "serif" });
	for (const size of [0, -1, 11, 21, 15.5, NaN, Infinity, "18", null]) assert.equal(normalizeTypography({ size, family: "mono" }).size, 15);
	assert.deepEqual(normalizeTypography({ size: 20, family: "unknown" }), { size: 20, family: "system" });
	for (const value of [null, [], 123, "serif"]) assert.deepEqual(normalizeTypography(value), DEFAULT_TYPOGRAPHY);
});

test("malformed or unavailable font storage falls back without preventing changes", () => {
	assert.deepEqual(readTypographyPreference({ getItem: () => "invalid JSON" }), DEFAULT_TYPOGRAPHY);
	assert.deepEqual(readTypographyPreference({ getItem: () => { throw Error("unavailable"); } }), DEFAULT_TYPOGRAPHY);
	assert.doesNotThrow(() => saveTypographyPreference({ size: 16, family: "sans" }, { setItem: () => { throw Error("quota"); } }));
});
