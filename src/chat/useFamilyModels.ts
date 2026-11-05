import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeFamilyModels, pickVisibleIds, seedFamilyModels, type FamilyModelEntry, type FamilyModelsConfig } from "./latestModels";
import { useModelCatalog } from "./useModelCatalog";

const STORAGE_KEY = "skiff.family-models.v1";
const CHANGE_EVENT = "skiff:family-models-changed";

const readStored = (): FamilyModelsConfig | undefined => {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) as FamilyModelsConfig : undefined;
	} catch {
		return undefined;
	}
};

const persist = (config: FamilyModelsConfig) => {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
	} catch { /* Display-only data: losing it just resets to the defaults. */ }
};

/**
 * The user-editable "latest models" list per family, persisted locally. It is
 * seeded once from the built-in defaults and afterwards only changes through
 * explicit edits or the per-family online refresh; manual entries survive
 * refreshes untouched. Display-only: route wiring lives in the Rust config.
 */
export function useFamilyModels() {
	const { catalog, refresh: refreshCatalog } = useModelCatalog();
	const [config, setConfig] = useState<FamilyModelsConfig>(() => seedFamilyModels(readStored()));
	const [updating, setUpdating] = useState<ReadonlySet<string>>(new Set());
	const [updateNotice, setUpdateNotice] = useState<{ familyId: string; ok: boolean; text: string }>();
	const refreshPending = useRef(false);
	// Edits and refreshes read the latest committed config through the ref so
	// batched state updates never overwrite each other.
	const configRef = useRef(config);
	configRef.current = config;
	useEffect(() => {
		const update = (next: FamilyModelsConfig) => { configRef.current = next; setConfig(next); };
		const onChange = (event: Event) => update((event as CustomEvent<FamilyModelsConfig>).detail);
		const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) update(seedFamilyModels(readStored())); };
		window.addEventListener(CHANGE_EVENT, onChange);
		window.addEventListener("storage", onStorage);
		return () => { window.removeEventListener(CHANGE_EVENT, onChange); window.removeEventListener("storage", onStorage); };
	}, []);

	const save = useCallback((next: FamilyModelsConfig) => {
		configRef.current = next;
		setConfig(next);
		persist(next);
		window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
	}, []);

	const setFamilyModels = useCallback((familyId: string, entries: FamilyModelEntry[]) => {
		save({ ...configRef.current, [familyId]: entries.filter((entry) => entry.modelId.trim()) });
	}, [save]);

	const removeFamily = useCallback((familyId: string) => {
		const next = { ...configRef.current };
		delete next[familyId];
		save(next);
	}, [save]);

	const refreshFamilies = useCallback(async (familyIds: readonly string[]) => {
		const idsToRefresh = [...new Set(familyIds)];
		if (!idsToRefresh.length || refreshPending.current) return;
		refreshPending.current = true;
		const familyId = idsToRefresh.length === 1 ? idsToRefresh[0] : "all";
		setUpdateNotice(undefined);
		setUpdating(new Set(idsToRefresh));
		try {
			// A successful refresh bypasses the Rust caches and returns the
			// freshly fetched catalog and latest-group data directly.
			const fresh = await refreshCatalog();
			if (!fresh) {
				setUpdateNotice({ familyId, ok: false, text: "无法连接官方页面或模型目录，请稍后重试或手动编辑。" });
				return;
			}
			const next = { ...configRef.current };
			let refreshed = 0;
			for (const id of idsToRefresh) {
				const ids = pickVisibleIds(id, fresh.latest, fresh.catalog);
				if (!ids.length) continue;
				next[id] = mergeFamilyModels(next[id], ids);
				refreshed++;
			}
			if (!refreshed) {
				setUpdateNotice({ familyId, ok: false, text: "官方页面与目录都没有返回可用模型，请手动编辑。" });
				return;
			}
			const changed = JSON.stringify(next) !== JSON.stringify(configRef.current);
			save(next);
			const text = idsToRefresh.length === 1 ? changed ? "已更新为最新的模型组合。" : "目录显示没有更新的模型。" : `已刷新 ${refreshed} 个家族的展示目录。${refreshed < idsToRefresh.length ? "部分家族未返回可用模型，已保留原清单。" : ""}`;
			setUpdateNotice({ familyId, ok: true, text });
		} finally {
			refreshPending.current = false;
			setUpdating(new Set());
		}
	}, [refreshCatalog, save]);
	const refreshFamily = useCallback((familyId: string) => refreshFamilies([familyId]), [refreshFamilies]);

	return useMemo(() => ({
		config,
		catalog,
		setFamilyModels,
		removeFamily,
		refreshFamily,
		refreshFamilies,
		updating,
		updateNotice,
		clearUpdateNotice: () => setUpdateNotice(undefined),
	}), [catalog, config, setFamilyModels, removeFamily, refreshFamily, refreshFamilies, updating, updateNotice]);
}
