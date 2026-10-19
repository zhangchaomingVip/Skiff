import test from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveredRoutes, discoveredFamily, routesFromProviderModels } from "../src/chat/providerRoutes.ts";
import { blankModel, blankRelay, blankRoute, type ModelFamily } from "../src/chat/useModelFamilies.ts";

const fillModel = (id: string) => ({ ...blankModel(), modelId: id, inputCost: 1.5, vision: true });
const asDiscovered = (ids: string[]) => ids.map((id) => ({ id, reasoning: false, vision: false, tools: false }));

test("Bailian discovery groups direct and namespaced models without changing API IDs", () => {
	const routes = buildDiscoveredRoutes(asDiscovered([
		"vanchin/deepseek-v4.1-flash", "deepseek-v4.1-flash", "deepseek-v4.1-flash",
		"kimi/kimi-k2.8-preview", "kimi-k3", "ZHIPU/GLM-5.3-FlashX", "glm-5.3",
		"qwen3.8-max", "MiniMax/MiniMax-M3", "vanchin/deepseek-ocr", "glm-embedding", "openrouter/auto", "",
	]), blankRelay(), [], fillModel);
	assert.deepEqual(routes.map((item) => [item.familyId, item.route.models.map((model) => model.modelId)]), [
		["deepseek", ["vanchin/deepseek-v4.1-flash", "deepseek-v4.1-flash"]],
		["kimi", ["kimi/kimi-k2.8-preview", "kimi-k3"]],
		["glm", ["ZHIPU/GLM-5.3-FlashX", "glm-5.3"]],
		["auto", ["openrouter/auto"]],
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
	const routes = buildDiscoveredRoutes(asDiscovered(["deepseek-v4-pro", "kimi-k3", "glm-5.3", " glm-5.3 "]), relay, families, fillModel);
	assert.deepEqual(routes.map((item) => item.familyId), ["glm"]);
	assert.equal(routes[0].route.relayId, "bailian");
	assert.equal(routes[0].route.models.length, 1);
	assert.deepEqual(families, original);
});

test("provider model editor updates existing family routes and preserves excluded models", () => {
	const relay = { ...blankRelay(), id: "relay-a", excludedModelIds: ["deepseek-retired"] };
	const families: ModelFamily[] = [
		{ id: "deepseek", displayName: "DeepSeek", defaultRouteId: "route-deepseek", routes: [{ ...blankRoute(relay.id), id: "route-deepseek", reasoning: true, models: [fillModel("deepseek-chat"), fillModel("deepseek-retired")] }] },
		{ id: "kimi", displayName: "Kimi", defaultRouteId: null, routes: [] },
	];
	const edited = { ...fillModel("deepseek-chat"), alias: "对话模型", contextWindow: 196000 };
	const routes = routesFromProviderModels(relay, families, [
		{ familyId: "deepseek", model: edited },
		{ familyId: "deepseek", model: fillModel("deepseek-v4") },
		{ familyId: "kimi", model: fillModel("kimi-k3") },
	]);
	assert.deepEqual(routes.map((item) => item.familyId), ["deepseek", "kimi"]);
	assert.equal(routes[0].route.id, "route-deepseek");
	assert.equal(routes[0].route.reasoning, true);
	assert.deepEqual(routes[0].route.models.map((model) => model.modelId), ["deepseek-chat", "deepseek-v4", "deepseek-retired"]);
	assert.equal(routes[0].route.models[0].alias, "对话模型");
	assert.equal(routes[0].route.models[0].contextWindow, 196000);
	assert.equal(routes[1].route.id, "");
	assert.deepEqual(families[0].routes[0].models.map((model) => model.modelId), ["deepseek-chat", "deepseek-retired"]);
});

test("classification uses basename boundaries and accepts legacy family aliases", () => {
	assert.equal(discoveredFamily("vendor/moonshot-v1"), "kimi");
	assert.equal(discoveredFamily("vendor/ChatGLM-6B"), "glm");
	// Auto-routing ids without a vendor prefix join the Auto family.
	assert.equal(discoveredFamily("auto"), "auto");
	assert.equal(discoveredFamily("openrouter/auto"), "auto");
	assert.equal(discoveredFamily("vendor/auto-moe"), "auto");
	// Vendor-prefixed auto models stay with their maker's family.
	assert.equal(discoveredFamily("moonshot-v1-auto"), "kimi");
	for (const id of ["not-deepseek-chat", "deepseek-ai/qwen-max", "glm4-fake", "deepseek-ocr", "kimi-tts", "glm-rerank", "autogen", "x-automation"]) {
		assert.equal(discoveredFamily(id), undefined, id);
	}
});

test("recommendation narrows fresh routes to the newest flagship + flash", () => {
	const relay = blankRelay();
	const latest = new Map([
		["glm", { familyId: "glm", modelIds: [], latestGroup: ["glm-5.4", "glm-5.4-flash", "glm-5.4-flashx"], latestVersion: "glm-5.4", updated: new Map() }],
	]);
	const routes = buildDiscoveredRoutes(asDiscovered(["glm-5.4-flashx", "glm-5.4-flash", "glm-5.4", "glm-5.2"]), relay, [], fillModel, latest);
	assert.equal(routes.length, 1);
	assert.deepEqual(routes[0].route.models.map((model) => model.modelId), ["glm-5.4", "glm-5.4-flash"]);
});

test("fresh DeepSeek routes keep the relay's versioned ID when catalog uses a short ID", () => {
	const relay = blankRelay();
	const latest = new Map([
		["deepseek", {
			familyId: "deepseek", modelIds: ["deepseek-flash"], latestGroup: ["deepseek-flash"], latestVersion: "deepseek",
			updated: new Map([["deepseek-flash", "2026-10-17"]]),
			aliases: new Map([["deepseek-flash", ["deepseek-flash", "DeepSeek V4.1 Flash 1017"]]]),
		}],
	]);
	const routes = buildDiscoveredRoutes(asDiscovered(["deepseek-v4.1-flash"]), relay, [], fillModel, latest);
	assert.deepEqual(routes[0].route.models.map((model) => model.modelId), ["deepseek-v4.1-flash"]);
});

test("recommendation falls back to the newest served IDs and keeps every model offline", () => {
	const relay = blankRelay();
	// Relay predates the latest group: catalog freshness ranks the served models.
	const dated = new Map([
		["glm", { familyId: "glm", modelIds: ["glm-5.4"], latestGroup: ["glm-5.4"], latestVersion: "glm-5.4", updated: new Map([["glm-5.3-flash", "2026-08-26"], ["glm-5.2", "2026-06-13"], ["glm-5.3", "2026-08-14"]]) }],
	]);
	const fallback = buildDiscoveredRoutes(asDiscovered(["glm-5.2", "glm-5.3", "glm-5.3-flash"]), relay, [], fillModel, dated);
	assert.deepEqual(fallback[0].route.models.map((model) => model.modelId), ["glm-5.3-flash", "glm-5.3"]);
	// No catalog → current behaviour (every discovered model).
	const offline = buildDiscoveredRoutes(asDiscovered(["glm-5.2", "glm-5.3", "glm-5.3-flash"]), relay, [], fillModel, new Map([["glm", { familyId: "glm", modelIds: [], latestGroup: [], latestVersion: undefined, updated: new Map() }]]));
	assert.equal(offline[0].route.models.length, 3);
});
