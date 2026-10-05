import type { ChatMessage, ModelInfo, RouteSnapshot } from "./types";
import type { RuntimeOffer } from "./modelFamilies";

/** Copy only non-secret route and price metadata into an immutable reply snapshot. */
export function snapshotForOffer(offer: RuntimeOffer): RouteSnapshot {
	return {
		offerId: offer.offerId,
		routeId: offer.routeId,
		providerKey: offer.providerKey,
		familyId: offer.familyId,
		familyName: offer.familyName,
		modelId: offer.modelId,
		alias: offer.alias,
		relayId: offer.relayId,
		relayName: offer.relayName,
		billingAccountId: offer.billingAccountId,
		currency: offer.currency,
		inputCost: offer.inputCost,
		outputCost: offer.outputCost,
		cacheReadCost: offer.cacheReadCost,
		cacheWriteCost: offer.cacheWriteCost,
	};
}

/** Match the completed response to the concrete offer that actually served it. */
export function snapshotForResponse(response: { provider?: string; model?: string }, current: ModelInfo | undefined, offers: readonly RuntimeOffer[]): RouteSnapshot | undefined {
	const provider = response.provider ?? current?.provider;
	const modelId = response.model ?? current?.modelId ?? current?.id;
	if (!provider || !modelId) return undefined;
	const offer = offers.find((candidate) => candidate.providerKey === provider && candidate.modelId === modelId && (!current?.routeId || candidate.routeId === current.routeId))
		?? offers.find((candidate) => candidate.providerKey === provider && candidate.modelId === modelId);
	return offer ? snapshotForOffer(offer) : undefined;
}

/** Restore Skiff-owned snapshots by assistant-reply order, since pi transcript IDs are not stable. */
export function attachHistoricalSnapshots(messages: ChatMessage[], snapshots: readonly (RouteSnapshot | null)[] | undefined): ChatMessage[] {
	if (!snapshots?.length) return messages;
	let assistantIndex = 0;
	return messages.map((message) => {
		if (message.role !== "assistant") return message;
		const snapshot = snapshots[assistantIndex++];
		return snapshot ? { ...message, routeSnapshot: snapshot } : message;
	});
}

export function snapshotsForMessages(messages: readonly ChatMessage[]): Array<RouteSnapshot | null> {
	return messages.filter((message) => message.role === "assistant").map((message) => message.routeSnapshot ?? null);
}
