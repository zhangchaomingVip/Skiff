import test from "node:test";
import assert from "node:assert/strict";
import { imageResolution, imageSizePresets, imageResolutions, maxImageSizes, parseImageSizes } from "../src/workbench/imageSizes.ts";

test("resolution tiers include UHD and high pixel count square/portrait sizes", () => {
	for (const size of ["1024x1024", "1536x864", "864x1536", "1792x768"]) assert.equal(imageResolution(size), "1K");
	for (const size of ["2048x2048", "2560x1440", "1440x2560", "2688x1152"]) assert.equal(imageResolution(size), "2K");
	for (const size of ["3840x2160", "2160x3840", "2880x2880", "2496x3328", "4096x4096"]) assert.equal(imageResolution(size), "4K");
});

test("presets preserve native dimension constraints and fit the combined model size budget", () => {
	const sizes = new Set<string>();
	for (const tier of imageResolutions) for (const size of imageSizePresets[tier]) {
		assert.equal(imageResolution(size), tier);
		const [w, h] = size.split("x").map(Number);
		assert.ok(w >= 256 && h >= 256 && w <= 4096 && h <= 4096);
		assert.ok(w % 16 === 0 && h % 16 === 0 && w <= h * 3 && h <= w * 3);
		sizes.add(size);
	}
	assert.ok(sizes.size <= maxImageSizes);
	assert.deepEqual(parseImageSizes("1024x1024, 2048x2048，1024x1024\n3840x2160"), ["1024x1024", "2048x2048", "3840x2160"]);
});
