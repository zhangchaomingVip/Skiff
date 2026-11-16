import { useEffect, useRef, useState } from "react";
import type { GenerationAsset, GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { assetCanvasId, canvasLabel } from "../workbench/designCanvases";
import { imageJobPending } from "../workbench/imageGeneration";
import { videoJobActive, videoJobLabels, type VideoJob } from "../workbench/videoGeneration";
import { artworkTitle, MediaView } from "./GenerationWorkspace";
import { Icon } from "./Icon";
import { Button, Chip, Dialog, IconButton } from "./ui";

/** A mixed recent-works feed: the launcher is no longer a dead end, so images
 *  and videos share one masonry grid and pending tasks take the first slots. */
export function StudioGallery({ studio, kind, active, onKind, onFocusComposer }: {
	studio: GenerationStudio;
	kind: GenerationKind;
	active: boolean;
	onKind: (kind: GenerationKind) => void;
	onFocusComposer: () => void;
}) {
	const [selected, setSelected] = useState<GenerationAsset>();
	const feed = useRef<HTMLDivElement>(null);
	const pendingImages = studio.images.jobs.filter(imageJobPending).sort((a, b) => b.createdAt - a.createdAt);
	const pendingVideos = studio.videos.jobs.filter(videoJobActive).sort((a, b) => b.createdAt - a.createdAt);
	const assets = studio.assets.filter((asset) => !(asset.job?.removed ?? asset.removed)).sort((a, b) => b.createdAt - a.createdAt);
	const submittingImage = studio.images.submitting && pendingImages.length === 0;
	const submittingVideo = studio.videos.submitting && pendingVideos.length === 0;
	const pending = pendingImages.length + pendingVideos.length + (submittingImage ? 1 : 0) + (submittingVideo ? 1 : 0);
	const total = assets.length + pending;
	useEffect(() => { if (!active) setSelected(undefined); }, [active]);
	// A new task always lands at the head of the feed, even when the user was
	// reading older works further down.
	useEffect(() => { if (studio.images.submitting || studio.videos.submitting) feed.current?.scrollTo({ top: 0 }); }, [studio.images.submitting, studio.videos.submitting]);
	const reuse = (asset: GenerationAsset) => {
		if (!asset.prompt) return;
		studio.updateDraft(asset.kind, { prompt: asset.prompt });
		onKind(asset.kind);
		onFocusComposer();
	};
	/** Image-to-image when the composer is drafting an image, first-frame
	 *  reference when it is drafting a video: one action, mode-appropriate. */
	const useReference = (asset: GenerationAsset) => {
		if (asset.kind !== "image") return;
		if (kind === "video") studio.useImageForVideo(asset);
		else studio.useImageForImage(asset);
		onFocusComposer();
	};
	return <section className="generation-gallery studio-gallery" aria-label="全部作品">
		<div ref={feed} className="generation-gallery-scroll">
			<header className="studio-gallery-head">
				<div><span className="generation-eyebrow">最近创作</span><h2>全部作品<span>{total.toString().padStart(2, "0")}</span></h2></div>
				<p>{pending ? `${pending} 个任务正在生成` : "图片与视频按时间混排 · 生成与导入都会保存在本机"}</p>
			</header>
			<div className="generation-gallery-grid studio-gallery-grid">
				{submittingImage && <PendingCard kind="image" label="正在提交创作…" prompt={studio.drafts.image.prompt} meta={[studio.drafts.image.modelId, studio.drafts.image.size.replace("x", " × ")].filter(Boolean).join(" · ")} />}
				{pendingImages.map((job) => <PendingCard key={job.id} kind="image" label={job.status === "saving" ? "正在保存图片…" : "正在生成图片…"} prompt={job.prompt} meta={`${job.modelId} · ${job.size.replace("x", " × ")}`} onCancel={() => void studio.images.cancel(job.id)} />)}
				{submittingVideo && <PendingCard kind="video" label="正在准备并提交视频…" prompt={studio.drafts.video.prompt} meta={[studio.drafts.video.modelId, `${studio.drafts.video.duration} 秒`, studio.drafts.video.ratio].filter(Boolean).join(" · ")} />}
				{pendingVideos.map((job) => <PendingCard key={job.id} kind="video" label={`${videoJobLabels[job.status]}${job.progress != null && job.status !== "downloading" ? ` ${job.progress}%` : ""}`} prompt={job.prompt} meta={videoMeta(job)} progress={job.progress} />)}
				{assets.map((asset) => <article className="generation-card studio-card" data-kind={asset.kind} key={asset.id}>
					<div className="generation-card-media">
						<button type="button" className="generation-card-preview" aria-label={`预览${asset.kind === "image" ? "图片" : "视频"}：${asset.name}`} onClick={() => setSelected(asset)}><MediaView asset={asset} />{asset.kind === "video" && <span className="generation-card-play"><Icon name="video" size={24} /></span>}</button>
						<div className="generation-hover-actions studio-card-actions" role="group" aria-label="作品快捷操作">
							{asset.prompt && <Button size="compact" variant="ghost" onClick={() => reuse(asset)}><Icon name="edit" size={14} />复用提示词</Button>}
							{asset.kind === "image" && <Button size="compact" variant="ghost" onClick={() => useReference(asset)}><Icon name="imageSpark" size={14} />作为参考图</Button>}
						</div>
					</div>
					<div className="generation-card-caption"><strong title={asset.prompt ?? asset.name}>{artworkTitle(asset)}</strong><Chip>{asset.kind === "image" ? "图片" : "视频"}</Chip></div>
					<div className="generation-asset-info"><span>{canvasLabel(studio.canvases, assetCanvasId(asset, studio.canvases))}</span><span>{new Date(asset.createdAt).toLocaleDateString()}</span></div>
				</article>)}
			</div>
			{!total && <div className="studio-gallery-empty"><Icon name="spark" size={18} /><p>还没有作品。写一句描述开始创作，作品会自动出现在这里。</p></div>}
		</div>
		{selected && <Dialog className="generation-preview-dialog" aria-label={selected.kind === "image" ? "图片预览" : "视频预览"} onClose={() => setSelected(undefined)}>
			<header><div><strong>{artworkTitle(selected)}</strong><small>{selected.name} · {canvasLabel(studio.canvases, assetCanvasId(selected, studio.canvases))}</small></div><IconButton size="compact" variant="ghost" aria-label="关闭作品预览" onClick={() => setSelected(undefined)}><Icon name="close" /></IconButton></header>
			<div className="generation-preview-media"><MediaView key={selected.id} asset={selected} playing /></div>
			{selected.prompt && <div className="generation-preview-info"><p>{selected.prompt}</p><small>{new Date(selected.createdAt).toLocaleString()}</small></div>}
			<footer>
				{selected.prompt && <Button size="compact" onClick={() => { reuse(selected); setSelected(undefined); }}><Icon name="edit" size={14} />复用提示词</Button>}
				{selected.kind === "image" && <Button size="compact" onClick={() => { useReference(selected); setSelected(undefined); }}><Icon name="imageSpark" size={14} />作为参考图</Button>}
				<Button size="compact" variant="ghost" onClick={() => setSelected(undefined)}>关闭预览</Button>
			</footer>
		</Dialog>}
	</section>;
}

function videoMeta(job: VideoJob) {
	return [job.modelId, `${job.duration} 秒`, job.ratio, job.hasReference ? "首帧参考" : ""].filter(Boolean).join(" · ");
}

function PendingCard({ kind, label, prompt, meta, progress, onCancel }: { kind: GenerationKind; label: string; prompt: string; meta: string; progress?: number | null; onCancel?: () => void }) {
	return <article className="generation-card generation-pending-card studio-pending-card" aria-busy="true" aria-label={kind === "image" ? "图片生成中" : "视频生成中"}>
		<div className="generation-pending-preview" aria-hidden="true"><span className="generation-pending-glow" /><span className="generation-pending-icon"><Icon name={kind === "image" ? "imageSpark" : "video"} size={26} /></span><span className="generation-pending-caption">{kind === "image" ? "让想象，慢慢成形" : "让画面，多一点故事"}</span></div>
		<div className="generation-pending-content"><strong role="status">{label}</strong>{prompt && <p title={prompt}>{prompt}</p>}{meta && <small>{meta}</small>}{progress != null && <span className="studio-pending-progress" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></span>}{onCancel && <Button size="compact" variant="ghost" onClick={onCancel}><Icon name="stop" size={12} />停止等待</Button>}</div>
	</article>;
}
