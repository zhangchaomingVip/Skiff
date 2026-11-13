import type { GenerationAsset, GenerationKind, GenerationStudio } from "./useGenerationStudio";
import { imageJobPending } from "./imageGeneration";
import { videoJobActive } from "./videoGeneration";

/** Design groupings stay inside the studio: there is no project column, so Code
 *  output copied from a repository can never leak into the gallery. */
export type DesignCollection = "all" | "tasks" | "failures" | "removed";
export const designCollections: DesignCollection[] = ["all", "tasks", "failures", "removed"];
export function assetsInCollection(assets: GenerationAsset[], collection: DesignCollection) {
	return collection === "tasks" || collection === "failures" ? [] : assets;
}
export function designTaskStats(studio: Pick<GenerationStudio, "images" | "videos">, kind: GenerationKind) {
	const jobs = kind === "image" ? studio.images.jobs : studio.videos.jobs;
	const pending = kind === "image" ? studio.images.jobs.filter(imageJobPending).length : studio.videos.jobs.filter(videoJobActive).length;
	return { pending, completed: jobs.filter((job) => job.status === "completed").length, failed: jobs.filter((job) => kind === "image" ? ["failed", "cancelled", "interrupted"].includes(job.status) : ["failed", "abandoned", "submission_unknown", "download_failed"].includes(job.status)).length };
}
