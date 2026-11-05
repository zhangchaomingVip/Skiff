import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure, formatContextWindow, modelsFromOffers, reconcile, isProviderFailure, resolveSelection, type RuntimeOffer } from "../src/chat/modelFamilies.ts";
import { maskBaseUrl, maskKey, blankRelay, blankRoute, blankModel, validateModels, FAMILY_LABELS } from "../src/chat/useModelFamilies.ts";
import { modelBrand } from "../src/chat/modelDisplay.ts";

const offer = (familyId: string, relayId: string, overrides: Partial<RuntimeOffer> = {}): RuntimeOffer => ({
	familyId, familyName: FAMILY_LABELS[familyId], relayId,
	relayName: relayId === "low" ? "硅基低价" : "官方直连",
	providerKey: `skiff-relay-${relayId}-${familyId}`, modelId: "deepseek-chat",
	inputCost: 0.3, outputCost: 1.2, currency: "CNY", maxTokens: 8192, contextWindow: 64000, ...overrides,
});

test("same-model routes remain separate selectable offers", () => {
	const offers = [offer("deepseek", "low"), offer("deepseek", "default")];
	const models = modelsFromOffers(offers);
	assert.deepEqual(models.map((model) => [model.provider, model.id, model.providerName]), [
		["skiff-relay-low-deepseek", "deepseek-chat", "硅基低价"],
		["skiff-relay-default-deepseek", "deepseek-chat", "官方直连"],
	]);
	assert.deepEqual(models[0].cost, { input: 0.3, output: 1.2, cacheRead: undefined, cacheWrite: undefined });
	assert.deepEqual(models.map((model) => model.name), ["deepseek-chat · 硅基低价", "deepseek-chat · 官方直连"]);
});

test("offer aliases become labels while route and offer identities stay distinct", () => {
	const offers = [
		offer("deepseek", "cheap", { routeId: "route-cheap", offerId: "route-cheap/deepseek-chat", alias: "便宜版", relayName: "硅基低价" }),
		offer("deepseek", "fast", { routeId: "route-fast", offerId: "route-fast/deepseek-chat", alias: "便宜版" }),
	];
	const models = modelsFromOffers(offers);
	assert.deepEqual(models.map((model) => model.name), ["便宜版 · 硅基低价", "便宜版 · 官方直连"]);
	assert.deepEqual(offers.map((item) => item.offerId), ["route-cheap/deepseek-chat", "route-fast/deepseek-chat"]);
});

test("the live model keeps pi's capabilities but gains the relay name and price", () => {
	const current = { provider: "skiff-relay-low-deepseek", id: "deepseek-chat", name: "deepseek-chat", contextWindow: 64000, reasoning: true };
	const models = reconcile(current, [offer("deepseek", "low"), offer("kimi", "k1", { modelId: "kimi-k2" })]);
	assert.equal(models[0].providerName, "硅基低价");
	assert.equal(models[0].contextWindow, 64000);
	assert.equal(models[0].reasoning, true);
	assert.equal(models[0].cost?.input, 0.3);
	// The duplicate route entry is not rendered twice.
	assert.equal(models.filter((model) => model.provider === "skiff-relay-low-deepseek").length, 1);
	assert.equal(models.length, 2);
});



test("vision routes expose image input before pi model metadata arrives", () => {
	const vision = offer("kimi", "vision", { modelId: "kimi-k2.6", vision: true });
	const text = offer("kimi", "text", { modelId: "kimi-k2.6", vision: false });
	assert.deepEqual(modelsFromOffers([vision, text]).map((model) => model.input), [["text", "image"], ["text"]]);
	assert.deepEqual(reconcile({ provider: vision.providerKey, id: vision.modelId }, [vision])[0].input, ["text", "image"]);
});

test("route vision changes override stale pi input metadata in both directions", () => {
	const configured = offer("kimi", "relay", { modelId: "kimi-k3", vision: true });
	const current = { provider: configured.providerKey, id: configured.modelId, input: ["text"] };
	assert.deepEqual(reconcile(current, [configured])[0].input, ["text", "image"]);
	const disabled = { ...configured, vision: false };
	const stale = { ...current, input: ["text", "image"] };
	assert.deepEqual(reconcile(stale, [disabled])[0].input, ["text"]);
	assert.deepEqual(reconcile(undefined, [disabled], [stale])[0].input, ["text"]);
});

test("legacy offers preserve pi image input on selection and restoration", () => {
	const legacy = offer("kimi", "relay", { modelId: "kimi-k2.6" });
	const live = { provider: legacy.providerKey, id: legacy.modelId, input: ["text", "image"] };
	assert.deepEqual(reconcile(live, [legacy])[0].input, ["text", "image"]);
	assert.deepEqual(reconcile(undefined, [legacy], [live])[0].input, ["text", "image"]);
});

test("keys and base urls are masked for display", () => {
	assert.equal(maskKey("sk-1234567890abcd"), "…abcd");
	assert.equal(maskKey("abc"), "…abc");
	assert.equal(maskKey(""), "");
	assert.equal(maskBaseUrl("https://api.siliconflow.cn/v1/"), "api.siliconflow.cn/v1");
	assert.equal(maskBaseUrl("https://relay.example.com/customer-secret/v1"), "relay.example.com/…");
	assert.equal(maskBaseUrl("not a url"), "not a url");
	assert.equal(blankRelay().enabled, true);
	assert.equal(blankRelay().timeoutSeconds, 300);
	assert.equal(blankRoute().streaming, true);
	assert.equal(blankRoute().tools, true);
	assert.equal(blankRoute().vision, false);
	assert.equal(blankRoute("r1").relayId, "r1");
});

