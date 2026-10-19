import { catalogModelIdsMatch, sameModelId } from "./latestModels";
import { maskBaseUrl, type ModelFamily, type ModelSpec, type RelaySpec, type RouteSpec } from "./useModelFamilies";
import { matchPreset } from "./providerPresets";

export type CatalogIdentity = { modelId: string; name?: string | null };
export const matchesSettingsModel = (id: string, target: string, catalog: readonly CatalogIdentity[]) => sameModelId(id, target) || catalogModelIdsMatch(id, target, catalog);
export const includedModels = (route: RouteSpec, relay?: RelaySpec) => route.models.filter((model) => model.modelId.trim() && !relay?.excludedModelIds?.includes(model.modelId));

export function routeBlockedReason(route: RouteSpec, relay?: RelaySpec): string | undefined {
	if (!relay) return "供应商不存在";
	if (!relay.enabled) return "供应商已停用";
	if (!route.enabled) return "路线已停用";
	if (!route.models.some((model) => model.modelId.trim())) return "未配置模型";
	if (!includedModels(route, relay).length) return "所有模型已剔除";
	return undefined;
}

/** Settings-only alias resolution. Chat and failover retain exact API ID matching. */
export function settingsRouteModel(route: RouteSpec, relay: RelaySpec, modelId: string, catalog: readonly CatalogIdentity[]): ModelSpec | undefined {
	const models = includedModels(route, relay);
	return models.find((model) => model.modelId.trim().toLowerCase() === modelId.trim().toLowerCase()) ?? models.find((model) => matchesSettingsModel(model.modelId, modelId, catalog));
}

export function settingsModelCandidates(family: ModelFamily, relays: RelaySpec[], modelId?: string, catalog: readonly CatalogIdentity[] = []) {
	return family.routes.flatMap((route) => {
		const relay = relays.find((item) => item.id === route.relayId);
		if (!relay || routeBlockedReason(route, relay)) return [];
		const model = modelId ? settingsRouteModel(route, relay, modelId, catalog) : includedModels(route, relay)[0];
		return model ? [{ route, relay, model }] : [];
	});
}

export function settingsTestTarget(family: ModelFamily, relays: RelaySpec[], modelId?: string, catalog: readonly CatalogIdentity[] = []) {
	const candidates = settingsModelCandidates(family, relays, modelId, catalog);
	return candidates.find(({ route }) => route.id === family.defaultRouteId) ?? candidates[0];
}

export function routeSummaryModels(route: RouteSpec, visibleIds: readonly string[], catalog: readonly CatalogIdentity[]) {
	const preferred = route.models.filter((model) => visibleIds.some((id) => matchesSettingsModel(model.modelId, id, catalog)));
	return [...preferred, ...route.models.filter((model) => !preferred.includes(model))].slice(0, 2);
}

export function routeMatchesQuery(route: RouteSpec, relay: RelaySpec | undefined, query: string) {
	const q = query.trim().toLowerCase();
	return [relay?.name ?? "", ...route.models.flatMap((model) => [model.modelId, model.alias])].some((value) => value.toLowerCase().includes(q));
}

export function filterSettingsProviders(relays: RelaySpec[], query: string) {
	const q = query.trim().toLowerCase();
	return relays.filter((relay) => [relay.name, maskBaseUrl(relay.baseUrl)].some((value) => value.toLowerCase().includes(q)));
}

export const providerSourceLabel = (baseUrl: string) => {
	const kind = matchPreset(baseUrl)?.kind;
	return kind === "vendor" ? "官方直连" : kind === "relay" ? "中转" : kind === "local" ? "本机" : "自定义";
};
