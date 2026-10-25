import type { ModelFamily, ModelSpec, RelaySpec, RelayRouteSpec } from "./useModelFamilies";
import type { DiscoveredModel } from "../rpc/modelDiscovery";
import { pickRecommendedIds, type FamilyLatest } from "./latestModels";

export interface ProviderModelEntry {
	familyId: string;
	model: ModelSpec;
}

/** Projects the provider editor's unified model list back onto family routes. */
export function routesFromProviderModels(relay: RelaySpec, families: ModelFamily[], entries: ProviderModelEntry[]): RelayRouteSpec[] {
	const grouped = new Map<string, ModelSpec[]>();
	for (const entry of entries) {
		const models = grouped.get(entry.familyId) ?? [];
		models.push({ ...entry.model, modelId: entry.model.modelId.trim() });
		grouped.set(entry.familyId, models);
	}
	const excluded = new Set(relay.excludedModelIds ?? []);
	return families.flatMap((family) => {
		const configured = grouped.get(family.id) ?? [];
		const existing = family.routes.find((route) => route.relayId === relay.id);
		if (!existing && !configured.length) return [];
		if (existing) {
			const remaining = new Map(configured.map((model) => [model.modelId, model]));
			const models = existing.models.flatMap((model) => {
				const edited = remaining.get(model.modelId);
				remaining.delete(model.modelId);
				return edited ? [edited] : excluded.has(model.modelId) ? [model] : [];
			});
			return [{ familyId: family.id, route: { ...existing, models: [...models, ...remaining.values()] } }];
		}
		return [{ familyId: family.id, route: { id: "", relayId: relay.id, enabled: true, models: configured, streaming: true, tools: true, vision: false, reasoning: true } }];
	});
}

/** Classify the model basename, retaining the exact provider-prefixed API ID. */
export function discoveredFamily(modelId: string): string | undefined {
	const id = modelId.trim().split("/").pop()?.toLowerCase() ?? "";
	// These endpoints cannot serve the chat-completions requests used by Skiff.
	if (NON_CHAT_MODEL.test(id)) return undefined;
	if (/^deepseek(?:$|[-_.])/.test(id)) return "deepseek";
	if (/^(?:kimi|moonshot)(?:$|[-_.])/.test(id)) return "kimi";
	if (/^(?:glm|chatglm)(?:$|[-_.])/.test(id)) return "glm";
	// Auto-routing models with no vendor prefix (e.g. `openrouter/auto`, `auto`) go to the Auto family.
	if (/^auto(?:$|[-_.])|(?:$|[-_.])auto$/.test(id)) return "auto";
	return undefined;
}

/** Endpoints that cannot serve chat-completions requests; excluded from
 *  discovery and from family suggestions alike. */
export const NON_CHAT_MODEL = /(?:^|[-_.])(?:ocr|embedding|rerank|realtime|tts|asr)(?:$|[-_.])/;

/** Vendor casing for suggested family ids; others capitalize the id. */
const FAMILY_NAME_HINTS: Record<string, string> = {
	gpt: "GPT",
	claude: "Claude",
	qwen: "Qwen",
	gemini: "Gemini",
	grok: "Grok",
	doubao: "豆包",
	ernie: "ERNIE",
	hunyuan: "混元",
	minimax: "MiniMax",
	moonshot: "Moonshot",
	llama: "Llama",
	mistral: "Mistral",
};

/**
 * Suggests a new family for a model no existing family claims: the vendor
 * prefix before the first separator names it (`gpt-5` → `gpt`,
 * `Qwen/Qwen3-Max` → `qwen`). A trailing version number is dropped when the
 * stem still reads like a name (`qwen3` → `qwen`, but `o3` stays `o3`), so one
 * vendor's models land in one family. Returns undefined when the prefix cannot
 * name a family (numeric, non-chat endpoint, too long).
 */
export function suggestFamilyId(modelId: string): string | undefined {
	const id = modelId.trim().split("/").pop()?.toLowerCase() ?? "";
	if (!id || NON_CHAT_MODEL.test(id)) return undefined;
	let prefix = id.split(/[-._]/)[0] ?? "";
	const stem = prefix.replace(/\d+$/, "");
	if (stem.length >= 2) prefix = stem;
	// Two characters minimum keeps single-letter vendor noise out of the suggestion.
	return /^[a-z][a-z0-9_-]{1,31}$/.test(prefix) ? prefix : undefined;
}

/** Display name for a suggested family id, used as the family's displayName. */
export function suggestedFamilyLabel(id: string): string {
	return FAMILY_NAME_HINTS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Only create missing routes; existing model settings and priority stay intact.
 *  Discovered routes enable reasoning by default so thinking models work out of the box.
 *  When `latest` is provided, a fresh route's model list is narrowed to the two
 *  recommended models (flagship + flash of the newest version group); the
 *  remaining discovered IDs stay available for manual selection. An empty
 *  recommendation (offline catalog, exotic endpoint) keeps every model. */
export function buildDiscoveredRoutes(models: DiscoveredModel[], relay: RelaySpec, families: ModelFamily[], fillModel: (id: string) => ModelSpec, latest?: ReadonlyMap<string, FamilyLatest>): RelayRouteSpec[] {
	const groups = new Map<string, ModelSpec[]>();
	const seen = new Set<string>();
	for (const discovered of models) {
		const id = discovered.id.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const familyId = discoveredFamily(id);
		if (!familyId || relay.excludedModelIds?.includes(id)) continue;
		if (families.some((family) => family.id === familyId && family.routes.some((route) => route.relayId === relay.id))) continue;
		const list = groups.get(familyId) ?? [];
		list.push({ ...fillModel(id), modelId: id });
		groups.set(familyId, list);
	}
	return ["deepseek", "kimi", "glm", "auto"].flatMap((familyId) => {
		const models = groups.get(familyId);
		if (!models) return [];
		if (familyId !== "auto" && latest) {
			const recommendation = pickRecommendedIds(models.map((model) => model.modelId), latest, familyId);
			if (recommendation.recommended.length) {
				const pickedSet = new Set(recommendation.recommended.map((id) => id.toLowerCase()));
				// Keep the recommendation order (flagship first) in the fresh route.
				const filtered = recommendation.recommended
					.map((id) => models.find((model) => model.modelId.toLowerCase() === id))
					.filter((model): model is ModelSpec => !!model && pickedSet.has(model.modelId.toLowerCase()));
				if (filtered.length) return [{ familyId, route: { id: "", relayId: relay.id, enabled: true, models: filtered, streaming: true, tools: true, vision: false, reasoning: true } }];
			}
		}
		return [{ familyId, route: { id: "", relayId: relay.id, enabled: true, models, streaming: true, tools: true, vision: false, reasoning: true } }];
	});
}
