import type { Currency, ModelInfo } from "./types";

/** One selectable provider/model entry as returned by the Rust layer. */
export interface RuntimeOffer {
	offerId?: string;
	legacyRouteIds?: string[];
	legacyProviderKeys?: string[];
	routeId?: string;
	familyId: string;
	familyName: string;
	relayId: string;
	relayName: string;
	/** Stable pi provider key, e.g. `skiff-relay-r1`. */
	providerKey: string;
	modelId: string;
	alias?: string;
	billingAccountId?: string;
	priceMultiplier?: number;
	routeOrder?: number;
	streaming?: boolean;
	tools?: boolean;
	vision?: boolean;
	reasoning?: boolean;
	/** Thinking levels, `off` included: what the picker may offer for this model. */
	thinkingLevels?: string[];
	inputCost: number;
	outputCost: number;
	cacheReadCost?: number;
	cacheWriteCost?: number;
	currency: Currency;
	maxTokens: number;
	contextWindow: number;
}

/** Prefer familiar decimal or binary context sizes over unwieldy decimal fractions. */
export function formatContextWindow(tokens: number): string {
	const millions = tokens >= 1_000_000;
	const suffix = millions ? "M" : "k";
	const decimal = tokens / (millions ? 1_000_000 : 1000);
	if (Number.isInteger(decimal)) return `${decimal}${suffix}`;
	const binary = tokens / (millions ? 1024 * 1024 : 1024);
	return `${Number.isInteger(binary) ? binary : decimal}${suffix}`;
}

/**
 * Turns each runtime offer into a concrete `ModelInfo` value. Offers remain
 * separate even when they expose the same model ID, so the picker can pin the
 * exact provider selected by the user.
 */
export function modelsFromOffers(offers: RuntimeOffer[]): ModelInfo[] {
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

			familyId: resolved.familyId,
			familyName: resolved.familyName,
			relayId: resolved.relayId,
			...(resolved.streaming === undefined ? {} : { streaming: resolved.streaming }),
			...(resolved.tools === undefined ? {} : { tools: resolved.tools }),
			...(resolved.vision === undefined ? {} : { vision: resolved.vision }),
			...(resolved.vision === undefined ? {} : { input: resolved.vision ? ["text", "image"] : ["text"] }),
			...(resolved.reasoning === undefined ? {} : { reasoning: resolved.reasoning }),
			...(resolved.thinkingLevels === undefined ? {} : { thinkingLevels: resolved.thinkingLevels }),
			name: title,
			alias: resolved.alias,
			priceMultiplier: resolved.priceMultiplier,
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
 * Reconciles the live model reported by pi with the family list. Explicit model
 * capabilities, prices and limits take precedence; older offers without capability
 * fields retain pi's values, matched by provider key and model ID.
 */
export function reconcile(current: ModelInfo | undefined, offers: RuntimeOffer[], available: ModelInfo[] = []): ModelInfo[] {
	if (!offers.length) return [];
	return modelsFromOffers(offers).map((model) => {
		const live = current?.provider === model.provider && current.id === model.id ? current : available.find((item) => item.provider === model.provider && item.id === model.id);
		return { ...live, ...model };
	});
}

/**
 * Match only the exact supplier/model or one unambiguous migration alias.
 */
export function resolveSelection(current: ModelInfo | undefined, offers: RuntimeOffer[], _familyId?: string): { offer?: RuntimeOffer; invalidated: boolean } {
	if (!current) return { invalidated: false };
	const id = current.modelId ?? current.id;
	const exact = offers.find((offer) => offer.modelId === id && offer.providerKey === current.provider);
	if (exact) return { offer: exact, invalidated: false };
	const legacy = offers.filter((offer) => offer.modelId === id && offer.legacyProviderKeys?.includes(current.provider)
		&& (!current.routeId || offer.legacyRouteIds?.includes(current.routeId)));
	return { offer: legacy.length === 1 ? legacy[0] : undefined, invalidated: legacy.length !== 1 };
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
