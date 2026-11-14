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
export function designTaskStats(studio: Pick<GenerationStudio, "images" | "videos">, kind: GenerationKind, scopedTo: (job: { canvasId?: string }) => boolean = () => true) {
	const imageJobs = studio.images.jobs.filter(scopedTo);
	const videoJobs = studio.videos.jobs.filter(scopedTo);
	const jobs = kind === "image" ? imageJobs : videoJobs;
	const pending = kind === "image" ? imageJobs.filter(imageJobPending).length : videoJobs.filter(videoJobActive).length;
	return { pending, completed: jobs.filter((job) => job.status === "completed").length, failed: jobs.filter((job) => kind === "image" ? ["failed", "cancelled", "interrupted"].includes(job.status) : ["failed", "abandoned", "submission_unknown", "download_failed"].includes(job.status)).length };
}
