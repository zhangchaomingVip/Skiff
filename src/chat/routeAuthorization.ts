/**
 * Pure state machine for route switches that may change the billing account.
 *
 * Keeping this separate from React makes the safety rule explicit: callers
 * must wait for an `allow` result before invoking `setModel`.
 */

export interface AuthorizationRoute {
	familyId?: string;
	familyName?: string;
	modelId: string;
	offerId?: string;
	routeId?: string;
	relayName: string;
	billingAccountId?: string | null;
}

export type RouteAuthorizationChoice = "once" | "session" | "keep_failed";
export type RouteAuthorizationKind = "same_route" | "same_account" | "session" | "once";

export interface RouteAuthorizationRequest {
	requestId: string;
	source: AuthorizationRoute;
	target: AuthorizationRoute;
	targetAccountKey: string;
}

export interface RouteAuthorizationState {
	sessionId: string;
	sessionAccountKeys: string[];
	pending?: RouteAuthorizationRequest;
}

export interface RouteAuthorizationPrompt {
	request: RouteAuthorizationRequest;
	actions: readonly [
		{ id: "once"; label: "同意" },
		{ id: "session"; label: "本次会话都同意" },
		{ id: "keep_failed"; label: "保持失败" },
	];
}

export type RouteAuthorizationEffect =
	| { kind: "allow"; authorization: RouteAuthorizationKind; source: AuthorizationRoute; target: AuthorizationRoute; systemMessage: string }
	| { kind: "prompt"; prompt: RouteAuthorizationPrompt; systemMessage: string }
	| { kind: "deny"; source: AuthorizationRoute; target: AuthorizationRoute; systemMessage: string }
	| { kind: "stale"; systemMessage: string };

export interface RouteAuthorizationTransition {
	state: RouteAuthorizationState;
	effect: RouteAuthorizationEffect;
}

const PROMPT_ACTIONS: RouteAuthorizationPrompt["actions"] = [
	{ id: "once", label: "同意" },
	{ id: "session", label: "本次会话都同意" },
	{ id: "keep_failed", label: "保持失败" },
];

function cleanAccountId(accountId: string | null | undefined): string | undefined {
	const value = accountId?.trim();
	return value || undefined;
}

function routeKey(route: AuthorizationRoute): string {
	return route.offerId ?? route.routeId ?? `${route.familyId ?? "?"}/${route.relayName}/${route.modelId}`;
}

/** Empty or unknown accounts are deliberately scoped to a concrete route. */
function accountKey(route: AuthorizationRoute): string {
	const accountId = cleanAccountId(route.billingAccountId);
	return accountId ? `account:${accountId}` : `unknown:${routeKey(route)}`;
}

function accountLabel(route: AuthorizationRoute): string {
	return cleanAccountId(route.billingAccountId) ?? "未知账户";
}

function routeLabel(route: AuthorizationRoute): string {
	const family = route.familyName ?? route.familyId;
	return [family, route.modelId, route.relayName].filter(Boolean).join(" · ");
}

function sameKnownAccount(source: AuthorizationRoute, target: AuthorizationRoute): boolean {
	const sourceAccount = cleanAccountId(source.billingAccountId);
	const targetAccount = cleanAccountId(target.billingAccountId);
	return !!sourceAccount && sourceAccount === targetAccount;
}

function requestId(source: AuthorizationRoute, target: AuthorizationRoute): string {
	return `${routeKey(source)}=>${routeKey(target)}=>${accountKey(target)}`;
}

export function createRouteAuthorizationState(sessionId: string): RouteAuthorizationState {
	return { sessionId, sessionAccountKeys: [] };
}

function allow(source: AuthorizationRoute, target: AuthorizationRoute, authorization: RouteAuthorizationKind): RouteAuthorizationEffect {
	const suffix = authorization === "same_account" ? `（同一扣费账户：${accountLabel(target)}）` : authorization === "session" ? "（本次会话已授权目标账户）" : "（已获得本次切换授权）";
	return { kind: "allow", authorization, source, target, systemMessage: `已切换到 ${routeLabel(target)}${suffix}` };
}

/**
 * Starts a route switch. A prompt is returned before any model/session
 * mutation is allowed. Repeated failures for the same target reuse the same
 * pending request; a changed target replaces it and invalidates old clicks.
 */
export function requestRouteSwitch(state: RouteAuthorizationState, source: AuthorizationRoute, target: AuthorizationRoute): RouteAuthorizationTransition {
	if (routeKey(source) === routeKey(target)) return { state: { ...state, pending: undefined }, effect: allow(source, target, "same_route") };
	if (sameKnownAccount(source, target)) return { state: { ...state, pending: undefined }, effect: allow(source, target, "same_account") };
	const targetAccountKey = accountKey(target);
	if (state.sessionAccountKeys.includes(targetAccountKey)) return { state: { ...state, pending: undefined }, effect: allow(source, target, "session") };
	const nextRequest: RouteAuthorizationRequest = { requestId: requestId(source, target), source, target, targetAccountKey };
	const pending = state.pending?.requestId === nextRequest.requestId ? state.pending : nextRequest;
	const nextState = { ...state, pending };
	return {
		state: nextState,
		effect: {
			kind: "prompt",
			prompt: { request: pending, actions: PROMPT_ACTIONS },
			systemMessage: `线路切换可能改为由 ${accountLabel(target)} 扣费：${routeLabel(source)} → ${routeLabel(target)}`,
		},
	};
}

/** Resolves a visible prompt. A stale button cannot authorize a newer target. */
export function resolveRouteAuthorization(state: RouteAuthorizationState, requestIdValue: string, choice: RouteAuthorizationChoice): RouteAuthorizationTransition {
	const pending = state.pending;
	if (!pending || pending.requestId !== requestIdValue) return { state, effect: { kind: "stale", systemMessage: "线路授权已失效，请重新确认当前目标线路。" } };
	if (choice === "keep_failed") return {
		state: { ...state, pending: undefined },
		effect: { kind: "deny", source: pending.source, target: pending.target, systemMessage: `保持当前线路失败，未切换到 ${routeLabel(pending.target)}。` },
	};
	const authorization: RouteAuthorizationKind = choice === "session" ? "session" : "once";
	const sessionAccountKeys = choice === "session" && !state.sessionAccountKeys.includes(pending.targetAccountKey)
		? [...state.sessionAccountKeys, pending.targetAccountKey]
		: state.sessionAccountKeys;
	return {
		state: { ...state, sessionAccountKeys, pending: undefined },
		effect: allow(pending.source, pending.target, authorization),
	};
}

/** Session-scoped approvals are intentionally discarded when a chat session ends. */
export function clearRouteAuthorization(_state: RouteAuthorizationState, sessionId: string): RouteAuthorizationState {
	return createRouteAuthorizationState(sessionId);
}

export function billingAccountLabel(route: AuthorizationRoute): string {
	return accountLabel(route);
}
