import type { ImageAttachment } from "./types";

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export async function readImages(files: File[], currentCount: number): Promise<ImageAttachment[]> {
	if (currentCount + files.length > MAX_IMAGES) throw new Error(`每条消息最多添加 ${MAX_IMAGES} 张图片。`);
	for (const file of files) {
		if (!IMAGE_TYPES.includes(file.type)) throw new Error("仅支持 PNG、JPEG、WebP、GIF 图片。");
		if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error("图片不能为空，且每张不能超过 5 MiB。");
	}
	return Promise.all(files.map((file) => new Promise<ImageAttachment>((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`));
		reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, type: "image", mimeType: file.type, data: String(reader.result).split(",")[1] });
		reader.readAsDataURL(file);
	})));
}
