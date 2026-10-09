/** Match catalog capabilities for direct IDs and provider-prefixed relay IDs. */
export function catalogVision(modelId: string, catalog: readonly { modelId: string; vision: boolean }[]): boolean | undefined {
	const id = modelId.trim().toLowerCase();
	const exact = catalog.find((entry) => entry.modelId.toLowerCase() === id);
	if (exact) return exact.vision;
	const slash = id.indexOf("/");
	if (slash < 0) return undefined;
	const bareId = id.slice(slash + 1);
	return catalog.find((entry) => entry.modelId.toLowerCase() === bareId)?.vision;
}
