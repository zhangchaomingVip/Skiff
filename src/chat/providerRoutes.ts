import type { ModelFamily, ModelSpec, RelaySpec, RelayRouteSpec } from "./useModelFamilies";
import type { DiscoveredModel } from "../rpc/modelDiscovery";

/** Classify the model basename, retaining the exact provider-prefixed API ID. */
export function discoveredFamily(modelId: string): string | undefined {
	const id = modelId.trim().split("/").pop()?.toLowerCase() ?? "";
	// These endpoints cannot serve the chat-completions requests used by Skiff.
	if (/(?:^|[-_.])(?:ocr|embedding|rerank|realtime|tts|asr)(?:$|[-_.])/.test(id)) return undefined;
	if (/^deepseek(?:$|[-_.])/.test(id)) return "deepseek";
	if (/^(?:kimi|moonshot)(?:$|[-_.])/.test(id)) return "kimi";
	if (/^(?:glm|chatglm)(?:$|[-_.])/.test(id)) return "glm";
	return undefined;
}

/** Only create missing routes; existing model settings and priority stay intact.
 *  Discovered routes enable reasoning by default so thinking models work out of the box. */
export function buildDiscoveredRoutes(models: DiscoveredModel[], relay: RelaySpec, families: ModelFamily[], fillModel: (id: string) => ModelSpec): RelayRouteSpec[] {
	const groups = new Map<string, ModelSpec[]>();
	for (const discovered of models) {
		const id = discovered.id.trim();
		if (!id) continue;
		const familyId = discoveredFamily(id);
		if (!familyId || relay.excludedModelIds?.includes(id)) continue;
		if (families.some((family) => family.id === familyId && family.routes.some((route) => route.relayId === relay.id))) continue;
		const list = groups.get(familyId) ?? [];
		list.push({ ...fillModel(id), modelId: id });
		groups.set(familyId, list);
	}
	return ["deepseek", "kimi", "glm"].flatMap((familyId) => {
		const models = groups.get(familyId);
		return models ? [{ familyId, route: { id: "", relayId: relay.id, enabled: true, models, streaming: true, tools: true, vision: false, reasoning: true } }] : [];
	});
}
