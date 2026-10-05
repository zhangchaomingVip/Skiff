import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRouteEvents } from "../src/chat/routeAudit.ts";
import { normalizeRouteSnapshots, normalizeSelectedModel } from "../src/chat/workspace.ts";

test("selected model keeps legacy provider/id and optional pinned offer identity", () => {
	assert.deepEqual(normalizeSelectedModel({ provider: "skiff-relay-r1-kimi", id: "kimi-k3" }), { provider: "skiff-relay-r1-kimi", id: "kimi-k3" });
	assert.deepEqual(normalizeSelectedModel({ provider: "skiff-relay-r1-kimi", id: "kimi-k3", routeId: "route-kimi-r1", modelId: "kimi-k3", offerId: "route-kimi-r1/kimi-k3", ignored: 1 }), {
		provider: "skiff-relay-r1-kimi", id: "kimi-k3", routeId: "route-kimi-r1", modelId: "kimi-k3", offerId: "route-kimi-r1/kimi-k3",
	});
	assert.equal(normalizeSelectedModel({ provider: "skiff-relay-r1-kimi" }), undefined);
});

test("route snapshot metadata is normalized and strips unknown or malformed fields", () => {
	assert.deepEqual(normalizeRouteSnapshots([{
		offerId: "route/deepseek-chat", providerKey: "provider", familyId: "deepseek", familyName: "DeepSeek", modelId: "deepseek-chat",
		relayId: "r1", relayName: "官方", billingAccountId: "wallet-a", currency: "CNY", inputCost: 1, outputCost: 4,
		apiKey: "must-drop",
	}, null, { providerKey: "broken" }]), [{
		offerId: "route/deepseek-chat", providerKey: "provider", familyId: "deepseek", familyName: "DeepSeek", modelId: "deepseek-chat",
		relayId: "r1", relayName: "官方", billingAccountId: "wallet-a", currency: "CNY", inputCost: 1, outputCost: 4,
	}, null, null]);
	assert.equal(normalizeRouteSnapshots("bad"), undefined);
});

test("route event metadata is normalized without accepting request contents", () => {
	const events = normalizeRouteEvents([{ timestamp: 1, sessionId: "chat", requestId: "req", source: { modelId: "m", relayName: "a", apiKey: "secret" }, target: { modelId: "m", relayName: "b" }, crossAccount: true, authorization: "once", automatic: true, retried: false, result: "switched", body: "secret" }]);
	assert.deepEqual(events?.[0], { timestamp: 1, sessionId: "chat", requestId: "req", source: { modelId: "m", relayName: "a" }, target: { modelId: "m", relayName: "b" }, crossAccount: true, authorization: "once", automatic: true, retried: false, result: "switched" });
});
