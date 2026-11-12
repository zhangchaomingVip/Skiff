import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface ImageModel { id: string; sizes: string[] }
export interface ImageService {
	id: string;
	name: string;
	baseUrl: string;
	configured: boolean;
	keyHint: string;
	models: ImageModel[];
	defaultModel: string;
}
export interface ImageGenerationConfig { services: ImageService[]; defaultServiceId: string }
export type ImageServiceInput = Omit<ImageService, "id" | "configured" | "keyHint"> & { id?: string; apiKey?: string; makeDefault: boolean };
export interface ImageJob {
	id: string;
	status: "generating" | "saving" | "completed" | "failed" | "cancelled" | "interrupted";
	prompt: string;
	serviceId: string;
	serviceName: string;
	modelId: string;
	size: string;
	quality: string;
	createdAt: number;
	message?: string;
	path?: string;
	actualSize?: string;
	usage?: Record<string, unknown>;
	revisedPrompt?: string;
	reference?: { name: string; mime: string; width: number; height: number };
	removed?: boolean;
}
export const defaultImageModel: ImageModel = { id: "gpt-image-2.5-flare", sizes: ["1024x1024", "1536x864", "864x1536", "1152x864", "1536x1024", "1024x1536"] };
export const imageJobPending = (job: ImageJob) => job.status === "generating" || job.status === "saving";
export function sizeRatio(size: string) {
	const [width, height] = size.split("x").map(Number);
	if (!width || !height) return size;
	const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
	const divisor = gcd(width, height);
	return `${width / divisor}:${height / divisor}`;
}
export const imageAssetUrl = (path: string) => path.startsWith("data:") ? path : convertFileSrc(path);
export const imageGenerationNative = {
	config: () => invoke<ImageGenerationConfig>("get_image_generation_config"),
	save: (input: ImageServiceInput) => invoke<ImageGenerationConfig>("save_image_generation_service", { input }),
	remove: (id: string) => invoke<ImageGenerationConfig>("delete_image_generation_service", { id }),
	jobs: () => invoke<ImageJob[]>("list_image_generation_jobs"),
	start: (input: { id: string; serviceId: string; modelId: string; prompt: string; size: string; quality: string; reference?: { name: string; dataUrl: string } }) => invoke<ImageJob>("start_image_generation", { input }),
	cancel: (id: string) => invoke<void>("cancel_image_generation", { id }),
	setRemoved: (id: string, removed: boolean) => invoke<ImageJob>("set_image_generation_asset_removed", { id, removed }),
	export: (id: string) => invoke<boolean>("export_image_generation_asset", { id }),
	reveal: (id: string) => invoke<void>("reveal_image_generation_asset", { id }),
};

/** Preserve supported source bytes and transparency; GIF input uses its first frame. */
export async function prepareImageReference(reference: { url: string; name: string }) {
	const response = await fetch(reference.url);
	if (!response.ok) throw new Error("无法读取参考图，请重新选择。");
	let blob = await response.blob();
	if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error("参考图为空或超过 20 MB。");
	const bitmap = await createImageBitmap(blob).catch(() => { throw new Error("参考图无法解码，请选择有效图片。"); });
	try {
		if (bitmap.width > 8192 || bitmap.height > 8192 || bitmap.width * bitmap.height > 16 * 1024 * 1024) throw new Error("参考图须不超过 1600 万像素，单边不超过 8192 像素。");
		if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) {
			const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
			const context = canvas.getContext("2d"); if (!context) throw new Error("无法读取参考图。");
			context.drawImage(bitmap, 0, 0);
			blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("无法转换参考图。")), "image/png"));
			if (blob.size > 20 * 1024 * 1024) throw new Error("参考图转换后超过 20 MB，请使用较小图片。");
		}
		const dataUrl = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("读取参考图失败。")); reader.readAsDataURL(blob);
		});
		return { name: reference.name, dataUrl };
	} finally { bitmap.close(); }
}
