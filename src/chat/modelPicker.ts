import type { ModelInfo } from "./types";

export const pickerModelName = (model: ModelInfo) => model.alias || model.modelId || model.name || model.id;

/** Favorites identify an exact API target, so identical models on different relays stay independent. */
export const modelFavoriteKey = (model: ModelInfo) => JSON.stringify([model.provider, model.id]);

const providerKey = (model: ModelInfo) => model.relayId ?? model.provider;

export const FAVORITES_GROUP_KEY = "quick-favorites";

type FamilyOf = (model: ModelInfo) => { id: string; name: string } | undefined;
const matchesQuery = (model: ModelInfo, needle: string, family: ReturnType<FamilyOf>) => !needle || [model.id, model.name, model.alias, model.provider, model.providerName, family?.id, family?.name].join(" ").toLocaleLowerCase().includes(needle);

export function pickerGroups(models: ModelInfo[], query: string, familyOf: FamilyOf) {
	const needle = query.trim().toLocaleLowerCase();
	const groups = new Map<string, { key: string; name: string; models: ModelInfo[] }>();
	for (const model of models) {
		const family = familyOf(model);
		if (!matchesQuery(model, needle, family)) continue;
		const key = model.relayId ?? model.provider;
		let group = groups.get(key);
		if (!group) {
			group = { key, name: model.providerName ?? model.provider, models: [] };
			groups.set(key, group);
		}
		group.models.push(model);
	}
	return [...groups.values()];
}

/**
 * The quick popover leads with cross-provider favorites — one click moves the
 * session to their supplier — then lists the current provider in full. A
 * favorite inside that provider is already visible there, so it is not repeated.
 */
export function quickPickerGroups(models: ModelInfo[], current: ModelInfo | undefined, favorites: readonly string[], familyOf: FamilyOf) {
	const active = current ? providerKey(current) : undefined;
	const favorite = (model: ModelInfo) => favorites.includes(modelFavoriteKey(model));
	const groups: { key: string; name: string; models: ModelInfo[] }[] = [];
	const outside = models.filter((model) => favorite(model) && providerKey(model) !== active);
	if (outside.length) groups.push({ key: FAVORITES_GROUP_KEY, name: "收藏", models: outside });
	const inside = models.filter((model) => active !== undefined && providerKey(model) === active);
	if (current && !inside.some((model) => modelFavoriteKey(model) === modelFavoriteKey(current))) inside.unshift(current);
	return [...groups, ...pickerGroups(inside, "", familyOf)];
}

/** Provider and family are independent filters; an empty family key means ungrouped. */
export function pickerFamilyGroups(models: ModelInfo[], query: string, familyOf: FamilyOf, provider?: string, selectedFamily?: string) {
	const needle = query.trim().toLocaleLowerCase();
	const groups = new Map<string, { key: string; name: string; models: ModelInfo[] }>();
	for (const model of models) {
		const family = familyOf(model);
		const key = family?.id || "";
		if (provider !== undefined && (model.relayId ?? model.provider) !== provider) continue;
		if (selectedFamily !== undefined && selectedFamily !== key) continue;
		if (!matchesQuery(model, needle, family)) continue;
		let group = groups.get(key);
		if (!group) {
			group = { key, name: key ? family?.name || key : "其它模型", models: [] };
			groups.set(key, group);
		}
		group.models.push(model);
	}
	return [...groups.values()].sort((a, b) => Number(a.key === "") - Number(b.key === ""));
}

export function formatPriceMultiplier(value: number | undefined): string | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0 && value !== 1 ? `${value}x` : undefined;
}
