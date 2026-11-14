import { invoke } from "@tauri-apps/api/core";

export interface VideoModel { id: string; durations: number[]; ratios: string[]; referenceEnabled: boolean }
export const defaultVideoModel: VideoModel = { id: "muse-video", durations: [5], ratios: ["9:16"], referenceEnabled: false };
export interface VideoService { id: string; name: string; baseUrl: string; configured: boolean; keyHint: string; models: VideoModel[]; defaultModel: string }
export interface VideoConfig { services: VideoService[]; defaultServiceId: string }
export type VideoServiceInput = Omit<VideoService, "id" | "configured" | "keyHint"> & { id?: string; apiKey?: string; makeDefault: boolean };
export interface VideoJob {
	id: string;
	status: "submitting" | "queued" | "in_progress" | "downloading" | "completed" | "failed" | "submission_unknown" | "paused" | "download_failed" | "abandoned";
	prompt: string; serviceId: string; serviceName: string; baseUrl: string; modelId: string;
	duration: number; ratio: string; resolution: string; createdAt: number; completedAt?: number; hasReference: boolean;
	remoteId?: string; remoteStatus?: string; progress?: number; message?: string; path?: string; usage?: Record<string, unknown>;
	actualWidth?: number; actualHeight?: number; actualDuration?: number; actualFps?: number;
	projectRoot?: string;
	canvasId?: string;
}
export const videoJobActive = (job: VideoJob) => ["submitting", "queued", "in_progress", "downloading"].includes(job.status);
export const videoJobBlocks = (job: VideoJob) => !["completed", "failed", "abandoned", "download_failed"].includes(job.status) && job.remoteStatus !== "completed";
export const videoJobLabels: Record<VideoJob["status"], string> = {
	submitting: "正在提交视频…", queued: "视频排队中…", in_progress: "正在生成视频…", downloading: "正在保存视频…", completed: "视频已保存",
	failed: "视频生成失败", submission_unknown: "提交结果待核对", paused: "已暂停查询", download_failed: "视频下载失败", abandoned: "已结束本地跟踪",
};
export const videoGenerationNative = {
	config: () => invoke<VideoConfig>("get_video_generation_config"),
	save: (input: VideoServiceInput) => invoke<VideoConfig>("save_video_generation_service", { input }),
	remove: (id: string) => invoke<VideoConfig>("delete_video_generation_service", { id }),
	jobs: () => invoke<VideoJob[]>("list_video_generation_jobs"),
	start: (input: { id: string; serviceId: string; modelId: string; prompt: string; duration: number; ratio: string; reference?: string; projectRoot?: string; canvasId?: string }) => invoke<VideoJob>("start_video_generation", { input }),
	control: (id: string, action: "pause" | "resume" | "abandon") => invoke<void>("control_video_generation", { id, action }),
	setCanvas: (id: string, canvasId?: string) => invoke<VideoJob>("set_video_generation_canvas", { id, canvasId }),
	export: (id: string) => invoke<boolean>("export_video_generation_asset", { id }),
	reveal: (id: string) => invoke<void>("reveal_video_generation_asset", { id }),
};

/** Decode only locally supplied media; the native layer validates the final JPEG again.
 *  The source is fetched into a blob first: an `asset://` image is cross-origin for the
 *  canvas, and drawing it straight onto the canvas taints it so `toDataURL` throws. */
export async function prepareVideoReference(url: string) {
	let blob: Blob;
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error("无法读取首帧参考图，请重新选择。");
		blob = await response.blob();
	} catch { throw new Error("无法读取首帧参考图，请重新选择。"); }
	if (!blob.size) throw new Error("首帧参考图为空，请重新选择。");
	const bitmap = await createImageBitmap(blob).catch(() => { throw new Error("无法读取首帧参考图，请重新选择。"); });
	try {
		if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 64 * 1024 * 1024) throw new Error("参考图像素过大或无效。");
		const scale = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
		const context = canvas.getContext("2d");
		if (!context) throw new Error("无法预处理参考图。");
		context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		for (const quality of [0.85, 0.7, 0.55]) {
			const data = canvas.toDataURL("image/jpeg", quality);
			if (data.length <= 2 * 1024 * 1024 * 4 / 3) return data;
		}
		throw new Error("参考图压缩后仍过大，请换一张较小的图片。");
	} finally { bitmap.close(); }
}
