import type { Currency, ModelInfo } from "./types";

/** One selectable (family, relay, model) entry as returned by the Rust layer. */
export interface RuntimeOffer {
	offerId?: string;
	routeId?: string;
	familyId: string;
	familyName: string;
	relayId: string;
	relayName: string;
	/** pi provider key for this route, e.g. `skiff-relay-r1-deepseek`. */
	providerKey: string;
	modelId: string;
	alias?: string;
	billingAccountId?: string;
	routeOrder?: number;
	streaming?: boolean;
	tools?: boolean;
	vision?: boolean;
	reasoning?: boolean;
	inputCost: number;
	outputCost: number;
	cacheReadCost?: number;
	cacheWriteCost?: number;
	currency: Currency;
	maxTokens: number;
	contextWindow: number;
}

/** Family defaults used when resolving an unpinned family/model request. */
export type FamilyDefaults = { id: string; defaultRouteId?: string | null; defaultRelayId?: string | null }[];

/**
 * Picks the concrete route for a (family, model): the family's default relay
 * first, then the route order the offers arrive in.
 */
export function resolveRoute(offers: RuntimeOffer[], familyId: string, modelId: string, defaults: FamilyDefaults = []): RuntimeOffer | undefined {
	const candidates = offers.filter((offer) => offer.familyId === familyId && offer.modelId === modelId);
	if (!candidates.length) return undefined;
	const preferred = defaults.find((family) => family.id === familyId);
	const defaultRouteId = preferred?.defaultRouteId ?? preferred?.defaultRelayId;
	return candidates.find((offer) => (offer.routeId ?? offer.relayId) === defaultRouteId || offer.relayId === defaultRouteId) ?? candidates[0];
}

/**
 * Turns each runtime offer into a concrete `ModelInfo` value. Offers remain
 * separate even when they expose the same model ID, so the picker can pin the
 * exact route selected by the user.
 */
export function modelsFromOffers(offers: RuntimeOffer[], _defaults: FamilyDefaults = []): ModelInfo[] {
	const unique = new Map<string, RuntimeOffer>();
	for (const offer of offers) unique.set(offer.offerId ?? `${offer.familyId}/${offer.routeId ?? offer.relayId}/${offer.modelId}`, offer);
	const concrete = [...unique.values()];
	const titles = new Map<string, number>();
	for (const offer of concrete) {
		const title = (offer.alias || offer.modelId).trim().toLocaleLowerCase();
		titles.set(title, (titles.get(title) ?? 0) + 1);
	}
	return concrete.map((resolved) => {
		const baseTitle = resolved.alias || resolved.modelId;
		const title = (titles.get(baseTitle.trim().toLocaleLowerCase()) ?? 0) > 1 ? `${baseTitle} · ${resolved.relayName}` : baseTitle;
		return {
			provider: resolved.providerKey,
			id: resolved.modelId,
			modelId: resolved.modelId,
			offerId: resolved.offerId,
			routeId: resolved.routeId,
			familyId: resolved.familyId,
			familyName: resolved.familyName,
			relayId: resolved.relayId,
			...(resolved.streaming === undefined ? {} : { streaming: resolved.streaming }),
			...(resolved.tools === undefined ? {} : { tools: resolved.tools }),
			...(resolved.vision === undefined ? {} : { vision: resolved.vision }),
			...(resolved.vision === undefined ? {} : { input: resolved.vision ? ["text", "image"] : ["text"] }),
			...(resolved.reasoning === undefined ? {} : { reasoning: resolved.reasoning }),
			name: title,
			providerName: resolved.relayName,
			billingAccountId: resolved.billingAccountId,
			cost: { input: resolved.inputCost, output: resolved.outputCost, cacheRead: resolved.cacheReadCost, cacheWrite: resolved.cacheWriteCost },
			currency: resolved.currency,
			maxTokens: resolved.maxTokens,
			contextWindow: resolved.contextWindow,
		};
	});
}

/**
 * Reconciles the live model reported by pi with the family list. Explicit route
 * capabilities, prices and limits take precedence; older offers without capability
 * fields retain pi's values, matched by provider key and model ID.
 */
export function reconcile(current: ModelInfo | undefined, offers: RuntimeOffer[], available: ModelInfo[] = [], defaults: FamilyDefaults = []): ModelInfo[] {
	if (!offers.length) return available.length ? available : current ? [current] : [];
	return modelsFromOffers(offers, defaults).map((model) => {
		const live = current?.provider === model.provider && current.id === model.id ? current : available.find((item) => item.provider === model.provider && item.id === model.id);
		return { ...live, ...model };
	});
}

