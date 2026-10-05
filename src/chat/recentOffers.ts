const STORAGE_KEY = "skiff.recent-offers.v1";
const LIMIT = 8;

export function normalizeRecentOfferIds(value: unknown, validOfferIds?: ReadonlySet<string>): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.filter((item): item is string => typeof item === "string" && item.length > 0)
		.filter((id) => !validOfferIds || validOfferIds.has(id))
		.filter((id) => { if (seen.has(id)) return false; seen.add(id); return true; })
		.slice(0, LIMIT);
}

export function rememberOffer(ids: readonly string[], offerId: string, validOfferIds?: ReadonlySet<string>): string[] {
	if (!offerId || (validOfferIds && !validOfferIds.has(offerId))) return normalizeRecentOfferIds(ids, validOfferIds);
	return normalizeRecentOfferIds([offerId, ...ids], validOfferIds);
}

export function loadRecentOffers(): string[] {
	try { return normalizeRecentOfferIds(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")); } catch { return []; }
}

export function saveRecentOffers(ids: readonly string[]): void {
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeRecentOfferIds(ids))); } catch { /* Optional preference; picker still works. */ }
}

export const recentOfferLimit = LIMIT;
