import { useCallback, useEffect, useState } from "react";
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
 * is missing. `refresh` bypasses the Rust-side disk caches and rewrites them
 * on success, restarting their TTL windows.
 */
export function useModelCatalog() {
	const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
	const [catalogStale, setCatalogStale] = useState(false);
	const [catalogFetchedAt, setCatalogFetchedAt] = useState(0);
	const [latest, setLatest] = useState<Map<string, FamilyLatest>>(new Map());
	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState<string>();
	const load = useCallback(async (refresh: boolean) => {
		if (refresh) setRefreshing(true);
		try {
			const [catalogResponse, pagesResponse] = await Promise.all([
				fetchPublicCatalog(refresh).catch(() => undefined),
				fetchOfficialPages(refresh).catch(() => undefined),
			]);
			if (catalogResponse) {
				setCatalog(catalogResponse.models);
				setCatalogStale(catalogResponse.stale);
				setCatalogFetchedAt(catalogResponse.fetchedAt);
			}
			const mergedLatest = pagesResponse ? familyLatest(pagesResponse.pages, catalogResponse?.models ?? []) : undefined;
			if (mergedLatest) setLatest(mergedLatest);
			if (refresh && !catalogResponse && !pagesResponse) setRefreshError("无法连接官方页面或模型目录，请检查网络后重试");
			else setRefreshError(undefined);
			return !!(catalogResponse || pagesResponse) ? { catalog: catalogResponse?.models ?? [], latest: mergedLatest } : undefined;
		} finally {
			if (refresh) setRefreshing(false);
		}
	}, []);
	useEffect(() => { void load(false); }, [load]);
	return { catalog, catalogStale, catalogFetchedAt, latest, refreshing, refreshError, refresh: () => load(true) };
}