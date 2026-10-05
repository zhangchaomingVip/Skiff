import test from "node:test";
import assert from "node:assert/strict";
import { reduce } from "../src/chat/reducer.ts";
import { snapshotForOffer, snapshotForResponse } from "../src/chat/routeSnapshot.ts";
import { initialSessionState, type ModelInfo } from "../src/chat/types.ts";
import type { RuntimeOffer } from "../src/chat/modelFamilies.ts";

const offer: RuntimeOffer = {
	offerId: "route-r1/deepseek-chat",
	routeId: "route-r1",
	familyId: "deepseek",
	familyName: "DeepSeek",
	relayId: "r1",
	relayName: "官方直连",
	providerKey: "skiff-relay-r1-deepseek",
	modelId: "deepseek-chat",
	alias: "便宜版",
	billingAccountId: "wallet-a",
	inputCost: 1,
	outputCost: 4,
	cacheReadCost: .2,
	cacheWriteCost: .5,
	currency: "CNY",
	maxTokens: 8192,
	contextWindow: 64000,
};

test("route snapshots contain identity, account, and all prices without credentials", () => {
	assert.deepEqual(snapshotForOffer(offer), {
		offerId: "route-r1/deepseek-chat", routeId: "route-r1", providerKey: "skiff-relay-r1-deepseek",
		familyId: "deepseek", familyName: "DeepSeek", modelId: "deepseek-chat", alias: "便宜版",
		relayId: "r1", relayName: "官方直连", billingAccountId: "wallet-a", currency: "CNY",
		inputCost: 1, outputCost: 4, cacheReadCost: .2, cacheWriteCost: .5,
	});
	assert.equal(JSON.stringify(snapshotForOffer(offer)).includes("apiKey"), false);
});

test("completed assistant responses match the actual provider and model offer", () => {
	const current: ModelInfo = { provider: offer.providerKey, id: offer.modelId, routeId: offer.routeId, modelId: offer.modelId };
	assert.deepEqual(snapshotForResponse({ provider: offer.providerKey, model: offer.modelId }, current, [offer]), snapshotForOffer(offer));
	assert.equal(snapshotForResponse({ provider: "other", model: offer.modelId }, current, [offer]), undefined);
});

test("the reducer attaches a route snapshot only when the assistant response maps to an offer", () => {
	let state = { ...initialSessionState, model: { provider: offer.providerKey, id: offer.modelId, routeId: offer.routeId, modelId: offer.modelId } };
	state = reduce(state, { type: "message_start", message: { role: "assistant", provider: offer.providerKey, model: offer.modelId } }, { offers: [offer] });
	state = reduce(state, { type: "message_end", message: { role: "assistant", provider: offer.providerKey, model: offer.modelId, content: "完成" } }, { offers: [offer] });
	assert.deepEqual(state.messages[0].routeSnapshot, snapshotForOffer(offer));

	const unknown = reduce(initialSessionState, { type: "message_end", message: { role: "assistant", provider: "custom", model: "local", content: "完成" } }, { offers: [offer] });
	assert.equal(unknown.messages[0].routeSnapshot, undefined);
});
