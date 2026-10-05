import test from "node:test";
import assert from "node:assert/strict";
import { billingAccountLabel, clearRouteAuthorization, createRouteAuthorizationState, requestRouteSwitch, resolveRouteAuthorization, type AuthorizationRoute } from "../src/chat/routeAuthorization.ts";

const route = (relayName: string, billingAccountId: string | null | undefined, routeId = relayName): AuthorizationRoute => ({
	familyId: "deepseek",
	familyName: "DeepSeek",
	modelId: "deepseek-chat",
	offerId: `${routeId}/deepseek-chat`,
	routeId,
	relayName,
	billingAccountId,
});

test("same billing account silently allows the switch and reports the target", () => {
	const state = createRouteAuthorizationState("chat-1");
	const transition = requestRouteSwitch(state, route("官方", "wallet-a", "r1"), route("备用", "wallet-a", "r2"));
	assert.equal(transition.effect.kind, "allow");
	if (transition.effect.kind === "allow") {
		assert.equal(transition.effect.authorization, "same_account");
		assert.match(transition.effect.systemMessage, /备用/);
		assert.match(transition.effect.systemMessage, /wallet-a/);
	}
	assert.equal(transition.state.pending, undefined);
});

test("different, empty, and unknown accounts require all three explicit actions", () => {
	for (const [sourceAccount, targetAccount] of [["wallet-a", "wallet-b"], ["wallet-a", ""], [undefined, undefined]] as const) {
		const transition = requestRouteSwitch(createRouteAuthorizationState("chat-1"), route("当前", sourceAccount, "r1"), route("目标", targetAccount, "r2"));
		assert.equal(transition.effect.kind, "prompt");
		if (transition.effect.kind === "prompt") {
			assert.deepEqual(transition.effect.prompt.actions.map((action) => [action.id, action.label]), [
				["once", "同意"], ["session", "本次会话都同意"], ["keep_failed", "保持失败"],
			]);
			assert.match(transition.effect.systemMessage, /目标/);
		}
	}
});

test("authorization is resolved before a caller is allowed to invoke setModel", () => {
	let setModelCalls = 0;
	let state = createRouteAuthorizationState("chat-1");
	const source = route("当前", "wallet-a", "r1");
	const target = route("目标", "wallet-b", "r2");
	const pending = requestRouteSwitch(state, source, target);
	state = pending.state;
	assert.equal(pending.effect.kind, "prompt");
	if (pending.effect.kind === "allow") setModelCalls += 1;
	assert.equal(setModelCalls, 0);

	const denied = resolveRouteAuthorization(state, pending.effect.kind === "prompt" ? pending.effect.prompt.request.requestId : "", "keep_failed");
	state = denied.state;
	if (denied.effect.kind === "allow") setModelCalls += 1;
	assert.equal(denied.effect.kind, "deny");
	assert.equal(setModelCalls, 0);
	assert.equal(state.pending, undefined);
});

test("once authorization expires immediately while session authorization covers the target account", () => {
	const source = route("当前", "wallet-a", "r1");
	const target = route("目标", "wallet-b", "r2");
	let state = createRouteAuthorizationState("chat-1");
	const first = requestRouteSwitch(state, source, target);
	assert.equal(first.effect.kind, "prompt");
	const firstRequestId = first.effect.kind === "prompt" ? first.effect.prompt.request.requestId : "";
	state = resolveRouteAuthorization(first.state, firstRequestId, "once").state;
	assert.equal(requestRouteSwitch(state, source, target).effect.kind, "prompt");

	const sessionPrompt = requestRouteSwitch(state, source, target);
	const sessionRequestId = sessionPrompt.effect.kind === "prompt" ? sessionPrompt.effect.prompt.request.requestId : "";
	state = resolveRouteAuthorization(sessionPrompt.state, sessionRequestId, "session").state;
	const reused = requestRouteSwitch(state, source, target);
	assert.equal(reused.effect.kind, "allow");
	if (reused.effect.kind === "allow") assert.equal(reused.effect.authorization, "session");

	const reopened = clearRouteAuthorization(state, "chat-2");
	assert.deepEqual(reopened.sessionAccountKeys, []);
	assert.equal(requestRouteSwitch(reopened, source, target).effect.kind, "prompt");
});

test("repeated errors reuse a pending prompt, and a changed target invalidates old approval clicks", () => {
	const source = route("当前", "wallet-a", "r1");
	const targetA = route("目标 A", "wallet-b", "r2");
	const targetB = route("目标 B", "wallet-c", "r3");
	let state = createRouteAuthorizationState("chat-1");
	const first = requestRouteSwitch(state, source, targetA);
	assert.equal(first.effect.kind, "prompt");
	const firstRequestId = first.effect.kind === "prompt" ? first.effect.prompt.request.requestId : "";
	const repeated = requestRouteSwitch(first.state, source, targetA);
	assert.equal(repeated.effect.kind, "prompt");
	assert.equal(repeated.state.pending?.requestId, firstRequestId);

	const changed = requestRouteSwitch(repeated.state, source, targetB);
	assert.equal(changed.effect.kind, "prompt");
	const stale = resolveRouteAuthorization(changed.state, firstRequestId, "once");
	assert.equal(stale.effect.kind, "stale");
	assert.equal(stale.state.pending?.target.relayName, "目标 B");
});

test("blank account labels are explicit", () => {
	assert.equal(billingAccountLabel(route("目标", " ")), "未知账户");
});
