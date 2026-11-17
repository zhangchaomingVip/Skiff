import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { VideoControls, reuseVideo } from "./VideoGenerationWorkspace";
import { createPortal } from "react-dom";
import type { GenerationAsset, GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { Icon } from "./Icon";
import { CanvasPicker } from "./CanvasPicker";
import { GenerationPicker } from "./GenerationPicker";
import { ConfirmDialog } from "./ConfirmDialog";
import { CopyButton } from "./CopyButton";
import { ImageLightbox } from "./ImageLightbox";
import { assetCanvasId } from "../workbench/designCanvases";
import { Button, Dialog, IconButton, Input, Popover, TextArea, Tooltip } from "./ui";
import { useReferenceDrop } from "./useReferenceDrop";
import "./generation-workspace.css";
import { imageJobPending, sizeRatio, type ImageJob } from "../workbench/imageGeneration";
import { imageResolution, imageResolutions } from "../workbench/imageSizes";
import { videoJobActive, videoJobLabels, type VideoJob } from "../workbench/videoGeneration";

const imageAccept = "image/png,image/jpeg,image/webp,image/gif";
const imageRatios = ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"];
const qualityOptions = [{ value: "auto", label: "自动" }, { value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }];

function imageRatio(size: string) {
	const ratio = sizeRatio(size);
	return imageRatios.find((option) => sizeRatio(option.replace(":", "x")) === ratio) ?? ratio;
}

function RatioBox({ size }: { size: string }) {
	const [width, height] = size.split(/[x:]/).map(Number);
	const longest = Math.max(width, height) || 1;
	return <span className="generation-ratio-glyph" aria-hidden="true"><span className="generation-ratio-shape" style={{ width: `${width / longest * 100}%`, height: `${height / longest * 100}%` }} /></span>;
}

/** Ratio and resolution share one chip so the composer stays on a single row;
 *  the panel follows the reference picker instead of two always-open chip rows. */
function ImageSizeMenu({ size, sizes, onChange, onConfigure }: { size: string; sizes: string[]; onChange: (size: string) => void; onConfigure: () => void }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const configured = sizes.length > 0;
	const resolution = imageResolution(size);
	const ratio = size ? imageRatio(size) : "1:1";
	const ratios = [...imageRatios, ...new Set(sizes.map(imageRatio).filter((value) => !imageRatios.includes(value)))];
	const available = sizes.filter((value) => imageResolution(value) === resolution);
	useEffect(() => {
		if (!open) return;
		(menu.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? menu.current?.querySelector<HTMLElement>("button"))?.focus();
	}, [open]);
	return <>
		<button type="button" ref={trigger} className="generation-picker-trigger generation-size-trigger" disabled={!configured} aria-haspopup="dialog" aria-expanded={open} aria-label={configured ? `画面尺寸：${ratio} ${resolution}` : "画面尺寸"} title={size ? `${ratio} · ${size.replace("x", " × ")}` : undefined} onClick={() => setOpen((value) => !value)}>
			{configured && size ? <RatioBox size={size} /> : <Icon name="image" size={13} />}
			<span className="generation-picker-value">{configured ? `${ratio} · ${resolution}` : "选择尺寸"}</span>
			<span className="chev-caret" aria-hidden="true"><Icon name="chevron" size={11} /></span>
		</button>
		{open && createPortal(<Popover anchor={trigger} className="generation-size-menu" aria-label="选择画面尺寸" onClose={() => setOpen(false)}>
			<div ref={menu}>
				<p className="generation-picker-title">画面比例</p>
				<div className="generation-size-ratios" role="group" aria-label="画面比例">{ratios.map((option) => {
					const match = available.find((value) => imageRatio(value) === option);
					return <Button key={option} size="compact" variant="ghost" className="generation-size-option" aria-pressed={!!match && ratio === option} disabled={!match} title={match ? `${option} · ${match.replace("x", " × ")}` : `${resolution} 暂无此比例，请检查模型支持的尺寸`} onClick={() => { if (match) onChange(match); }}><RatioBox size={option} /><span>{option}</span></Button>;
				})}</div>
				<p className="generation-picker-title">分辨率</p>
				<div className="generation-size-resolutions" role="group" aria-label="分辨率">{imageResolutions.map((option) => {
					const matches = sizes.filter((value) => imageResolution(value) === option);
					return <Button key={option} size="compact" variant="ghost" className="generation-size-option" aria-label={matches.length ? option : `配置 ${option} 尺寸`} aria-pressed={resolution === option && sizes.length > 0} title={matches.length ? matches.map((value) => value.replace("x", " × ")).join("、") : `当前未配置 ${option} 尺寸，点击配置；这不代表模型不支持`} onClick={() => { if (matches.length) onChange(matches.find((value) => imageRatio(value) === ratio) ?? matches[0]); else { setOpen(false); onConfigure(); } }}>{option}{!matches.length && <small>待配置</small>}</Button>;
				})}</div>
				<p className="generation-size-output">{size ? `输出尺寸：${size.replace("x", " × ")}` : "配置生成服务后，选择模型支持的分辨率与比例。"}</p>
			</div>
		</Popover>, trigger.current?.closest("dialog") ?? document.body)}
	</>;
}

export function artworkTitle(asset: GenerationAsset, importedIndex = 1) {
	const prompt = asset.prompt?.trim().replace(/\s+/g, " ");
	if (!prompt) {
		if (asset.job || asset.videoJob) return "一瞬灵感";
		const name = asset.name.split(/[\\/]/).pop()?.trim() ?? "";
		const stem = name.replace(/\.[^.]+$/, "").replace(/ \(\d+\)$/, "");
		const opaque = /^(?:\{?[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\}?|[\da-f]{16,})$/i.test(stem);
		return !name || opaque ? `本地导入作品 ${String(importedIndex).padStart(2, "0")}` : name;
	}
	const letters = Array.from(prompt);
	return letters.length > 20 ? `${letters.slice(0, 20).join("")}…` : prompt;
}

export function MediaView({ asset, playing = false }: { asset: Pick<GenerationAsset, "kind" | "url" | "name">; playing?: boolean }) {
	const [failed, setFailed] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (playing && videoRef.current) {
			videoRef.current.play().catch(() => {});
		}
	}, [playing, asset.url]);
	if (failed) return <div className="generation-media-failed" role="status"><Icon name={asset.kind === "image" ? "image" : "video"} size={24} /><span>暂时无法预览这个文件</span></div>;
	return asset.kind === "image" ? <img src={asset.url} alt={asset.name} loading={playing ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} /> : <video ref={videoRef} src={asset.url} aria-label={asset.name} controls={playing} autoPlay={playing} muted loop playsInline preload="metadata" onError={() => setFailed(true)} />;
}

