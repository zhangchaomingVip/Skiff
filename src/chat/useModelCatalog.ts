import { useEffect, useState } from "react";
import { familyLatest, type FamilyLatest } from "./latestModels";
import { fetchOfficialPages } from "../rpc/officialPages";
import { fetchPublicCatalog, type CatalogEntry } from "../rpc/pricingPage";

export type ModelCatalogState = {
	catalog: CatalogEntry[];
	catalogStale: boolean;
	catalogFetchedAt: number;
	latest: Map<string, FamilyLatest>;
};

/**
 * Latest-model sources shared by the provider and route settings pages:
 * official pages first, models.dev as the structured fallback. Both load
 * silently; recommendation features degrade to current behaviour when either
 * is missing.
 */
export function useModelCatalog(): ModelCatalogState {
	const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
	const [catalogStale, setCatalogStale] = useState(false);
	const [catalogFetchedAt, setCatalogFetchedAt] = useState(0);
	const [latest, setLatest] = useState<Map<string, FamilyLatest>>(new Map());
	useEffect(() => {
		let alive = true;
		void fetchPublicCatalog().then((response) => {
			if (!alive) return;
			setCatalog(response.models);
			setCatalogStale(response.stale);
			setCatalogFetchedAt(response.fetchedAt);
		}).catch(() => {});
		void fetchOfficialPages().then((response) => {
			if (!alive) return;
			setLatest((previous) => {
				const next = new Map(familyLatest(response.pages, []));
				// Keep catalog-derived info for families whose page failed to parse.
				for (const [familyId, info] of previous) if (!next.get(familyId)?.latestGroup.length) next.set(familyId, info);
				return next;
			});
		}).catch(() => {});
		return () => { alive = false; };
	}, []);
	// Recompute the merge whenever either source lands.
	useEffect(() => {
		if (!catalog.length) return;
		setLatest((previous) => {
			const next = new Map(familyLatest([], catalog));
			for (const [familyId, info] of previous) if (!next.get(familyId)?.latestGroup.length) next.set(familyId, info);
			return next;
		});
	}, [catalog]);
	return { catalog, catalogStale, catalogFetchedAt, latest };
}