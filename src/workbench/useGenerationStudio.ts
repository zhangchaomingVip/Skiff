import { useEffect, useRef, useState } from "react";
import { useImageGeneration } from "./useImageGeneration";
import { useVideoGeneration } from "./useVideoGeneration";
import type { VideoJob } from "./videoGeneration";
import { imageAssetUrl, sizeRatio, type ImageJob } from "./imageGeneration";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../chat/workspace";
import { invalidateProjectFiles } from "./projectFiles";
import { projectGitCache } from "./useProjectGitStatus";

export type GenerationKind = "image" | "video";
export const generationRatios = ["1:1", "16:9", "9:16", "4:3"] as const;
export type GenerationRatio = typeof generationRatios[number];

export interface GenerationDraft {
	prompt: string;
	modelId: string;
	serviceId: string;
	size: string;
	quality: string;
	ratio: GenerationRatio;
	duration: number;
}

export interface GenerationAsset {
	id: string;
	kind: GenerationKind;
	url: string;
	name: string;
	prompt?: string;
	ratio?: GenerationRatio;
	createdAt: number;
	job?: ImageJob;
	videoJob?: VideoJob;
	removed?: boolean;
	path?: string;
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

/** Session-owned local media stays available across tools without persisting blob URLs.
 *  Artwork comes only from this studio; Code project files are never mirrored in. */
export function useGenerationStudio(project?: Project) {
	const images = useImageGeneration();
	const videos = useVideoGeneration();
	const [drafts, setDrafts] = useState<Record<GenerationKind, GenerationDraft>>({
		image: { prompt: "", modelId: "", serviceId: "", size: "", quality: "auto", ratio: "1:1", duration: 5 },
		video: { prompt: "", modelId: "", serviceId: "", size: "", quality: "auto", ratio: "9:16", duration: 5 },
	});
	useEffect(() => {
		if (!images.config) return;
		setDrafts((current) => {
			const previous = current.image;
			const services = images.config!.services;
			const service = services.find((item) => item.id === previous.serviceId) ?? services.find((item) => item.id === images.config!.defaultServiceId) ?? services[0];
			const model = service?.models.find((item) => item.id === previous.modelId) ?? service?.models.find((item) => item.id === service.defaultModel) ?? service?.models[0];
			return { ...current, image: { ...previous, serviceId: service?.id ?? "", modelId: model?.id ?? "", size: model?.sizes.includes(previous.size) ? previous.size : model?.sizes[0] ?? "" } };
		});
	}, [images.config]);
	useEffect(() => {
		if (!videos.config) return;
		setDrafts((current) => {
			const previous = current.video;
			const services = videos.config!.services;
			const service = services.find((item) => item.id === previous.serviceId) ?? services.find((item) => item.id === videos.config!.defaultServiceId) ?? services[0];
			const model = service?.models.find((item) => item.id === previous.modelId) ?? service?.models.find((item) => item.id === service.defaultModel) ?? service?.models[0];
			return { ...current, video: { ...previous, serviceId: service?.id ?? "", modelId: model?.id ?? "", duration: model?.durations.includes(previous.duration) ? previous.duration : model?.durations[0] ?? 5, ratio: "9:16" } };
		});
	}, [videos.config]);
	const [assets, setAssets] = useState<GenerationAsset[]>([]);
	const [reference, setReference] = useState<GenerationReference>();
	const [referenceError, setReferenceError] = useState<string>();
	const [imageReference, setImageReference] = useState<GenerationReference>();
	const [imageReferenceError, setImageReferenceError] = useState<string>();
	const [errors, setErrors] = useState<Partial<Record<GenerationKind, string>>>({});
	const urls = useRef(new Set<string>());
	const referenceRef = useRef<GenerationReference>();
	const imageReferenceRef = useRef<GenerationReference>();
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
	const replaceImageReference = (next?: GenerationReference) => {
		const previous = imageReferenceRef.current;
		if (previous && !previous.assetId) { URL.revokeObjectURL(previous.url); urls.current.delete(previous.url); }
		imageReferenceRef.current = next; setImageReference(next); setImageReferenceError(undefined);
	};
	const uploadImageReference = (file: File) => {
		try { validateMedia(file, "image"); replaceImageReference({ url: createUrl(file), name: file.name }); }
		catch (error) { setImageReferenceError(String(error instanceof Error ? error.message : error)); }
	};
	const useImageForImage = (asset: GenerationAsset) => {
		if (asset.kind !== "image") return;
		replaceImageReference({ url: asset.url, name: asset.name, assetId: asset.id });
	};
	const useImageForVideo = (asset: GenerationAsset) => {
		if (asset.kind !== "image") return;
		replaceReference({ url: asset.url, name: asset.name, assetId: asset.id });
		// An imported image has no prompt; keep any motion direction already drafted.
		if (asset.prompt) updateDraft("video", { prompt: asset.prompt });
		updateDraft("video", { ratio: "9:16" });
	};
	const setAssetRemoved = async (asset: GenerationAsset, removed: boolean) => {
		if (asset.kind !== "image") return false;
		if (asset.job) return images.setRemoved(asset.id, removed);
		setAssets((current) => current.map((item) => item.id === asset.id ? { ...item, removed } : item));
		return true;
	};
	const generated: GenerationAsset[] = images.jobs.filter((job) => job.status === "completed" && job.path).map((job) => ({ id: job.id, kind: "image", url: imageAssetUrl(job.path!), name: `skiff-${job.id.slice(0, 8)}.png`, prompt: job.prompt, ratio: generationRatios.find((ratio) => ratio === sizeRatio(job.actualSize ?? job.size)), createdAt: job.createdAt, job }));
	const generatedVideos: GenerationAsset[] = videos.jobs.filter((job) => job.status === "completed" && job.path).map((job) => ({ id: job.id, kind: "video", url: imageAssetUrl(job.path!), name: `skiff-${job.id.slice(0, 8)}.mp4`, prompt: job.prompt, ratio: "9:16", createdAt: job.createdAt, videoJob: job }));
	const saveToProject = async (asset: GenerationAsset, target: Project) => {
		const source = asset.path ?? asset.job?.path ?? asset.videoJob?.path;
		if (!source) throw new Error("请先将作品保存到设计资产库。");
		const path = await invoke<string>("save_design_asset_to_project", { root: target.path, source, name: asset.name });
		invalidateProjectFiles(target.id); void projectGitCache.refreshChanged(target.path); return path;
	};
	return { project, drafts, updateDraft, assets: [...generatedVideos, ...generated, ...assets], importAssets, reference, uploadReference, removeReference: () => replaceReference(), useImageForVideo, referenceError, clearReferenceError: () => setReferenceError(undefined), imageReference, uploadImageReference, removeImageReference: () => replaceImageReference(), useImageForImage, imageReferenceError, clearImageReferenceError: () => setImageReferenceError(undefined), errors, clearError, images, videos, setAssetRemoved, saveToProject };
}

export type GenerationStudio = ReturnType<typeof useGenerationStudio>;