export interface ComposerProps {
	studio: GenerationStudio;
	onConfigure: () => void;
	/** Fired after a valid submit, so the home can hand the new work over to the
	 *  canvas that the draft targets. */
	onSubmitted?: () => void;
	/** hero: the always-open launcher card. panel: the canvas composer the user
	 *  expands on demand. */
	variant?: "hero" | "panel";
	/** Image/video switch, rendered as the first chip of the launcher toolbar. */
	modeSwitch?: ReactNode;
}
export function GenerationControls({ kind, ...props }: ComposerProps & { kind: GenerationKind }) {
	return kind === "video" ? <VideoControls {...props} /> : <ImageGenerationControls {...props} />;
}
function ImageGenerationControls({ studio, onConfigure, onSubmitted, variant, modeSwitch }: ComposerProps) {
	const id = useId();
	const promptInput = useRef<HTMLTextAreaElement>(null);
	const referenceInput = useRef<HTMLInputElement>(null);
	const drop = useReferenceDrop(studio.uploadImageReference);
	const draft = studio.drafts.image;
	const update = (patch: Partial<typeof draft>) => studio.updateDraft("image", patch);
	const { images } = studio;
	const service = images.config?.services.find((item) => item.id === draft.serviceId);
	const model = service?.models.find((item) => item.id === draft.modelId);
	const configured = !!service?.configured && !!model;
	const canGenerate = configured && !images.loading && !images.atCapacity && !images.submitting && !!draft.prompt.trim() && !!model?.sizes.includes(draft.size);
	// The model chip already names the service, so the footer only speaks up when
	// it has something to say: loading, queueing or a missing configuration.
	const status = images.loading ? "正在读取图片生成服务" : images.running ? `进行中 ${images.runningCount} / ${images.concurrencyLimit || "不限"}${images.atCapacity ? " · 已达上限，可在生图设置中调整" : " · 可继续生成"}` : configured ? "" : "尚未配置图片生成服务";
	// The expanded canvas panel starts at three lines and grows with the text,
	// then scrolls inside the same box instead of pushing the works away.
	useEffect(() => {
		const input = promptInput.current;
		if (variant !== "panel" || !input) return;
		input.style.height = "auto";
		input.style.height = `${Math.min(200, input.scrollHeight)}px`;
	}, [draft.prompt, variant]);
	return <aside className="generation-controls" data-kind="image" data-variant={variant} aria-label="生图参数">
		<header className="generation-controls-header"><span className="generation-mode-icon"><Icon name="imageSpark" size={20} /></span><div><h1>生图</h1><p>让想象，慢慢成形</p></div></header>
		<form className="generation-form" onSubmit={(event) => { event.preventDefault(); if (!canGenerate) return; void images.generate({ serviceId: draft.serviceId, modelId: draft.modelId, prompt: draft.prompt, size: draft.size, quality: draft.quality, projectRoot: studio.project?.path, canvasId: studio.canvasId || undefined }, studio.imageReference); update({ prompt: "" }); onSubmitted?.(); }} {...drop.handlers}>
			<div className="generation-fields">
				<div className="generation-field generation-field-prompt">
					<div className="generation-field-heading"><label htmlFor={`${id}-prompt`}>提示词 <span>Prompt</span></label>{draft.prompt && <Tooltip text="清空提示词"><IconButton size="compact" variant="ghost" aria-label="清空提示词" onClick={() => { update({ prompt: "" }); promptInput.current?.focus(); }}><Icon name="close" size={14} /></IconButton></Tooltip>}</div>
					<TextArea ref={promptInput} id={`${id}-prompt`} rows={variant === "panel" ? 2 : 4} maxLength={32000} value={draft.prompt} aria-keyshortcuts="Control+Enter Meta+Enter" placeholder="描述你想看到的画面：窗边的一束花、午后的柔光、温暖的胶片质感…" onChange={(event) => update({ prompt: event.target.value })} onKeyDown={(event) => {
						if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
							event.preventDefault(); event.stopPropagation();
							if (canGenerate && !event.repeat) event.currentTarget.form?.requestSubmit();
						}
					}} />
					<p className="generation-field-hint">试着写下主体、光线、色彩和你喜欢的风格。</p>
				</div>
				<div className="generation-field generation-field-reference" data-filled={!!studio.imageReference}>
					<span className="generation-field-label">参考图 <small>{studio.imageReference ? "图生图" : "可选 · 图生图"}</small></span>
					<Input ref={referenceInput} className="generation-file-input" type="file" accept={imageAccept} aria-label="上传图生图参考图" onChange={(event) => { const file = event.target.files?.[0]; if (file) studio.uploadImageReference(file); event.target.value = ""; }} />
					<div className={`generation-reference ${studio.imageReference ? "has-image" : "is-empty"} ${drop.dragging ? "is-dragging" : ""}`}>
						{studio.imageReference ? <>
							<button type="button" className="generation-reference-image" aria-label={`替换参考图：${studio.imageReference.name}`} onClick={() => referenceInput.current?.click()}><MediaView key={studio.imageReference.url} asset={{ ...studio.imageReference, kind: "image" }} /></button>
							<div className="generation-reference-caption"><span title={studio.imageReference.name}>{studio.imageReference.name}</span><IconButton size="compact" variant="ghost" aria-label="移除图生图参考图" onClick={studio.removeImageReference}><Icon name="close" size={13} /></IconButton></div>
						</> : <button type="button" className="generation-reference-upload" aria-label="添加参考图" onClick={() => referenceInput.current?.click()}><Icon name="image" size={15} /><strong>添加参考图</strong><span>拖入或点击上传，按提示词修改画面</span></button>}
					</div>
					<p className="generation-field-hint">{studio.imageReference ? "描述想保留和修改的内容。参考图将在生成时发送给服务，原图保留。" : "不添加参考图时使用文生图。PNG、JPG、WebP、GIF · 最大 20 MB；动画仅取静态首帧。"}</p>
					{studio.imageReferenceError && <div className="generation-error" role="alert"><span>{studio.imageReferenceError}</span><IconButton size="compact" variant="ghost" aria-label="关闭参考图提示" onClick={studio.clearImageReferenceError}><Icon name="close" /></IconButton></div>}
				</div>
				<div className="generation-settings">
					{modeSwitch && <div className="generation-field generation-field-mode">{modeSwitch}</div>}
					<CanvasPicker studio={studio} id={`${id}-canvas`} />
					{variant === "hero" && <span className="design-composer-divider" aria-hidden="true" />}
					<div className="generation-field generation-field-service"><label htmlFor={`${id}-provider`}>生成服务</label><div className="generation-service-control"><GenerationPicker id={`${id}-provider`} label="生成服务" icon="layers" value={draft.serviceId} disabled={!images.config?.services.length} placeholder={images.config?.services.length ? "选择一个服务" : "先配置一个生成服务"} options={(images.config?.services ?? []).map((item) => ({ value: item.id, label: item.name, hint: `${item.models.length} 个模型${item.configured ? "" : " · 未配置密钥"}` }))} onChange={(serviceId) => { const next = images.config?.services.find((item) => item.id === serviceId); const first = next?.models.find((item) => item.id === next.defaultModel) ?? next?.models[0]; update({ serviceId, modelId: first?.id ?? "", size: first?.sizes[0] ?? "" }); }} /></div></div>
					<div className="generation-field generation-field-model"><label htmlFor={`${id}-model`}>模型</label><GenerationPicker id={`${id}-model`} label="模型" icon="spark" value={configured ? draft.modelId : ""} disabled={!configured} placeholder={configured ? "选择模型" : "连接生成服务后选择模型"} options={configured ? (service?.models ?? []).map((item) => ({ value: item.id, label: item.id, hint: `${item.sizes.length} 种尺寸` })) : []} onChange={(modelId) => { const next = service?.models.find((item) => item.id === modelId); update({ modelId, size: next?.sizes[0] ?? "" }); }} /></div>
					{configured && <div className="generation-field generation-field-quality"><label htmlFor={`${id}-quality`}>质量</label><GenerationPicker id={`${id}-quality`} label="质量" icon="sliders" value={draft.quality} placeholder="自动" options={qualityOptions} onChange={(quality) => update({ quality: quality as typeof draft.quality })} /><p className="generation-field-hint">更大的尺寸和更高的质量可能增加耗时与费用。</p></div>}
					<ImageSizeMenu size={draft.size} sizes={model?.sizes ?? []} onChange={(size) => update({ size })} onConfigure={onConfigure} />
					<div className="generation-field generation-field-configure"><Tooltip text={configured ? "管理生成服务" : "配置生成服务"}><IconButton variant="ghost" aria-label={configured ? "管理生成服务" : "配置生成服务"} onClick={onConfigure}><Icon name="settings" size={16} /></IconButton></Tooltip></div>
				</div>
			</div>
			{variant !== "hero" && status && <p className="generation-service-status" id={`${id}-service`} role="status">{status}</p>}
			<footer className="generation-submit"><Button type="submit" variant="primary" size="primary" disabled={!canGenerate} aria-describedby={variant !== "hero" && status ? `${id}-service` : undefined} loading={images.submitting}><Icon name="spark" />生成图片</Button></footer>
		</form>
		{drop.dragging && <div className="generation-dropzone" aria-hidden="true"><span className="generation-dropzone-icon"><Icon name="image" size={20} /></span><strong>松开图片，作为参考图</strong><small>PNG、JPG、WebP、GIF · 最大 20 MB</small></div>}
	</aside>;
}

