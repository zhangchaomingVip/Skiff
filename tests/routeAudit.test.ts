import test from "node:test";
import assert from "node:assert/strict";
import { createRouteEvent } from "../src/chat/routeAudit.ts";

const source = { offerId: "route-a/model", routeId: "route-a", familyId: "deepseek", modelId: "model", relayId: "a", relayName: "官方", billingAccountId: "wallet-a" };
const target = { offerId: "route-b/model", routeId: "route-b", familyId: "deepseek", modelId: "model", relayId: "b", relayName: "备用", billingAccountId: "wallet-b" };

test("route events keep switch metadata and redact credentials or request data", () => {
	const event = createRouteEvent({
		timestamp: 123, sessionId: "chat-1", requestId: "request-1", source, target,
		failureKind: "unauthorized", authorization: "once", automatic: true, retried: false, result: "switched",
	});
	assert.deepEqual(event, {
		timestamp: 123, sessionId: "chat-1", requestId: "request-1", source, target,
		failureKind: "unauthorized", crossAccount: true, authorization: "once", automatic: true, retried: false, result: "switched",
	});
	assert.equal("apiKey" in event, false);
	assert.equal(JSON.stringify(event).includes("request body"), false);
});

test("same known account is not marked cross-account; blank accounts are unsafe", () => {
	const same = createRouteEvent({ sessionId: "chat-1", requestId: "request-2", source, target: { ...target, billingAccountId: "wallet-a" }, authorization: "same_account", automatic: true, retried: false, result: "switched" });
	assert.equal(same.crossAccount, false);
	const unknown = createRouteEvent({ sessionId: "chat-1", requestId: "request-3", source: { ...source, billingAccountId: "" }, target: { ...target, billingAccountId: "" }, authorization: "keep_failed", automatic: true, retried: false, result: "denied" });
	assert.equal(unknown.crossAccount, true);
});
