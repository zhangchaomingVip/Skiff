import type { ModelInfo } from "./types";
import type { FamilyModelsConfig } from "./latestModels";
import { matchesSettingsModel, type CatalogIdentity } from "./settingsModels";

export const pickerModelName = (model: ModelInfo) => model.alias || model.modelId || model.name || model.id;

/** Match the display list in model settings, retaining one exact API target per route. */
export function visiblePickerModels(models: ModelInfo[], config: FamilyModelsConfig, catalog: readonly CatalogIdentity[], familyOf: (model: ModelInfo) => { id: string } | undefined) {
	const routes = new Map<string, ModelInfo[]>();
	for (const model of models) {
		const familyId = model.familyId ?? familyOf(model)?.id;
		const key = JSON.stringify([model.provider, model.routeId, familyId]);
		const route = routes.get(key) ?? [];
		route.push(model);
		routes.set(key, route);
	}
	return [...routes.values()].flatMap((route) => {
		const familyId = route[0].familyId ?? familyOf(route[0])?.id;
		if (!familyId || !Object.prototype.hasOwnProperty.call(config, familyId)) return route;
		const selected = (config[familyId] ?? []).map((entry) => route.find((model) => (model.modelId ?? model.id).trim().toLowerCase() === entry.modelId.trim().toLowerCase())
			?? route.find((model) => matchesSettingsModel(model.modelId ?? model.id, entry.modelId, catalog)));
		return [...new Set(selected.filter((model): model is ModelInfo => !!model))];
	});
}

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