function reuseJob(studio: GenerationStudio, job: ImageJob) {
	const service = studio.images.config?.services.find((item) => item.id === job.serviceId);
	const model = service?.models.find((item) => item.id === job.modelId);
	studio.updateDraft("image", { prompt: job.prompt, ...(model ? { serviceId: service!.id, modelId: model.id, size: model.sizes.includes(job.size) ? job.size : model.sizes[0], quality: job.quality } : {}) });
}

/** Both mouse and touch entry points share one menu and the same asset. */
function ImageResultCard({ asset, studio, active, onPreview, onUseReference }: { asset: GenerationAsset; studio: GenerationStudio; active: boolean; onPreview: () => void; onUseReference: () => void }) {
	const trigger = useRef<HTMLButtonElement>(null);
	const id = useId();
	const [menu, setMenu] = useState<{ point?: { x: number; y: number }; last?: boolean }>();
	const [feedback, setFeedback] = useState("");
	const lock = useRef(false);
	useEffect(() => { if (!active) setMenu(undefined); }, [active]);
	useEffect(() => {
		if (!menu) return;
		const items = document.getElementById(id)?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)");
		if (items?.length) items[menu.last ? items.length - 1 : 0].focus();
	}, [menu, id]);
	const close = () => { setMenu(undefined); trigger.current?.focus(); };
	const open = (next: NonNullable<typeof menu>) => { setFeedback(""); setMenu(next); };
	const run = async (action: () => void | Promise<unknown>, success?: string) => {
		if (lock.current) return;
		lock.current = true; setFeedback("");
		try { await action(); if (success) setFeedback(success); else close(); }
		catch { setFeedback("操作失败，请重试"); }
		finally { lock.current = false; }
	};
	const copy = async () => {
		const image = new Image(); image.crossOrigin = "anonymous"; image.src = asset.url;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("无法读取图片");
		context.drawImage(image, 0, 0);
		const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("无法复制图片")), "image/png"));
		await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
	};
	return <article className="generation-card design-result-card" data-kind="image" onContextMenu={(event) => {
		event.preventDefault(); event.stopPropagation();
		open(event.clientX || event.clientY ? { point: { x: event.clientX, y: event.clientY } } : {});
	}}>
		<div className="generation-card-media">
			<button type="button" className="generation-card-preview" aria-label={`预览图片：${asset.name}`} onClick={onPreview}><MediaView asset={asset} /></button>
			<IconButton ref={trigger} size="compact" variant="ghost" className="generation-image-menu-trigger" aria-label={`图片操作：${artworkTitle(asset)}`} aria-haspopup="menu" aria-expanded={!!menu} aria-controls={menu ? id : undefined} onClick={() => menu ? close() : open({})} onKeyDown={(event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open({ last: event.key === "ArrowUp" }); }
			}}><Icon name="more" size={16} /></IconButton>
		</div>
		{menu && createPortal(<Popover anchor={trigger} point={menu.point} gap={menu.point ? 0 : 6} id={id} role="menu" aria-label="图片操作" className="generation-actions-menu" onClose={() => setMenu(undefined)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={(event) => {
			if (event.key === "Tab") { close(); return; }
			if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)"));
			const index = items.indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
			items[next]?.focus();
		}}>
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => { close(); onUseReference(); }}><Icon name="imageSpark" size={16} />用作参考图</Button>
			<div className="generation-menu-divider" role="separator" />
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => void run(copy, "已复制图片")}><Icon name="copy" size={16} />复制</Button>
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => void run(() => {
				if (asset.job) return studio.images.assetAction("export", asset.id);
				const link = document.createElement("a"); link.href = asset.url; link.download = asset.name; link.click();
			})}><Icon name="down" size={16} />下载</Button>
			<div className="generation-menu-divider" role="separator" />
			<Button role="menuitemcheckbox" aria-checked={!!asset.favorite} tabIndex={-1} variant="ghost" onClick={() => void run(() => studio.setAssetFavorite(asset, !asset.favorite), asset.favorite ? "已取消收藏" : "已收藏")}><Icon name={asset.favorite ? "check" : "star"} size={16} />{asset.favorite ? "取消收藏" : "收藏"}</Button>
			<div className="generation-menu-divider" role="separator" />
			<Button role="menuitem" tabIndex={-1} variant="ghost" className="generation-menu-remove" disabled={!!studio.images.mutatingId} onClick={() => void run(async () => { if (!await studio.setAssetRemoved(asset, true)) throw new Error("移除失败"); })}><Icon name="archive" size={16} />删除</Button>
			{/* The status slot keeps its height even when idle so showing feedback
			    never resizes the popover and makes it jump. */}
			<span className="generation-copy-status" role="status" data-idle={feedback ? undefined : true}>{feedback || "\u00A0"}</span>
		</Popover>, document.body)}
	</article>;
}

