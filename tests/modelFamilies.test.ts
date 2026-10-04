import test from "node:test";
import assert from "node:assert/strict";
import { channelId, modelsFromOffers, reconcile, needsFallback, nextProvider, isProviderFailure, resolveSelection, type RuntimeOffer } from "../src/chat/modelFamilies.ts";
import { maskBaseUrl, maskKey, blankProvider, blankModel, validateModels, FAMILY_LABELS } from "../src/chat/useModelFamilies.ts";
import { familyFromProvider, modelBrand } from "../src/chat/modelDisplay.ts";

const offer = (familyId: string, providerId: string, overrides: Partial<RuntimeOffer> = {}): RuntimeOffer => ({
	familyId, familyName: FAMILY_LABELS[familyId], providerId,
	displayName: providerId === "low" ? "硅基低价" : "官方直连",
	providerKey: `skiff-${familyId}-${providerId}`, modelId: "deepseek-chat",
	inputCost: 0.3, outputCost: 1.2, currency: "CNY", maxTokens: 8192, contextWindow: 64000, ...overrides,
});

test("provider keys resolve back to their channel and family", () => {
	assert.equal(channelId("skiff-deepseek-p123"), "p123");
	assert.equal(channelId("skiff-glm-p9"), "p9");
	assert.equal(channelId("skiff-kimi-p1"), "p1");
	assert.equal(channelId("deepseek"), undefined);
	assert.equal(channelId("skiff-unknown-p1"), undefined);
	assert.equal(familyFromProvider("skiff-kimi-p1")?.id, "kimi");
	assert.equal(familyFromProvider("skiff-glm-p2")?.label, "GLM");
	assert.equal(familyFromProvider("openai"), undefined);
});

test("offers become picker entries labelled with the user's channel name", () => {
	const models = modelsFromOffers([offer("deepseek", "low"), offer("deepseek", "official")]);
	assert.deepEqual(models.map((model) => [model.provider, model.id, model.providerName]), [
		["skiff-deepseek-low", "deepseek-chat", "硅基低价"],
		["skiff-deepseek-official", "deepseek-chat", "官方直连"],
	]);
	assert.deepEqual(models[0].cost, { input: 0.3, output: 1.2 });
});

test("the live model keeps pi's capabilities but gains the channel name and price", () => {
	const current = { provider: "skiff-deepseek-low", id: "deepseek-chat", name: "deepseek-chat", contextWindow: 64000, reasoning: true };
	const models = reconcile(current, [offer("deepseek", "low"), offer("deepseek", "official")]);
	assert.equal(models[0].providerName, "硅基低价");
	assert.equal(models[0].contextWindow, 64000);
	assert.equal(models[0].reasoning, true);
	assert.equal(models[0].cost?.input, 0.3);
	// The duplicate channel entry is not rendered twice.
	assert.equal(models.filter((model) => model.provider === "skiff-deepseek-low").length, 1);
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
	assert.equal(blankProvider().streaming, true);
	assert.equal(blankProvider().enabled, true);
	assert.equal(blankProvider().timeoutSeconds, 60);
});

test("brand marks cover the three families and legacy provider names", () => {
	assert.equal(modelBrand("skiff-deepseek-p1"), "deepseek");
	assert.equal(modelBrand("moonshot"), "kimi");
	assert.equal(modelBrand("zhipu"), "glm");
	assert.equal(modelBrand(), undefined);
});

