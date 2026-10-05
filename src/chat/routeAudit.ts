import type { ProviderFailureKind } from "./modelFamilies";

export interface AuditRouteRef {
	offerId?: string;
	routeId?: string;
	familyId?: string;
	modelId: string;
	relayId?: string;
	relayName: string;
	billingAccountId?: string;
}

export type RouteAuthorizationMode = "same_account" | "once" | "session" | "keep_failed" | "none" | "stale";
export type RouteEventResult = "switched" | "denied" | "failed" | "stale";

export interface RouteEvent {
	timestamp: number;
	sessionId: string;
	requestId: string;
	source?: AuditRouteRef;
	target?: AuditRouteRef;
	failureKind?: ProviderFailureKind;
	crossAccount: boolean;
	authorization: RouteAuthorizationMode;
	automatic: boolean;
	retried: boolean;
	result: RouteEventResult;
}

function cleanAccountId(accountId: string | undefined): string | undefined {
	const value = accountId?.trim();
	return value || undefined;
}

function copyRoute(route: AuditRouteRef | undefined): AuditRouteRef | undefined {
	if (!route) return undefined;
	return {
		...(route.offerId ? { offerId: route.offerId } : {}),
		...(route.routeId ? { routeId: route.routeId } : {}),
		...(route.familyId ? { familyId: route.familyId } : {}),
		modelId: route.modelId,
		...(route.relayId ? { relayId: route.relayId } : {}),
		relayName: route.relayName,
		...(cleanAccountId(route.billingAccountId) ? { billingAccountId: cleanAccountId(route.billingAccountId) } : {}),
	};
}

function isCrossAccount(source: AuditRouteRef | undefined, target: AuditRouteRef | undefined): boolean {
	const sourceAccount = cleanAccountId(source?.billingAccountId);
	const targetAccount = cleanAccountId(target?.billingAccountId);
	return !sourceAccount || !targetAccount || sourceAccount !== targetAccount;
}

/** Build a redacted audit event from route metadata only. */
export function createRouteEvent(input: Omit<RouteEvent, "timestamp" | "source" | "target" | "crossAccount"> & { timestamp?: number; source?: AuditRouteRef; target?: AuditRouteRef }): RouteEvent {
	return {
		timestamp: input.timestamp ?? Date.now(),
		sessionId: input.sessionId,
		requestId: input.requestId,
		source: copyRoute(input.source),
		target: copyRoute(input.target),
		...(input.failureKind ? { failureKind: input.failureKind } : {}),
		crossAccount: isCrossAccount(input.source, input.target),
		authorization: input.authorization,
		automatic: input.automatic,
		retried: input.retried,
		result: input.result,
	};
}

function normalizeRouteRef(value: unknown): AuditRouteRef | undefined {
	if (!value || typeof value !== "object") return undefined;
	const route = value as Record<string, unknown>;
	if (typeof route.modelId !== "string" || typeof route.relayName !== "string") return undefined;
	return copyRoute({
		...(typeof route.offerId === "string" ? { offerId: route.offerId } : {}),
		...(typeof route.routeId === "string" ? { routeId: route.routeId } : {}),
		...(typeof route.familyId === "string" ? { familyId: route.familyId } : {}),
		modelId: route.modelId,
		...(typeof route.relayId === "string" ? { relayId: route.relayId } : {}),
		relayName: route.relayName,
		...(typeof route.billingAccountId === "string" ? { billingAccountId: route.billingAccountId } : {}),
	});
}

export function normalizeRouteEvents(value: unknown): RouteEvent[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.flatMap((item) => {
		if (!item || typeof item !== "object") return [];
		const event = item as Record<string, unknown>;
		if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp) || typeof event.sessionId !== "string" || typeof event.requestId !== "string" || typeof event.crossAccount !== "boolean" || typeof event.automatic !== "boolean" || typeof event.retried !== "boolean" || !["same_account", "once", "session", "keep_failed", "none", "stale"].includes(String(event.authorization)) || !["switched", "denied", "failed", "stale"].includes(String(event.result))) return [];
		const source = normalizeRouteRef(event.source);
		const target = normalizeRouteRef(event.target);
		const failureKind = ["network", "timeout", "rate_limit", "server", "unauthorized", "non_retryable"].includes(String(event.failureKind)) ? event.failureKind as ProviderFailureKind : undefined;
		return [{
			timestamp: event.timestamp, sessionId: event.sessionId, requestId: event.requestId, source, target,
			...(failureKind ? { failureKind } : {}), crossAccount: event.crossAccount,
			authorization: event.authorization as RouteAuthorizationMode, automatic: event.automatic, retried: event.retried, result: event.result as RouteEventResult,
		}];
	});
}
