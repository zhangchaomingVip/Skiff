import test from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure, modelsFromOffers, reconcile, needsFallback, nextRoute, isProviderFailure, resolveRoute, resolveSelection, type RuntimeOffer } from "../src/chat/modelFamilies.ts";
import { maskBaseUrl, maskKey, blankRelay, blankRoute, blankModel, validateModels, FAMILY_LABELS } from "../src/chat/useModelFamilies.ts";
import { modelBrand } from "../src/chat/modelDisplay.ts";

const defaults = [{ id: "deepseek", defaultRelayId: "default" }, { id: "kimi", defaultRelayId: "k1" }, { id: "glm", defaultRelayId: null }];
const offer = (familyId: string, relayId: string, overrides: Partial<RuntimeOffer> = {}): RuntimeOffer => ({
	familyId, familyName: FAMILY_LABELS[familyId], relayId,
	relayName: relayId === "low" ? "硅基低价" : "官方直连",
	providerKey: `skiff-relay-${relayId}-${familyId}`, modelId: "deepseek-chat",
	inputCost: 0.3, outputCost: 1.2, currency: "CNY", maxTokens: 8192, contextWindow: 64000, ...overrides,
});

test("same-model routes remain separate selectable offers", () => {
	const offers = [offer("deepseek", "low"), offer("deepseek", "default")];
	const models = modelsFromOffers(offers, defaults);
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
	const models = reconcile(current, [offer("deepseek", "low"), offer("kimi", "k1", { modelId: "kimi-k2" })], [], defaults);
	assert.equal(models[0].providerName, "硅基低价");
	assert.equal(models[0].contextWindow, 64000);
	assert.equal(models[0].reasoning, true);
	assert.equal(models[0].cost?.input, 0.3);
	// The duplicate route entry is not rendered twice.
	assert.equal(models.filter((model) => model.provider === "skiff-relay-low-deepseek").length, 1);
	assert.equal(models.length, 2);
});

test("an empty family list asks the caller to fall back to pi's own models", () => {
	assert.equal(needsFallback([]), true);
	assert.equal(needsFallback([offer("glm", "a")]), false);
	assert.deepEqual(reconcile({ provider: "deepseek", id: "deepseek-chat" }, []).map((model) => model.provider), ["deepseek"]);
});

