import test from "node:test";
import assert from "node:assert/strict";
import { browserViewport } from "../src/browser/viewport";

test("browser viewport follows the panel size and the display scale", () => {
	assert.deepEqual(browserViewport(723, 578, 2), { width: 1446, height: 1156, scale: 1 });
	assert.deepEqual(browserViewport(723, 578, 1), { width: 723, height: 578, scale: 1 });
	assert.deepEqual(browserViewport(720.5, 578.2, 1.5), { width: 1081, height: 867, scale: 1 });
	assert.deepEqual(browserViewport(723, 578, 0.5), { width: 723, height: 578, scale: 1 });
	assert.deepEqual(browserViewport(723, 578, 4), { width: 2169, height: 1734, scale: 1 });
});

test("browser viewport rejects sizes the panel cannot use", () => {
	assert.equal(browserViewport(0, 578, 2), undefined);
	assert.equal(browserViewport(723, 90, 2), undefined);
	assert.equal(browserViewport(1600, 578, 2), undefined);
	assert.equal(browserViewport(Number.NaN, 578, 2), undefined);
	assert.equal(browserViewport(723, 578, Number.POSITIVE_INFINITY), undefined);
});
