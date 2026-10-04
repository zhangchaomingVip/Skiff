import type { Currency, ModelInfo } from "./types";

/** One selectable (family, relay, model) entry as returned by the Rust layer. */
export interface RuntimeOffer {
	familyId: string;
	familyName: string;
	relayId: string;
	relayName: string;
	/** pi provider key for this route, e.g. `skiff-relay-r1-deepseek`. */
	providerKey: string;
	modelId: string;
	inputCost: number;
	outputCost: number;
	currency: Currency;
	maxTokens: number;
	contextWindow: number;
}

/** Family defaults used to resolve which route backs a merged picker entry. */
export type FamilyDefaults = { id: string; defaultRelayId: string | null }[];

/**
 * Picks the concrete route for a (family, model): the family's default relay
 * first, then the route order the offers arrive in.
 */
export function resolveRoute(offers: RuntimeOffer[], familyId: string, modelId: string, defaults: FamilyDefaults = []): RuntimeOffer | undefined {
	const candidates = offers.filter((offer) => offer.familyId === familyId && offer.modelId === modelId);
	if (!candidates.length) return undefined;
	const defaultRelayId = defaults.find((family) => family.id === familyId)?.defaultRelayId;
	return candidates.find((offer) => offer.relayId === defaultRelayId) ?? candidates[0];
}

/**
 * Turns the family runtime view into `ModelInfo` values the rest of the app
 * already speaks. Same-model routes of one family merge into a single picker
 * entry resolved by default route then order; the entry shows the resolved
 * relay's name and price. Only the live model has to match pi's response; the
 * rest is display metadata.
 */
export function modelsFromOffers(offers: RuntimeOffer[], defaults: FamilyDefaults = []): ModelInfo[] {
	const groups = new Map<string, RuntimeOffer[]>();
	for (const offer of offers) {
		const key = `${offer.familyId}/${offer.modelId}`;
		const group = groups.get(key);
		if (group) group.push(offer);
		else groups.set(key, [offer]);
	}
	return [...groups.values()].map((group) => {
		const resolved = resolveRoute(group, group[0].familyId, group[0].modelId, defaults) ?? group[0];
		return {
			provider: resolved.providerKey,
			id: resolved.modelId,
			// Keep the model label separate from the relay grouping label.
			name: resolved.modelId,
			providerName: resolved.relayName,
			cost: { input: resolved.inputCost, output: resolved.outputCost },
			currency: resolved.currency,
			maxTokens: resolved.maxTokens,
			contextWindow: resolved.contextWindow,
		};
	});
}

/**
 * Reconciles the live model reported by pi with the family list. The live entry
 * carries capabilities pi resolved from models.json (vision and reasoning). Prices and
 * limits come from the configured model, matched by provider key and model ID.
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
	const exact = offers.find((offer) => offer.providerKey === current?.provider && offer.modelId === current?.id);
	if (exact) return { offer: exact, invalidated: false };
	const invalidated = !!current?.provider.startsWith("skiff-");
	const sameFamily = offers.filter((offer) => offer.familyId === familyId);
	if (invalidated) return { offer: sameFamily[0] ?? offers[0], invalidated: true };
	const defaultRelayId = defaults.find((family) => family.id === familyId)?.defaultRelayId;
	return { offer: sameFamily.find((offer) => offer.modelId === current?.id)
		?? sameFamily.find((offer) => offer.relayId === defaultRelayId)
		?? sameFamily[0]
		?? offers.find((offer) => offer.modelId === current?.id)
		?? offers[0], invalidated: false };
}

/**
 * Failover: the next route of the same family that serves the same model ID.
 * There is no wraparound; none means "no backup route".
 */
export function nextRoute(current: ModelInfo, offers: RuntimeOffer[]): RuntimeOffer | undefined {
	const index = offers.findIndex((offer) => offer.providerKey === current.provider && offer.modelId === current.id);
	if (index < 0) return undefined;
	const familyId = offers[index].familyId;
	const modelId = offers[index].modelId;
	return offers.slice(index + 1).find((offer) => offer.familyId === familyId && offer.modelId === modelId);
}

export function isProviderFailure(error: string): boolean {
	return /\b(?:401|429|5\d\d)\b|network|fetch failed|connection|connect|timeout|timed out|ECONN|ENOTFOUND|网络|超时|无法连接/i.test(error);
}

/** True when the picker should fall back to pi's own model list. */
export function needsFallback(offers: RuntimeOffer[]): boolean {
	return offers.length === 0;
}