test("keys and base urls are masked for display", () => {
	assert.equal(maskKey("sk-1234567890abcd"), "…abcd");
	assert.equal(maskKey("abc"), "…abc");
	assert.equal(maskKey(""), "");
	assert.equal(maskBaseUrl("https://api.siliconflow.cn/v1/"), "api.siliconflow.cn/v1");
	assert.equal(maskBaseUrl("https://relay.example.com/customer-secret/v1"), "relay.example.com/…");
	assert.equal(maskBaseUrl("not a url"), "not a url");
	assert.equal(blankRelay().enabled, true);
	assert.equal(blankRelay().timeoutSeconds, 60);
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

test("failover follows the next route serving the same model without wraparound", () => {
	const offers = [offer("deepseek", "a"), offer("kimi", "x", { modelId: "kimi-k2" }), offer("deepseek", "b"), offer("deepseek", "c", { modelId: "deepseek-reasoner" })];
	assert.equal(nextRoute({ provider: "skiff-relay-a-deepseek", id: "deepseek-chat" }, offers)?.providerKey, "skiff-relay-b-deepseek");
	// The last route offering the model has no backup, and other models do not inherit one.
	assert.equal(nextRoute({ provider: "skiff-relay-b-deepseek", id: "deepseek-chat" }, offers), undefined);
	assert.equal(nextRoute({ provider: "skiff-relay-x-kimi", id: "kimi-k2" }, offers), undefined);
	for (const error of ["401 Unauthorized", "429 Too Many Requests", "503 unavailable", "fetch failed", "提供商请求超时（5 秒）"]) assert.equal(isProviderFailure(error), true);
	for (const error of ["400 invalid input", "项目目录不存在", "用户取消请求"]) assert.equal(isProviderFailure(error), false);
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

test("failover filters candidates by request capabilities and route order", () => {
	const offers = [
		offer("deepseek", "a", { routeId: "route-a", routeOrder: 0, vision: true, tools: true, reasoning: true, streaming: true }),
		offer("deepseek", "b", { routeId: "route-b", routeOrder: 1, vision: false, tools: true, reasoning: true, streaming: true }),
		offer("deepseek", "c", { routeId: "route-c", routeOrder: 2, vision: true, tools: true, reasoning: true, streaming: true }),
	];
	const current = { provider: offers[0].providerKey, id: offers[0].modelId, routeId: "route-a", vision: true, tools: true, reasoning: true, streaming: true };
	assert.equal(nextRoute(current, offers, { streaming: true, vision: true, tools: true, reasoning: true }), offers[2]);
	assert.equal(nextRoute({ ...current, routeId: "route-c" }, offers), undefined);
});

test("picker order stays stable when a later route is selected or disabled", () => {
	const current = { provider: "skiff-relay-b-deepseek", id: "deepseek-chat", contextWindow: 64000 };
	const models = reconcile(current, [offer("deepseek", "a", { modelId: "deepseek-flash" }), offer("deepseek", "b")], [], defaults);
	assert.deepEqual(models.map((model) => model.provider), ["skiff-relay-a-deepseek", "skiff-relay-b-deepseek"]);
	assert.equal(models[1].contextWindow, 64000);
	assert.equal(reconcile(current, [offer("deepseek", "a")], [], defaults).length, 1);
});

test("three models share a route while keeping their own limits, prices and selection", () => {
	const offers = [offer("deepseek", "relay", { modelId: "deepseek-flash", inputCost: 1, contextWindow: 32000 }), offer("deepseek", "relay"), offer("deepseek", "relay", { modelId: "deepseek-reasoner", inputCost: 4, maxTokens: 16384, contextWindow: 256000 })];
	const current = { provider: offers[2].providerKey, id: offers[2].modelId, contextWindow: 42 };
	assert.equal(resolveSelection(current, offers, "deepseek").offer, offers[2]);
	assert.equal(resolveSelection(current, offers, "deepseek").invalidated, false);
	const models = reconcile(current, offers, [], defaults);
	assert.deepEqual(models.map((model) => model.id), offers.map((offer) => offer.modelId));
	assert.equal(models[2].contextWindow, 256000);
	assert.equal(models[2].maxTokens, 16384);
	assert.equal(models[2].cost?.input, 4);
});

test("deleted models/routes fall back to the first available model in the same family", () => {
	const current = { provider: "skiff-relay-deleted-deepseek", id: "deepseek-reasoner" };
	const offers = [offer("kimi", "first", { modelId: "kimi-k2" }), offer("deepseek", "relay", { modelId: "deepseek-flash" }), offer("deepseek", "relay")];
	const fallback = resolveSelection(current, offers, "deepseek");
	assert.equal(fallback.offer, offers[1]); assert.equal(fallback.invalidated, true);
	assert.equal(resolveSelection(current, [], "deepseek").offer, undefined);
	assert.equal(resolveSelection({ provider: offers[2].providerKey, id: offers[2].modelId }, offers.slice(0, 2), "deepseek").offer, offers[1]);
});

test("invalidated pinned routes prefer the same model on the default route", () => {
	const offers = [offer("deepseek", "first"), offer("deepseek", "default")];
	const current = { provider: "skiff-relay-gone-deepseek", id: "deepseek-chat", routeId: "route-gone" };
	const resolved = resolveSelection(current, offers, "deepseek", [{ id: "deepseek", defaultRouteId: "default" }]);
	assert.equal(resolved.offer, offers[1]);
	assert.equal(resolved.invalidated, true);
});

test("model rows validate IDs and integer limits independently", () => {
	const first = { ...blankModel(), modelId: "deepseek-chat" };
	assert.equal(validateModels([first]), undefined);
	for (const rows of [[], [blankModel()], [first, { ...first, modelId: " deepseek-chat " }], [{ ...first, contextWindow: 0 }], [{ ...first, maxTokens: 1.5 }], [{ ...first, maxTokens: 128001 }]]) assert.ok(validateModels(rows));
});

test("initial selection and invalid selections honor the default route", () => {
	const offers = [offer("deepseek", "first"), offer("deepseek", "default")];
	assert.equal(resolveSelection(undefined, offers, "deepseek", defaults).offer, offers[1]);
	assert.equal(resolveSelection({ provider: "skiff-relay-gone-deepseek", id: "removed" }, offers, "deepseek", defaults).offer, offers[1]);
});
