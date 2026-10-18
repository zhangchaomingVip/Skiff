import { modelIdMatchesCatalog } from "./latestModels";

/** Match catalog capabilities for direct, namespaced, and named relay IDs. */
export function catalogVision(modelId: string, catalog: readonly { modelId: string; name?: string | null; vision: boolean }[]): boolean | undefined {
	return catalog.find((entry) => modelIdMatchesCatalog(modelId, entry))?.vision;
}