/**
 * Selection is pinned: the exact route must still exist. Otherwise fall back
 * within the family by same model, then default relay, then route order.
 */
export function resolveSelection(current: ModelInfo | undefined, offers: RuntimeOffer[], familyId?: string, defaults: FamilyDefaults = []): { offer?: RuntimeOffer; invalidated: boolean } {
	const targetModelId = current?.modelId ?? current?.id;
	const pinned = current?.routeId && offers.find((offer) => offer.routeId === current.routeId && offer.modelId === targetModelId);
	if (pinned) return { offer: pinned, invalidated: false };
	const exact = offers.find((offer) => offer.providerKey === current?.provider && offer.modelId === targetModelId);
	if (exact) return { offer: exact, invalidated: false };
	const invalidated = !!current?.provider.startsWith("skiff-");
	const sameFamily = offers.filter((offer) => offer.familyId === familyId);
	const preferred = defaults.find((family) => family.id === familyId);
	const defaultRouteId = preferred?.defaultRouteId ?? preferred?.defaultRelayId;
	const sameModel = sameFamily.filter((offer) => offer.modelId === targetModelId);
	const fallback = sameModel.find((offer) => (offer.routeId ?? offer.relayId) === defaultRouteId || offer.relayId === defaultRouteId)
		?? sameModel[0]
		?? sameFamily.find((offer) => (offer.routeId ?? offer.relayId) === defaultRouteId || offer.relayId === defaultRouteId)
		?? sameFamily[0]
		?? offers.find((offer) => offer.modelId === targetModelId)
		?? offers[0];
	if (invalidated) return { offer: fallback, invalidated: true };
	return { offer: sameModel[0]
		?? sameFamily.find((offer) => (offer.routeId ?? offer.relayId) === defaultRouteId || offer.relayId === defaultRouteId)
		?? sameFamily[0]
		?? offers.find((offer) => offer.modelId === targetModelId)
		?? offers[0], invalidated: false };
}

/**
 * Failover: the next route of the same family that serves the same model ID.
 * There is no wraparound; none means "no backup route".
 */
export interface RouteRequirements {
	streaming?: boolean;
	tools?: boolean;
	vision?: boolean;
	reasoning?: boolean;
}

export function nextRoute(current: ModelInfo, offers: RuntimeOffer[], requirements: RouteRequirements = {}): RuntimeOffer | undefined {
	const index = offers.findIndex((offer) => (current.routeId ? offer.routeId === current.routeId : offer.providerKey === current.provider) && offer.modelId === (current.modelId ?? current.id));
	if (index < 0) return undefined;
	const familyId = offers[index].familyId;
	const modelId = offers[index].modelId;
	const order = offers[index].routeOrder ?? index;
	return offers.find((offer, candidateIndex) => offer.familyId === familyId && offer.modelId === modelId && (offer.routeOrder ?? candidateIndex) > order
		&& (!requirements.streaming || offer.streaming === true)
		&& (!requirements.tools || offer.tools === true)
		&& (!requirements.vision || offer.vision === true)
		&& (!requirements.reasoning || offer.reasoning === true));
}

export type ProviderFailureKind = "network" | "timeout" | "rate_limit" | "server" | "unauthorized" | "non_retryable";

export function classifyProviderFailure(error: string): ProviderFailureKind {
	if (/\b429\b|too many requests|rate limit|频率限制/i.test(error)) return "rate_limit";
	if (/\b5\d\d\b|bad gateway|service unavailable|server error|服务端错误/i.test(error)) return "server";
	if (/\b401\b|unauthorized|invalid api key|凭据|未授权/i.test(error)) return "unauthorized";
	if (/timeout|timed out|ETIMEDOUT|请求超时|超时/i.test(error)) return "timeout";
	if (/network|fetch failed|connection|connect|ECONN|ENOTFOUND|网络|无法连接/i.test(error)) return "network";
	return "non_retryable";
}

export function isProviderFailure(error: string): boolean {
	return classifyProviderFailure(error) !== "non_retryable";
}

/** True when the picker should fall back to pi's own model list. */
export function needsFallback(offers: RuntimeOffer[]): boolean {
	return offers.length === 0;
}