test("brand marks cover the three families", () => {
	assert.equal(modelBrand("skiff-relay-r1-deepseek"), "deepseek");
	assert.equal(modelBrand("kimi-k2"), "kimi");
	assert.equal(modelBrand("glm-4.6"), "glm");
	assert.equal(modelBrand(), undefined);
});



test("failure classification excludes user and configuration errors", () => {
	assert.equal(classifyProviderFailure("429 Too Many Requests"), "rate_limit");
	assert.equal(classifyProviderFailure("503 service unavailable"), "server");
	assert.equal(classifyProviderFailure("401 Unauthorized"), "unauthorized");
	assert.equal(classifyProviderFailure("请求超时"), "timeout");
	assert.equal(classifyProviderFailure("400 invalid parameter"), "non_retryable");
	assert.equal(classifyProviderFailure("上下文超限"), "non_retryable");
	assert.equal(classifyProviderFailure("用户取消请求"), "non_retryable");
	assert.equal(isProviderFailure("ECONNRESET"), true);
});



test("picker order stays stable when a later route is selected or disabled", () => {
	const current = { provider: "skiff-relay-b-deepseek", id: "deepseek-chat", contextWindow: 64000 };
	const models = reconcile(current, [offer("deepseek", "a", { modelId: "deepseek-flash" }), offer("deepseek", "b")]);
	assert.deepEqual(models.map((model) => model.provider), ["skiff-relay-a-deepseek", "skiff-relay-b-deepseek"]);
	assert.equal(models[1].contextWindow, 64000);
	assert.equal(reconcile(current, [offer("deepseek", "a")]).length, 1);
});

test("three models share a route while keeping their own limits, prices and selection", () => {
	const offers = [offer("deepseek", "relay", { modelId: "deepseek-flash", inputCost: 1, contextWindow: 32000 }), offer("deepseek", "relay"), offer("deepseek", "relay", { modelId: "deepseek-reasoner", inputCost: 4, maxTokens: 16384, contextWindow: 256000 })];
	const current = { provider: offers[2].providerKey, id: offers[2].modelId, contextWindow: 42 };
	assert.equal(resolveSelection(current, offers, "deepseek").offer, offers[2]);
	assert.equal(resolveSelection(current, offers, "deepseek").invalidated, false);
	const models = reconcile(current, offers);
	assert.deepEqual(models.map((model) => model.id), offers.map((offer) => offer.modelId));
	assert.equal(models[2].contextWindow, 256000);
	assert.equal(models[2].maxTokens, 16384);
	assert.equal(models[2].cost?.input, 4);
});





test("model rows validate IDs and integer limits independently", () => {
	const first = { ...blankModel(), modelId: "deepseek-chat" };
	assert.equal(validateModels([first]), undefined);
	for (const rows of [[], [blankModel()], [first, { ...first, modelId: " deepseek-chat " }], [{ ...first, contextWindow: 0 }], [{ ...first, maxTokens: 1.5 }], [{ ...first, maxTokens: 128001 }]]) assert.ok(validateModels(rows));
});

test("context windows prefer familiar decimal and binary sizes", () => {
	assert.equal(formatContextWindow(1_048_576), "1M");
	assert.equal(formatContextWindow(131_072), "128k");
	assert.equal(formatContextWindow(128_000), "128k");
	assert.equal(formatContextWindow(1_000_000), "1M");
	assert.equal(formatContextWindow(1_500_000), "1.5M");
});



for (const reason of ["disabled", "deleted", "config load failure", "request failure"]) test(`${reason} never substitutes another provider or model`, () => {
	const current = { provider: "skiff-relay-a", id: "shared", routeId: "old-a" };
	const other = offer("deepseek", "b", { providerKey: "skiff-relay-b", modelId: "shared" });
	assert.deepEqual(resolveSelection(current, [other]), { offer: undefined, invalidated: true });
	assert.deepEqual(resolveSelection(current, []), { offer: undefined, invalidated: true });
	assert.equal(resolveSelection(undefined, [other]).offer, undefined);
	assert.deepEqual(reconcile(current, []), []);
});

test("historical route aliases resolve exactly within their original provider", () => {
	const first = offer("kimi", "a", { providerKey: "skiff-relay-a", modelId: "shared", legacyProviderKeys: ["skiff-relay-a-kimi"], legacyRouteIds: ["old-a"] });
	const second = offer("kimi", "b", { providerKey: "skiff-relay-b", modelId: "shared", legacyProviderKeys: ["skiff-relay-b-kimi"], legacyRouteIds: ["old-b"] });
	assert.equal(resolveSelection({ provider: "skiff-relay-a-kimi", id: "shared", routeId: "old-a" }, [second, first]).offer, first);
	assert.equal(resolveSelection({ provider: "skiff-relay-a-kimi", id: "shared", routeId: "old-b" }, [second, first]).offer, undefined);
	assert.equal(resolveSelection({ provider: "skiff-relay-a-kimi", id: "shared" }, [second]).offer, undefined);
	assert.equal(modelsFromOffers([first])[0].routeId, undefined);
	assert.equal(resolveSelection({ provider: "skiff-relay-b", id: "shared" }, [first, second]).offer, second);
});
