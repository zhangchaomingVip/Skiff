import type { DiscoveredModel } from "../rpc/modelDiscovery";
import { blankModel, providerModel } from "./useModelFamilies";

/** Only the provider's metadata can override defaults; prices start unconfigured. */
export function modelFromDiscovery(discovered: DiscoveredModel) {
	const defaults = blankModel();
	const positiveInteger = (value: number | undefined) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
	const contextWindow = positiveInteger(discovered.contextWindow) ?? defaults.contextWindow;
	return { ...providerModel({
		...defaults,
		modelId: discovered.id.trim(),
		contextWindow,
		maxTokens: Math.min(positiveInteger(discovered.maxTokens) ?? defaults.maxTokens, defaults.maxTokens, contextWindow),
		vision: discovered.vision ?? false,
	}), tools: discovered.tools ?? true, reasoning: discovered.reasoning ?? true, streaming: discovered.streaming ?? true };
}
