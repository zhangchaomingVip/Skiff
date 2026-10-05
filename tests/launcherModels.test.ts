import test from "node:test";
import assert from "node:assert/strict";
import { groupLauncherOffers } from "../src/chat/launcherModels.ts";
import type { RuntimeOffer } from "../src/chat/modelFamilies.ts";

const offer = (patch: Partial<RuntimeOffer> = {}): RuntimeOffer => ({
	offerId: "route-a/model-a", routeId: "route-a", familyId: "deepseek", familyName: "DeepSeek", relayId: "relay-a", relayName: "线路 A", providerKey: "provider-a", modelId: "model-a", inputCost: 1, outputCost: 2, currency: "CNY", maxTokens: 1000, contextWindow: 10000, routeOrder: 1, ...patch,
});

test("Launcher groups same model offers while preserving route choices", () => {
	const models = groupLauncherOffers([offer(), offer({ offerId: "route-b/model-a", routeId: "route-b", relayId: "relay-b", relayName: "线路 B", providerKey: "provider-b", routeOrder: 2 }), offer()]);
	assert.equal(models.length, 1);
	assert.equal(models[0].offers.length, 2);
	assert.equal(models[0].defaultOffer.routeId, "route-a");
});

test("Launcher defaults follow the configured family route", () => {
	const models = groupLauncherOffers([
		offer({ offerId: "route-b/model-a", routeId: "route-b", relayId: "relay-b", relayName: "线路 B", providerKey: "provider-b", routeOrder: 2 }),
		offer({ routeOrder: 1 }),
	], [{ id: "deepseek", defaultRouteId: "route-b" }]);
	assert.equal(models[0].defaultOffer.routeId, "route-b");
});

test("Launcher drops malformed offers without inventing a card", () => {
	assert.deepEqual(groupLauncherOffers([{ ...offer(), modelId: "" }]), []);
});
