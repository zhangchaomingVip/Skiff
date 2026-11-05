import { useEffect, useState } from "react";
import type { ModelInfo } from "./types";

export const modelFavoriteKey = (model: ModelInfo) => JSON.stringify([model.provider, model.id]);
const STORAGE_KEY = "skiff.model-favorites.v1";
const CHANGE_EVENT = "skiff:model-favorites-changed";

function readFavorites(): string[] {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
		return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : [];
	} catch { return []; }
}

/** Favorites identify an exact API target, so identical models on different relays stay independent. */
export function useModelFavorites() {
	const [favorites, setFavorites] = useState(readFavorites);
	useEffect(() => {
		const update = () => setFavorites(readFavorites());
		const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) update(); };
		window.addEventListener(CHANGE_EVENT, update);
		window.addEventListener("storage", storage);
		return () => { window.removeEventListener(CHANGE_EVENT, update); window.removeEventListener("storage", storage); };
	}, []);
	const toggleFavorite = (model: ModelInfo) => {
		const key = modelFavoriteKey(model);
		const next = favorites.includes(key) ? favorites.filter((value) => value !== key) : [...favorites, key];
		setFavorites(next);
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
			window.dispatchEvent(new Event(CHANGE_EVENT));
		} catch { /* Favorites remain usable for this mount when storage is unavailable. */ }
	};
	return { favorites, toggleFavorite };
}
