import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveredRoutes, discoveredFamily } from "../src/chat/providerRoutes.ts";
import { blankModel, blankRelay, blankRoute, type ModelFamily } from "../src/chat/useModelFamilies.ts";

const fillModel = (id: string) => ({ ...blankModel(), modelId: id, inputCost: 1.5, vision: true });

test("Bailian discovery groups direct and namespaced models without changing API IDs", () => {
	const routes = buildDiscoveredRoutes([
		"vanchin/deepseek-v4.1-flash", "deepseek-v4.1-flash", "deepseek-v4.1-flash",
		"kimi/kimi-k2.8-preview", "kimi-k3", "ZHIPU/GLM-5.3-FlashX", "glm-5.3",
		"qwen3.8-max", "MiniMax/MiniMax-M3", "vanchin/deepseek-ocr", "glm-embedding", "",
	], blankRelay(), [], fillModel);
	assert.deepEqual(routes.map((item) => [item.familyId, item.route.models.map((model) => model.modelId)]), [
		["deepseek", ["vanchin/deepseek-v4.1-flash", "deepseek-v4.1-flash"]],
		["kimi", ["kimi/kimi-k2.8-preview", "kimi-k3"]],
		["glm", ["ZHIPU/GLM-5.3-FlashX", "glm-5.3"]],
	]);
	assert.equal(routes[2].route.models[0].inputCost, 1.5);
	assert.equal(routes[2].route.models[0].vision, true);
	assert.equal(routes[0].route.streaming, true);
	assert.equal(routes[0].route.tools, true);
});

test("discovery repairs missing routes, retaining existing models and exclusions", () => {
	const relay = { ...blankRelay(), id: "bailian", excludedModelIds: ["kimi-k3"] };
	const families: ModelFamily[] = [{ id: "deepseek", displayName: "DeepSeek", defaultRouteId: "existing", routes: [{ ...blankRoute(relay.id), id: "existing", enabled: false, models: [fillModel("deepseek-chat")] }] }];
	const original = structuredClone(families);
	const routes = buildDiscoveredRoutes(["deepseek-v4-pro", "kimi-k3", "glm-5.3", " glm-5.3 "], relay, families, fillModel);
	assert.deepEqual(routes.map((item) => item.familyId), ["glm"]);
	assert.equal(routes[0].route.relayId, "bailian");
	assert.equal(routes[0].route.models.length, 1);
	assert.deepEqual(families, original);
});

test("classification uses basename boundaries and accepts legacy family aliases", () => {
	assert.equal(discoveredFamily("vendor/moonshot-v1"), "kimi");
	assert.equal(discoveredFamily("vendor/ChatGLM-6B"), "glm");
	for (const id of ["not-deepseek-chat", "deepseek-ai/qwen-max", "glm4-fake", "deepseek-ocr", "kimi-tts", "glm-rerank"]) {
		assert.equal(discoveredFamily(id), undefined, id);
	}
});
