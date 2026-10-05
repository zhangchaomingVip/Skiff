import type { RuntimeOffer } from "./modelFamilies";

export interface LauncherFamilyDefault {
	id: string;
	defaultRouteId?: string | null;
}

export interface LauncherModel {
	familyId: string;
	familyName: string;
	modelId: string;
	offers: RuntimeOffer[];
	defaultOffer: RuntimeOffer;
}

const offerKey = (offer: RuntimeOffer) => offer.offerId ?? `${offer.familyId}/${offer.routeId ?? offer.relayId}/${offer.modelId}`;

/** Groups runtime offers for the Launcher while preserving every route. */
export function groupLauncherOffers(offers: RuntimeOffer[], defaults: LauncherFamilyDefault[] = []): LauncherModel[] {
	const unique = new Map<string, RuntimeOffer>();
	for (const offer of offers) {
		if (!offer.familyId || !offer.modelId || !offer.relayId || !offer.relayName) continue;
		unique.set(offerKey(offer), offer);
	}
	const groups = new Map<string, LauncherModel>();
	for (const offer of unique.values()) {
		const key = `${offer.familyId}/${offer.modelId}`;
		const existing = groups.get(key);
		if (existing) existing.offers.push(offer);
		else groups.set(key, { familyId: offer.familyId, familyName: offer.familyName, modelId: offer.modelId, offers: [offer], defaultOffer: offer });
	}
	return [...groups.values()].map((group) => {
		const preferred = defaults.find((family) => family.id === group.familyId)?.defaultRouteId;
		const ordered = [...group.offers].sort((a, b) => (a.routeOrder ?? Number.MAX_SAFE_INTEGER) - (b.routeOrder ?? Number.MAX_SAFE_INTEGER));
		const defaultOffer = ordered.find((offer) => preferred && (offer.routeId === preferred || offer.relayId === preferred)) ?? ordered[0];
		return { ...group, offers: ordered, defaultOffer };
	});
}
