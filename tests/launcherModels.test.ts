import test from "node:test";
import assert from "node:assert/strict";
import { groupLauncherOffers, recentLauncherOfferIds } from "../src/chat/launcherModels.ts";
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

test("Launcher recovers recent offers from historical route snapshots", () => {
	const current = offer({ offerId: "route-a/model-a" });
	const ids = recentLauncherOfferIds([{ id: "chat-1", projectId: "project", title: "旧会话", updatedAt: 1, hasMessages: true, routeSnapshots: [{ providerKey: current.providerKey, familyId: current.familyId, familyName: current.familyName, modelId: current.modelId, relayId: current.relayId, relayName: current.relayName, currency: current.currency, inputCost: current.inputCost, outputCost: current.outputCost }] }], [current]);
	assert.deepEqual([...ids], ["route-a/model-a"]);
});

test("Launcher recovers legacy recent selections by provider and model", () => {
	const current = offer({ providerKey: "skiff-glm", familyId: "glm", familyName: "GLM", modelId: "glm-5.3-flash", offerId: "route-glm/glm-5.3-flash" });
	const ids = recentLauncherOfferIds([{ id: "chat-1", projectId: "project", title: "旧会话", updatedAt: 1, hasMessages: true, selectedModel: { provider: "skiff-glm", id: "glm-5.3-flash" } }], [current]);
	assert.deepEqual([...ids], ["route-glm/glm-5.3-flash"]);
});
