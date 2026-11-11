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
	start: (input: { id: string; serviceId: string; modelId: string; prompt: string; size: string; quality: string }) => invoke<ImageJob>("start_image_generation", { input }),
	cancel: (id: string) => invoke<void>("cancel_image_generation", { id }),
	export: (id: string) => invoke<boolean>("export_image_generation_asset", { id }),
	reveal: (id: string) => invoke<void>("reveal_image_generation_asset", { id }),
};