/** Settled video jobs report the real file specs instead of the request. */
function videoSpecs(job: VideoJob) {
	return [job.actualWidth && job.actualHeight ? `${job.actualWidth} × ${job.actualHeight}` : "尺寸未知", job.actualDuration ? `${job.actualDuration.toFixed(2)} 秒` : "时长未知", job.actualFps ? `${Number(job.actualFps.toFixed(2))} fps` : "帧率未知"].join(" · ");
}

function videoUsage(usage: Record<string, unknown>) {
	const parts = [];
	if (typeof usage.billing_seconds === "number") parts.push(`计费时长 ${usage.billing_seconds} 秒`);
	if (typeof usage.videos === "number") parts.push(`${usage.videos} 段视频`);
	if (typeof usage.cost === "number") parts.push(`费用 ${usage.cost}${typeof usage.currency === "string" ? ` ${usage.currency}` : "（服务未提供币种）"}`);
	return parts.join(" · ") || "服务用量已记录";
}

/** The breathing placeholder a running generation shows in the answer slot. */
function PendingImageCard({ job, studio }: { job?: ImageJob; studio: GenerationStudio }) {
	const label = !job ? "正在提交创作…" : job.status === "saving" ? "正在保存图片…" : "正在生成图片…";
	return <article className="generation-card generation-pending-card" data-status={job?.status ?? "submitting"} aria-busy="true" aria-label="图片生成中">
		<div className="generation-pending-preview" aria-hidden="true"><span className="generation-pending-glow" /><span className="generation-pending-icon"><Icon name="imageSpark" size={28} /></span><span className="generation-pending-caption">让想象，慢慢成形</span></div>
		<div className="design-result-meta"><strong role="status">{label}</strong>{job && <Button size="compact" variant="ghost" onClick={() => void studio.images.cancel(job.id)}><Icon name="stop" size={12} />停止等待</Button>}</div>
	</article>;
}

