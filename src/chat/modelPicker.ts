import type { ModelInfo } from "./types";

export const pickerModelName = (model: ModelInfo) => model.alias || model.modelId || model.name || model.id;

export function pickerGroups(models: ModelInfo[], query: string, familyOf: (model: ModelInfo) => { id: string; name: string } | undefined) {
	const needle = query.trim().toLocaleLowerCase();
	const groups = new Map<string, { key: string; name: string; models: ModelInfo[] }>();
	for (const model of models) {
		const family = familyOf(model);
		if (needle && ![model.id, model.name, model.alias, model.provider, model.providerName, family?.id, family?.name].join(" ").toLocaleLowerCase().includes(needle)) continue;
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

export function formatPriceMultiplier(value: number | undefined): string | undefined {
	return value !== undefined && Number.isFinite(value) && value >= 0 && value !== 1 ? `${value}x` : undefined;
}
