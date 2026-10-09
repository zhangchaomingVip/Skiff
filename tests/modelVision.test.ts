import test from "node:test";
import assert from "node:assert/strict";
import { catalogVision } from "../src/chat/modelVision.ts";

const catalog = [
	{ modelId: "glm-5.3", vision: false },
	{ modelId: "glm-5.3-flash", vision: true },
	{ modelId: "kimi-k2.6", vision: true },
];

test("catalog vision distinguishes models in the same family and unknown IDs", () => {
	assert.equal(catalogVision("GLM-5.3", catalog), false);
	assert.equal(catalogVision(" glm-5.3-flash ", catalog), true);
	assert.equal(catalogVision("glm-custom", catalog), undefined);
	assert.equal(catalogVision("", catalog), undefined);
});

test("provider-prefixed relay IDs match catalog capabilities without guessing model variants", () => {
	assert.equal(catalogVision("moonshotai/Kimi-K2.6", catalog), true);
	assert.equal(catalogVision("zai/glm-5.3-flash", catalog), true);
	assert.equal(catalogVision("zai/glm-5.3", catalog), false);
	assert.equal(catalogVision("kimi-k2.6-code", catalog), undefined);
	assert.equal(catalogVision("zai/glm-5.3-flash-special", catalog), undefined);
	assert.equal(catalogVision("zai/glm-5.3", [{ modelId: "zai/glm-5.3", vision: true }, ...catalog]), true);
});
