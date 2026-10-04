import type { Currency, ModelInfo } from "./types";

/** One selectable (family, channel, model) entry as returned by the Rust layer. */
export interface RuntimeOffer {
	familyId: string;
	familyName: string;
	providerId: string;
	displayName: string;
	/** pi provider id for this channel, e.g. `skiff-deepseek-p123`. */
	providerKey: string;
	modelId: string;
	inputCost: number;
	outputCost: number;
	currency: Currency;
	maxTokens: number;
	contextWindow: number;
	legacyProvider?: string | null;
}

/** Channel id parsed back out of a `skiff-<family>-<channel>` pi provider key. */
export function channelId(providerKey: string): string | undefined {
	if (!providerKey.startsWith("skiff-")) return undefined;
	for (const family of ["deepseek", "kimi", "glm"]) {
		const prefix = `skiff-${family}-`;
		if (providerKey.startsWith(prefix)) return providerKey.slice(prefix.length) || undefined;
	}
	return undefined;
}

/**
 * Turns the family runtime view into `ModelInfo` values the rest of the app
 * already speaks. Only the live model has to match pi's response; the rest are
 * display metadata for the picker.
 */
export function modelsFromOffers(offers: RuntimeOffer[]): ModelInfo[] {
	return offers.map((offer) => ({
		provider: offer.providerKey,
		id: offer.modelId,
		// Keep the model label separate from the provider grouping label.
		name: offer.modelId,
		providerName: offer.displayName,
		cost: { input: offer.inputCost, output: offer.outputCost },
		currency: offer.currency,
		maxTokens: offer.maxTokens,
		contextWindow: offer.contextWindow,
	}));
}

/**
 * Reconciles the live model reported by pi with the family list. The live entry
 * carries capabilities pi resolved from models.json (vision and reasoning). Prices and
 * limits come from the configured model, matched by provider key and model ID.
 */
export function reconcile(current: ModelInfo | undefined, offers: RuntimeOffer[], available: ModelInfo[] = []): ModelInfo[] {
	if (!offers.length) return available.length ? available : current ? [current] : [];
	return modelsFromOffers(offers).map((model) => {
		const live = current?.provider === model.provider && current.id === model.id ? current : available.find((item) => item.provider === model.provider && item.id === model.id);
		return { ...live, ...model };
	});
}

/** Resolve by both channel and model, then fall back in configured order. */
export function resolveSelection(current: ModelInfo | undefined, offers: RuntimeOffer[], familyId?: string, defaults: { id: string; defaultProviderId: string | null }[] = []): { offer?: RuntimeOffer; invalidated: boolean } {
	const exact = offers.find((offer) => offer.providerKey === current?.provider && offer.modelId === current?.id);
	const legacy = offers.find((offer) => offer.legacyProvider === current?.provider && offer.modelId === current?.id);
	if (exact || legacy) return { offer: exact ?? legacy, invalidated: false };
	const invalidated = !!current?.provider.startsWith("skiff-");
	const sameFamily = offers.find((offer) => offer.familyId === familyId);
	if (invalidated) return { offer: sameFamily ?? offers[0], invalidated: true };
	const isDefault = (offer: RuntimeOffer) => defaults.some((family) => family.id === offer.familyId && family.defaultProviderId === offer.providerId);
	return { offer: offers.find((offer) => offer.familyId === familyId && isDefault(offer))
		?? sameFamily ?? offers.find((offer) => offer.modelId === current?.id)
		?? offers.find(isDefault) ?? offers[0], invalidated: false };
}

export function nextProvider(current: ModelInfo, offers: RuntimeOffer[]): ModelInfo | undefined {
	const family = offers.find((offer) => offer.providerKey === current.provider)?.familyId;
	if (!family) return undefined;
	const siblings = offers.filter((offer) => offer.familyId === family);
	const index = siblings.findIndex((offer) => offer.providerKey === current.provider && offer.modelId === current.id);
	return siblings.length > 1 ? modelsFromOffers([siblings[(index + 1) % siblings.length]])[0] : undefined;
}

export function isProviderFailure(error: string): boolean {
	return /\b(?:401|429|5\d\d)\b|network|fetch failed|connection|connect|timeout|timed out|ECONN|ENOTFOUND|网络|超时|无法连接/i.test(error);
}

/** True when the picker should fall back to pi's own model list. */
export function needsFallback(offers: RuntimeOffer[]): boolean {
	return offers.length === 0;
}
