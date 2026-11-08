import test from "node:test";
import assert from "node:assert/strict";
import { modelFromDiscovery } from "../src/chat/modelDiscoveryDefaults.ts";
import { blankModel } from "../src/chat/useModelFamilies.ts";

test("provider IDs are kept verbatim and missing metadata uses editable defaults", () => {
	for (const id of ["deepseek-v4-1-flash-1017-uncensored", "vendor/custom-alias", "private model"]) {
		const model = modelFromDiscovery({ id });
		assert.equal(model.modelId, id);
		assert.equal(model.contextWindow, blankModel().contextWindow);
		assert.equal(model.maxTokens, blankModel().maxTokens);
		assert.equal(model.vision, false);
		assert.equal(model.tools, true);
		assert.equal(model.reasoning, true);
		assert.equal(model.inputCost, 0);
		assert.equal(model.outputCost, 0);
	}
});

test("provider metadata supplies capabilities and bounds output without public catalog data", () => {
	const model = modelFromDiscovery({ id: "custom", vision: true, tools: false, reasoning: false, streaming: false, contextWindow: 4096, maxTokens: 8000 });
	assert.equal(model.contextWindow, 4096);
	assert.equal(model.maxTokens, 4096);
	assert.equal(model.vision, true);
	assert.equal(model.tools, false);
	assert.equal(model.reasoning, false);
	assert.equal(model.streaming, false);
	assert.equal(modelFromDiscovery({ id: "custom", contextWindow: -1, maxTokens: Infinity }).contextWindow, 128000);
	assert.equal(modelFromDiscovery({ id: "large", contextWindow: 1000000, maxTokens: 1000000 }).maxTokens, 8192, "An advertised output ceiling does not reserve the entire context by default");
});
