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

	const refreshFamily = useCallback(async (familyId: string) => {
		setUpdateNotice(undefined);
		setUpdating((previous) => new Set(previous).add(familyId));
		try {
			// A successful refresh bypasses the Rust caches and returns the
			// freshly fetched catalog and latest-group data directly.
			const fresh = await refreshCatalog();
			if (!fresh) {
				setUpdateNotice({ familyId, ok: false, text: "无法连接官方页面或模型目录，请稍后重试或手动编辑。" });
				return;
			}
			const ids = pickVisibleIds(familyId, fresh.latest, fresh.catalog);
			const current = configRef.current[familyId];
			if (!ids.length) {
				setUpdateNotice({ familyId, ok: false, text: "官方页面与目录都没有返回可用模型，请手动编辑。" });
				return;
			}
			const merged = mergeFamilyModels(current, ids);
			save({ ...configRef.current, [familyId]: merged });
			const changed = JSON.stringify(merged) !== JSON.stringify(current);
			setUpdateNotice({ familyId, ok: true, text: changed ? "已更新为最新的模型组合。" : "目录显示没有更新的模型。" });
		} finally {
			setUpdating((previous) => {
				const next = new Set(previous);
				next.delete(familyId);
				return next;
			});
		}
	}, [refreshCatalog, save]);

	return useMemo(() => ({
		config,
		catalog,
		setFamilyModels,
		removeFamily,
		refreshFamily,
		updating,
		updateNotice,
		clearUpdateNotice: () => setUpdateNotice(undefined),
	}), [catalog, config, setFamilyModels, removeFamily, refreshFamily, updating, updateNotice]);
}