function PendingVideoCard({ job, studio, onAbandon }: { job?: VideoJob; studio: GenerationStudio; onAbandon: (job: VideoJob) => void }) {
	const label = job ? videoJobLabels[job.status] : "正在准备并提交视频…";
	const progress = job && job.progress != null && videoJobActive(job) && job.status !== "downloading" ? ` ${job.progress}%` : "";
	return <article className="generation-card generation-pending-card" data-status={job?.status ?? "submitting"} aria-busy="true" aria-label="视频生成中">
		<div className="generation-pending-preview" aria-hidden="true"><span className="generation-pending-glow" /><span className="generation-pending-icon"><Icon name="video" size={26} /></span><span className="generation-pending-caption">让画面，多一点故事</span></div>
		<div className="design-result-meta">
			<strong role="status">{label}{progress}</strong>
			{job && videoJobActive(job) && job.status !== "submitting" && <Button size="compact" variant="ghost" disabled={studio.videos.controlling} onClick={() => void studio.videos.control(job.id, "pause")}>{job.status === "downloading" ? "暂停下载" : "暂停查询"}</Button>}
			{job && (job.status === "paused" || job.status === "download_failed") && job.remoteId && <Button size="compact" disabled={studio.videos.controlling} onClick={() => void studio.videos.control(job.id, "resume")}>{job.remoteStatus === "completed" ? "重新下载" : "继续查询"}</Button>}
			{job && (job.status === "paused" || job.status === "submission_unknown") && <Button size="compact" variant="ghost" disabled={studio.videos.controlling} onClick={() => onAbandon(job)}>结束跟踪</Button>}
		</div>
	</article>;
}

