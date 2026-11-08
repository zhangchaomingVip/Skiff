import type { ModelInfo } from "./types";

export const pickerModelName = (model: ModelInfo) => model.alias || model.modelId || model.name || model.id;

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
