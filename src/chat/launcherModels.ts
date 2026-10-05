import type { RuntimeOffer } from "./modelFamilies";
import type { Conversation } from "./workspace";

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

/** Resolve historical session selections back to currently available offer IDs. */
export function recentLauncherOfferIds(chats: Conversation[], offers: RuntimeOffer[]): Set<string> {
	const available = new Set(offers.map((offer) => offer.offerId).filter((id): id is string => !!id));
	const recent = new Set<string>();
	const remember = (selection: { offerId?: string; routeId?: string; modelId?: string; provider?: string; providerKey?: string; id?: string } | undefined) => {
		if (!selection) return;
		if (selection.offerId && available.has(selection.offerId)) { recent.add(selection.offerId); return; }
		const modelId = selection.modelId ?? selection.id;
		const match = offers.find((offer) =>
			(selection.routeId && offer.routeId === selection.routeId && !!modelId && offer.modelId === modelId) ||
			((selection.provider ?? selection.providerKey) && offer.providerKey === (selection.provider ?? selection.providerKey) && !!modelId && offer.modelId === modelId),
		);
		if (match?.offerId) recent.add(match.offerId);
	};
	for (const chat of chats) {
		const snapshot = [...(chat.routeSnapshots ?? [])].reverse().find((item) => !!item);
		if (snapshot) remember(snapshot);
		else remember(chat.selectedModel);
	}
	return recent;
}

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