/** A settled job that produced nothing still belongs to the conversation: the
 *  flow keeps the failure next to its prompt instead of hiding it in a tab. */
function FailedTurn({ label, message, onReuse }: { label: string; message?: string; onReuse: () => void }) {
	return <article className="design-failure" role="alert"><Icon name="alert" size={16} /><div><strong>{label}</strong>{message && <p>{message}</p>}</div><Button size="compact" variant="ghost" onClick={onReuse}><Icon name="edit" size={14} />使用提示词</Button></article>;
}

type ThreadStatus = "done" | "pending" | "submitting" | "failed";
interface ThreadTurn {
	key: string;
	kind: GenerationKind;
	status: ThreadStatus;
	prompt: string;
	createdAt: number;
	asset?: GenerationAsset;
	imageJob?: ImageJob;
	videoJob?: VideoJob;
	/** Failure, cancellation or interruption copy for a settled job. */
	label?: string;
	message?: string;
}

export interface GenerationThreadProps {
	studio: GenerationStudio;
	kind: GenerationKind;
	/** Canvas scope; undefined means the home feed across every canvas. */
	canvasId?: string;
	active: boolean;
	onKind: (kind: GenerationKind) => void;
	onImageToVideo: (asset: GenerationAsset) => void;
	onImageToImage: (asset: GenerationAsset) => void;
	onSaveToProject: (asset: GenerationAsset) => void;
	saving: boolean;
}

/** One prompt bubble on the right, its work on the left, newest at the bottom.
 *  Canvases scope the flow and in-flight jobs join the timeline in place, so the
 *  studio reads as a conversation instead of a management dashboard. */
