import type { GenerationAsset } from "./useGenerationStudio";

/** Design groupings stay inside the studio: there is no project column, so Code
 *  output copied from a repository can never leak into the gallery.
 *  "tasks" is kept so an older stored preference still parses; the gallery now
 *  shows pending works inline instead of a separate status column. */
export type DesignCollection = "all" | "tasks" | "failures" | "removed";
export const designCollections: DesignCollection[] = ["all", "tasks", "failures", "removed"];
export function assetsInCollection(assets: GenerationAsset[], collection: DesignCollection) {
	return collection === "tasks" || collection === "failures" ? [] : assets;
}
