/** Conservative identity matching used only to look up reference prices. */
type CatalogModelLike = { modelId: string; name?: string | null };

const modelKey = (value: string): string => {
	const basename = value.trim().split("/").pop() ?? "";
	return basename.toLowerCase().replace(/[^a-z0-9]+/g, "");
};

const catalogKeys = (entry: CatalogModelLike): Set<string> => {
	const values = [entry.modelId, entry.name ?? ""];
	const keys = new Set<string>();
	for (const value of values) {
		const key = modelKey(value);
		if (!key) continue;
		keys.add(key);
		// models.dev names sometimes append a release date, e.g. "... Flash 1017".
		if (value !== entry.modelId) keys.add(key.replace(/(?:v?\d{3,8})$/, ""));
	}
	return keys;
};

const modelKeyVariants = (value: string): Set<string> => {
	const raw = value.trim().split("/").pop()?.toLowerCase() ?? "";
	const keys = new Set<string>();
	const key = modelKey(value);
	if (key) keys.add(key);
	// Relays often append a dated release suffix to an otherwise canonical ID.
	const withoutRelease = raw.replace(/[-_.]\d{3,8}\s*$/, "");
	if (withoutRelease !== raw) keys.add(modelKey(withoutRelease));
	return keys;
};

/** Does a relay/API ID refer to the catalog entry, including its display name? */
export function modelIdMatchesCatalog(modelId: string, entry: CatalogModelLike): boolean {
	return [...modelKeyVariants(modelId)].some((key) => catalogKeys(entry).has(key));
}