export function GenerationThread({ studio, kind, canvasId, active, onKind, onImageToVideo, onImageToImage, onSaveToProject, saving }: GenerationThreadProps) {
	const feed = useRef<HTMLDivElement>(null);
	const [selected, setSelected] = useState<GenerationAsset>();
	const [abandoning, setAbandoning] = useState<VideoJob>();
	const allCanvases = canvasId === undefined;
	const inScope = (item: { canvasId?: string }) => allCanvases || assetCanvasId(item, studio.canvases) === canvasId;
	const isRemoved = (asset: GenerationAsset) => !!(asset.job?.removed ?? asset.removed);
	const scoped = studio.assets.filter(inScope);
	const importedIndices = new Map(scoped.filter((asset) => asset.kind === kind && !asset.job && !asset.videoJob).map((asset, index) => [asset.id, index + 1]));
	const titleOf = (asset: GenerationAsset) => artworkTitle(asset, importedIndices.get(asset.id));
	const turns: ThreadTurn[] = [];
	for (const asset of scoped) {
		// Keep images available in video mode so its reference action can select a first frame.
		if ((kind === "image" && asset.kind !== "image") || isRemoved(asset)) continue;
		turns.push({
			key: asset.id, kind: asset.kind, status: "done", asset, createdAt: asset.createdAt,
			prompt: asset.prompt ?? "",
		});
	}
	if (kind === "image") {
		const jobs = studio.images.jobs.filter(inScope);
		const pending = jobs.filter(imageJobPending);
		for (const job of pending) turns.push({ key: job.id, kind, status: "pending", imageJob: job, prompt: job.prompt, createdAt: job.createdAt });
		if (studio.images.submitting && !pending.length) {
			const draft = studio.drafts.image;
			turns.push({ key: "image-submitting", kind, status: "submitting", prompt: draft.prompt, createdAt: Date.now() });
		}
		for (const job of jobs.filter((item) => !imageJobPending(item) && item.status !== "completed").sort((before, after) => after.createdAt - before.createdAt).slice(0, 6)) {
			turns.push({ key: job.id, kind, status: "failed", imageJob: job, prompt: job.prompt, createdAt: job.createdAt, label: job.status === "cancelled" ? "已停止等待" : job.status === "interrupted" ? "生成已中断" : "生成失败", message: job.message });
		}
	} else {
		const jobs = studio.videos.jobs.filter(inScope);
		// download_failed keeps its download retry, so it stays in the live group.
		const live = jobs.filter((job) => videoJobActive(job) || job.status === "paused" || job.status === "submission_unknown" || job.status === "download_failed");
		for (const job of live) turns.push({ key: job.id, kind, status: "pending", videoJob: job, prompt: job.prompt, createdAt: job.createdAt });
		if (studio.videos.submitting && !live.length) {
			const draft = studio.drafts.video;
			turns.push({ key: "video-submitting", kind, status: "submitting", prompt: draft.prompt, createdAt: Date.now() });
		}
		for (const job of jobs.filter((item) => item.status === "failed" || item.status === "abandoned").sort((before, after) => after.createdAt - before.createdAt).slice(0, 6)) {
			turns.push({ key: job.id, kind, status: "failed", videoJob: job, prompt: job.prompt, createdAt: job.createdAt, label: videoJobLabels[job.status], message: job.message });
		}
	}
	turns.sort((before, after) => before.createdAt - after.createdAt);
	const otherKind = scoped.filter((asset) => asset.kind !== kind && !isRemoved(asset)).length;
	const otherLabel = kind === "image" ? "视频" : "图片";
	// Only a new turn or a new in-flight task moves the viewport: polling an
	// existing job must never yank a reader away from older prompts.
	const signature = `${turns.length}:${turns.filter((turn) => turn.status !== "done").length}:${turns[turns.length - 1]?.key ?? ""}`;
	useEffect(() => {
		const node = feed.current;
		if (!node) return;
		const frame = requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
		return () => cancelAnimationFrame(frame);
	}, [signature, kind, canvasId]);
	useEffect(() => { if (!active) { setSelected(undefined); setAbandoning(undefined); } }, [active]);
	const reuse = (turn: ThreadTurn) => {
		const imageJob = turn.imageJob ?? turn.asset?.job;
		const videoJob = turn.videoJob ?? turn.asset?.videoJob;
		if (imageJob) reuseJob(studio, imageJob);
		else if (videoJob) reuseVideo(studio, videoJob);
		else studio.updateDraft(turn.kind, { prompt: turn.prompt });
		requestAnimationFrame(() => {
			const input = document.querySelector<HTMLTextAreaElement>(".design-dock textarea");
			input?.focus();
			if (input) input.setSelectionRange(input.value.length, input.value.length);
		});
	};
	// A dead service or an exhausted concurrency cap has no turn of its own, so
	// the flow keeps the one banner that explains why nothing is moving.
	const failure = kind === "image" ? studio.images.error : studio.videos.error;
	return <section className="design-thread" aria-label={allCanvases ? "全部生成记录" : "画布生成记录"}>
		{failure && <p className="design-thread-error" role="alert"><Icon name="alert" size={14} /><span>{failure}</span><Button size="compact" variant="ghost" onClick={() => void (kind === "image" ? studio.images.refresh() : studio.videos.refresh())}>重新读取状态</Button></p>}
		<div ref={feed} className="design-thread-feed">
			{turns.length ? <ol className="design-thread-list">{turns.map((turn) => <li className="design-turn" key={turn.key} data-status={turn.status}>
				<div className="design-user-message">
					<div className="design-bubble"><p className="design-bubble-prompt">{turn.prompt || (turn.asset ? `本地导入 · ${turn.asset.name}` : "（未填写提示词）")}</p></div>
					<div className="design-prompt-actions">
						{turn.prompt && <Tooltip text="使用提示词"><IconButton size="compact" variant="ghost" aria-label="使用提示词" onClick={() => reuse(turn)}><Icon name="edit" size={14} /></IconButton></Tooltip>}
						{turn.prompt && <CopyButton text={turn.prompt} label="复制提示词" iconOnly />}
						<time dateTime={new Date(turn.createdAt).toISOString()} title={new Date(turn.createdAt).toLocaleString()}>{new Date(turn.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
					</div>
				</div>
				<div className="design-result">
					{turn.status === "failed" ? <FailedTurn label={turn.label ?? "生成失败"} message={turn.message} onReuse={() => reuse(turn)} />
						: !turn.asset ? (turn.kind === "image" ? <PendingImageCard job={turn.imageJob} studio={studio} /> : <PendingVideoCard job={turn.videoJob} studio={studio} onAbandon={setAbandoning} />)
							: turn.asset.kind === "image" ? <ImageResultCard asset={turn.asset} studio={studio} active={active} onPreview={() => setSelected(turn.asset)} onUseReference={() => kind === "video" ? onImageToVideo(turn.asset!) : onImageToImage(turn.asset!)} />
							: <article className="generation-card design-result-card" data-kind={turn.asset.kind}>
								<div className="generation-card-media">
									<button type="button" className="generation-card-preview" aria-label={`预览视频：${turn.asset.name}`} onClick={() => setSelected(turn.asset)}><MediaView asset={turn.asset} /><span className="generation-card-play"><Icon name="video" size={24} /></span></button>
								</div>
							</article>}
				</div>
			</li>)}</ol> : <div className="design-thread-empty">
				<span className="design-thread-empty-icon"><Icon name={kind === "image" ? "imageSpark" : "video"} size={20} /></span>
				<p>{otherKind > 0 ? `这里还没有${kind === "image" ? "图片" : "视频"}，已有 ${otherKind} 件${otherLabel}。` : "还没有作品。写一句描述，第一张作品会出现在这里。"}</p>
				{otherKind > 0 && <Button size="compact" variant="ghost" onClick={() => onKind(kind === "image" ? "video" : "image")}><Icon name={kind === "image" ? "video" : "imageSpark"} size={14} />查看{otherLabel}</Button>}
			</div>}
		</div>
		{selected?.kind === "image" && <ImageLightbox key={selected.id} asset={selected} onClose={() => setSelected(undefined)} />}
		{selected?.kind === "video" && <Dialog className="generation-preview-dialog" aria-label="视频预览" returnFocusSelector=".design-result-card .generation-card-preview" onClose={() => setSelected(undefined)}>
			<header><div><strong>{titleOf(selected)}</strong><small>{selected.name}</small></div><IconButton size="compact" variant="ghost" aria-label="关闭作品预览" onClick={() => setSelected(undefined)}><Icon name="close" /></IconButton></header>
			<div className="generation-preview-media"><MediaView key={selected.id} asset={selected} playing /></div>
			<div className="generation-preview-info">
				{selected.prompt && <p>{selected.prompt}</p>}
				{selected.job && <small>图生图参考：{selected.job.reference?.name ?? "无"} · {selected.job.serviceName} · {selected.job.modelId} · {(selected.job.actualSize ?? selected.job.size).replace("x", " × ")} · {new Date(selected.createdAt).toLocaleString()}</small>}
				{selected.videoJob && <small>{selected.videoJob.serviceName} · {selected.videoJob.modelId} · {selected.videoJob.duration} 秒 · {selected.videoJob.ratio} · {new Date(selected.createdAt).toLocaleString()}</small>}
				{selected.videoJob && <small>实际成片：{videoSpecs(selected.videoJob)}</small>}
				{selected.videoJob?.usage && <small>服务返回用量：{videoUsage(selected.videoJob.usage)}</small>}
				{typeof selected.job?.usage?.total_tokens === "number" && <small>用量：{selected.job.usage.total_tokens} tokens</small>}
				{selected.videoJob && <div className="generation-saved-actions"><Button size="compact" variant="ghost" onClick={() => reuseVideo(studio, selected.videoJob!)}><Icon name="edit" size={14} />使用提示词</Button><Button size="compact" variant="ghost" onClick={() => void studio.videos.assetAction("export", selected.id)}><Icon name="down" size={14} />另存为</Button><Button size="compact" variant="ghost" onClick={() => void studio.videos.assetAction("reveal", selected.id)}><Icon name="folderOpen" size={14} />打开所在文件夹</Button></div>}
			</div>
			<footer>
				<Button size="compact" disabled={!studio.project || !(selected.path || selected.job?.path) || saving} onClick={() => { setSelected(undefined); onSaveToProject(selected); }}><Icon name="folderPlus" />保存至当前项目</Button>
				<Button size="compact" variant="ghost" disabled={!!studio.images.mutatingId} onClick={() => { void studio.setAssetRemoved(selected, true); setSelected(undefined); }}><Icon name="archive" size={14} />从作品流移除</Button>
			</footer>
		</Dialog>}
		{abandoning && <ConfirmDialog title="结束本地任务跟踪？" description="请先核对服务端记录。此操作不会取消远端任务，服务端可能继续生成并计费；结束后可提交新视频。" confirmText="已核对，结束跟踪" onClose={() => setAbandoning(undefined)} onConfirm={() => { void studio.videos.control(abandoning.id, "abandon"); }} />}
	</section>;
}
