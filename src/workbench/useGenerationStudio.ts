import { useEffect, useRef, useState } from "react";

export type GenerationKind = "image" | "video";
export const generationRatios = ["1:1", "16:9", "9:16", "4:3"] as const;
export type GenerationRatio = typeof generationRatios[number];

export interface GenerationDraft {
	prompt: string;
	modelId: string;
	ratio: GenerationRatio;
	motion: number;
	duration: number;
	fps: number;
}

export interface GenerationAsset {
	id: string;
	kind: GenerationKind;
	url: string;
	name: string;
	prompt?: string;
	ratio?: GenerationRatio;
	createdAt: number;
}

export interface GenerationReference {
	url: string;
	name: string;
	assetId?: string;
}

const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const videoTypes = new Set(["video/mp4", "video/webm", "video/ogg", "video/quicktime"]);

function validateMedia(file: File, kind: GenerationKind) {
	if (!(kind === "image" ? imageTypes : videoTypes).has(file.type)) throw new Error(kind === "image" ? "请选择 PNG、JPG、WebP 或 GIF 图片。" : "请选择 MP4、WebM、MOV 或 Ogg 视频。");
	if (!file.size) throw new Error("这个文件是空的，请重新选择。");
	const limit = kind === "image" ? 20 : 100;
	if (file.size > limit * 1024 * 1024) throw new Error(`文件过大，请选择 ${limit} MB 以内的${kind === "image" ? "图片" : "视频"}。`);
}

/** Session-owned local media stays available across tools without persisting blob URLs. */
export function useGenerationStudio() {
	const [drafts, setDrafts] = useState<Record<GenerationKind, GenerationDraft>>({
		image: { prompt: "", modelId: "", ratio: "1:1", motion: 35, duration: 5, fps: 24 },
		video: { prompt: "", modelId: "", ratio: "16:9", motion: 35, duration: 5, fps: 24 },
	});
	const [assets, setAssets] = useState<GenerationAsset[]>([]);
	const [reference, setReference] = useState<GenerationReference>();
	const [referenceError, setReferenceError] = useState<string>();
	const [errors, setErrors] = useState<Partial<Record<GenerationKind, string>>>({});
	const urls = useRef(new Set<string>());
	const referenceRef = useRef<GenerationReference>();
	useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); }, []);
	const createUrl = (file: File) => {
		const url = URL.createObjectURL(file);
		urls.current.add(url);
		return url;
	};
	const updateDraft = (kind: GenerationKind, patch: Partial<GenerationDraft>) => setDrafts((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
	const clearError = (kind: GenerationKind) => setErrors((current) => ({ ...current, [kind]: undefined }));
	const replaceReference = (next?: GenerationReference) => {
		const previous = referenceRef.current;
		if (previous && !previous.assetId) { URL.revokeObjectURL(previous.url); urls.current.delete(previous.url); }
		referenceRef.current = next;
		setReference(next);
		setReferenceError(undefined);
	};
	const importAssets = (kind: GenerationKind, files: File[]) => {
		try {
			for (const file of files) validateMedia(file, kind);
			const incoming = files.map((file) => ({ id: crypto.randomUUID(), kind, url: createUrl(file), name: file.name, createdAt: Date.now() }));
			setAssets((current) => [...incoming, ...current]);
			clearError(kind);
		} catch (error) { setErrors((current) => ({ ...current, [kind]: String(error instanceof Error ? error.message : error) })); }
	};
	const uploadReference = (file: File) => {
		try { validateMedia(file, "image"); replaceReference({ url: createUrl(file), name: file.name }); }
		catch (error) { setReferenceError(String(error instanceof Error ? error.message : error)); }
	};
	const useImageForVideo = (asset: GenerationAsset) => {
		if (asset.kind !== "image") return;
		replaceReference({ url: asset.url, name: asset.name, assetId: asset.id });
		// An imported image has no prompt; keep any motion direction already drafted.
		if (asset.prompt) updateDraft("video", { prompt: asset.prompt });
		if (asset.ratio) updateDraft("video", { ratio: asset.ratio });
	};
	return { drafts, updateDraft, assets, importAssets, reference, uploadReference, removeReference: () => replaceReference(), useImageForVideo, referenceError, clearReferenceError: () => setReferenceError(undefined), errors, clearError };
}

export type GenerationStudio = ReturnType<typeof useGenerationStudio>;