test("switching after a provider error follows family priority and wraps around", () => {
	const offers = [offer("deepseek", "a"), offer("kimi", "x"), offer("deepseek", "b"), offer("deepseek", "c")];
	assert.equal(nextProvider({ provider: "skiff-deepseek-b", id: "deepseek-chat" }, offers)?.provider, "skiff-deepseek-c");
	assert.equal(nextProvider({ provider: "skiff-deepseek-c", id: "deepseek-chat" }, offers)?.provider, "skiff-deepseek-a");
	assert.equal(nextProvider({ provider: "skiff-kimi-x", id: "kimi-k2" }, offers), undefined);
	for (const error of ["401 Unauthorized", "429 Too Many Requests", "503 unavailable", "fetch failed", "提供商请求超时（5 秒）"]) assert.equal(isProviderFailure(error), true);
	for (const error of ["400 invalid input", "项目目录不存在", "用户取消请求"]) assert.equal(isProviderFailure(error), false);
});

test("picker order stays stable when a later channel is selected or disabled", () => {
	const current = { provider: "skiff-deepseek-b", id: "deepseek-chat", contextWindow: 64000 };
	const models = reconcile(current, [offer("deepseek", "a"), offer("deepseek", "b")]);
	assert.deepEqual(models.map((model) => model.provider), ["skiff-deepseek-a", "skiff-deepseek-b"]);
	assert.equal(models[1].contextWindow, 64000);
	assert.equal(reconcile(current, [offer("deepseek", "a")]).length, 1);
});

test("three models share a channel while keeping their own limits, prices and selection", () => {
	const offers = [offer("deepseek", "relay", { modelId: "deepseek-flash", inputCost: 1, contextWindow: 32000 }), offer("deepseek", "relay"), offer("deepseek", "relay", { modelId: "deepseek-reasoner", inputCost: 4, maxTokens: 16384, contextWindow: 256000 })];
	const current = { provider: offers[2].providerKey, id: offers[2].modelId, contextWindow: 42 };
	assert.equal(resolveSelection(current, offers, "deepseek").offer, offers[2]);
	assert.equal(resolveSelection(current, offers, "deepseek").invalidated, false);
	const models = reconcile(current, offers);
	assert.deepEqual(models.map((model) => model.id), offers.map((offer) => offer.modelId));
	assert.equal(models[2].contextWindow, 256000);
	assert.equal(models[2].maxTokens, 16384);
	assert.equal(models[2].cost?.input, 4);
	assert.equal(nextProvider(models[0], offers)?.id, "deepseek-chat");
	assert.equal(nextProvider(models[2], offers)?.id, "deepseek-flash");
});

test("deleted models/channels fall back to the first available model in the same family", () => {
	const current = { provider: "skiff-deepseek-deleted", id: "deepseek-reasoner" };
	const offers = [offer("kimi", "first", { modelId: "kimi-k2" }), offer("deepseek", "relay", { modelId: "deepseek-flash" }), offer("deepseek", "relay")];
	const fallback = resolveSelection(current, offers, "deepseek");
	assert.equal(fallback.offer, offers[1]); assert.equal(fallback.invalidated, true);
	assert.equal(resolveSelection(current, [], "deepseek").offer, undefined);
	assert.equal(resolveSelection({ provider: offers[2].providerKey, id: offers[2].modelId }, offers.slice(0, 2), "deepseek").offer, offers[1]);
});

test("model rows validate IDs and integer limits independently", () => {
	const first = { ...blankModel(), modelId: "deepseek-chat" };
	assert.equal(validateModels([first]), undefined);
	for (const rows of [[], [blankModel()], [first, { ...first, modelId: " deepseek-chat " }], [{ ...first, contextWindow: 0 }], [{ ...first, maxTokens: 1.5 }], [{ ...first, maxTokens: 128001 }]]) assert.ok(validateModels(rows));
});

test("initial selection honors the default channel, while invalid selections fall back by order", () => {
	const offers = [offer("deepseek", "first"), offer("deepseek", "default")];
	const defaults = [{ id: "deepseek", defaultProviderId: "default" }];
	assert.equal(resolveSelection(undefined, offers, "deepseek", defaults).offer, offers[1]);
	assert.equal(resolveSelection({ provider: "skiff-deepseek-gone", id: "removed" }, offers, "deepseek", defaults).offer, offers[0]);
});
