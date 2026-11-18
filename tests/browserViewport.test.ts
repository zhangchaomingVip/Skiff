import test from "node:test";
import assert from "node:assert/strict";
import { browserViewport, browserZoomLevels, isBrowserZoom, nextBrowserZoom } from "../src/browser/viewport";

test("browser viewport lays the page out in the panel's CSS pixels and keeps device density", () => {
	assert.deepEqual(browserViewport(723, 578, 2), { width: 723, height: 578, scale: 2 });
	assert.deepEqual(browserViewport(723, 578, 1), { width: 723, height: 578, scale: 1 });
	assert.deepEqual(browserViewport(720.5, 578.2, 1.5), { width: 721, height: 578, scale: 1.5 });
	assert.deepEqual(browserViewport(723, 578, 0.5), { width: 723, height: 578, scale: 1 });
	assert.deepEqual(browserViewport(723, 578, 4), { width: 723, height: 578, scale: 2 });
});

test("zoom narrows the viewport so the page grows instead of the picture", () => {
	assert.deepEqual(browserViewport(723, 578, 2, 2), { width: 362, height: 289, scale: 2 });
	assert.deepEqual(browserViewport(723, 578, 2, 0.5), { width: 1446, height: 1156, scale: 2 });
	assert.deepEqual(browserViewport(723, 578, 1, 1.25), { width: 578, height: 462, scale: 1 });
});

test("device scale stays inside the stream's pixel budget", () => {
	assert.deepEqual(browserViewport(1600, 578, 2), { width: 1600, height: 578, scale: 1.87 });
	assert.deepEqual(browserViewport(1600, 578, 2, 2), { width: 800, height: 289, scale: 2 });
	// 4000 CSS pixels cannot fit any device scale at or above 1.
	assert.equal(browserViewport(2000, 578, 1, 0.5), undefined);
});

test("browser viewport rejects sizes the panel cannot use", () => {
	assert.equal(browserViewport(0, 578, 2), undefined);
	assert.equal(browserViewport(723, 90, 2), undefined);
	assert.equal(browserViewport(Number.NaN, 578, 2), undefined);
	assert.equal(browserViewport(723, 578, Number.POSITIVE_INFINITY), undefined);
	assert.equal(browserViewport(723, 578, 2, Number.NaN), undefined);
});

test("zoom steps stay on the offered levels and stop at both ends", () => {
	assert.equal(browserZoomLevels[0], 0.5);
	assert.equal(browserZoomLevels[browserZoomLevels.length - 1], 2);
	assert.equal(nextBrowserZoom(1, 1), 1.1);
	assert.equal(nextBrowserZoom(1, -1), 0.9);
	assert.equal(nextBrowserZoom(0.5, -1), 0.5);
	assert.equal(nextBrowserZoom(2, 1), 2);
	assert.equal(isBrowserZoom(1.1), true);
	assert.equal(isBrowserZoom(1.2), false);
	assert.equal(isBrowserZoom("1"), false);
});
