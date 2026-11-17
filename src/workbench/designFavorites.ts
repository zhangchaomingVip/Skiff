export const designFavoritesKey = "skiff.design.favorites.v1";
type AssetIdentity = { kind: "image" | "video"; id: string };
export const favoriteKey = (asset: AssetIdentity) => `${asset.kind}:${asset.id}`;

export function readDesignFavorites(storage: Pick<Storage, "getItem">): Set<string> {
	try {
		const data = JSON.parse(storage.getItem(designFavoritesKey) ?? "null");
		return new Set(data?.version === 1 && Array.isArray(data.ids) ? data.ids.filter((id: unknown): id is string => typeof id === "string" && /^(image|video):.+/.test(id)) : []);
	} catch { return new Set(); }
}

/** Persist before updating the UI so a failed write never looks successful. */
export function saveAssetFavorite(storage: Pick<Storage, "getItem" | "setItem">, asset: AssetIdentity, favorite: boolean): Set<string> {
	const next = readDesignFavorites(storage);
	if (favorite) next.add(favoriteKey(asset)); else next.delete(favoriteKey(asset));
	storage.setItem(designFavoritesKey, JSON.stringify({ version: 1, ids: [...next] }));
	return next;
}
