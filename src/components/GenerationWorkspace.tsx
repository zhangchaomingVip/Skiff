import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { generationRatios, type GenerationAsset, type GenerationKind, type GenerationStudio } from "../workbench/useGenerationStudio";
import { Icon } from "./Icon";
import { Button, Chip, Dialog, IconButton, Input, Popover, SegmentedControl, Select, TextArea, Tooltip } from "./ui";
import { isMacPlatform } from "./settingsNavigation";
import "./generation-workspace.css";
import { imageJobPending, sizeRatio, type ImageJob } from "../workbench/imageGeneration";

const imageAccept = "image/png,image/jpeg,image/webp,image/gif";
const videoAccept = "video/mp4,video/webm,video/ogg,video/quicktime";
const titles = { image: "生图", video: "生成视频" };
type GalleryColumns = "1" | "2" | "3" | "4";
const galleryColumnsKey = "skiff.generation.columns.v1";
const imageRatios = ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"];

function readGalleryColumns(): GalleryColumns {
	try { const value = localStorage.getItem(galleryColumnsKey); return value === "1" || value === "2" || value === "4" ? value : "3"; }
	catch { return "3"; }
}

function imageResolution(size: string) {
	const longest = Math.max(...size.split("x").map(Number));
	return longest >= 3840 ? "4K" : longest >= 2048 ? "2K" : "1K";
}

function imageRatio(size: string) {
	const ratio = sizeRatio(size);
	return imageRatios.find((option) => sizeRatio(option.replace(":", "x")) === ratio) ?? ratio;
}

function RatioBox({ size }: { size: string }) {
	const [width, height] = size.split(/[x:]/).map(Number);
	const longest = Math.max(width, height) || 1;
	return <span className="generation-ratio-glyph" aria-hidden="true"><span className="generation-ratio-shape" style={{ width: `${width / longest * 100}%`, height: `${height / longest * 100}%` }} /></span>;
}

function ImageSizeControls({ size, sizes, onChange }: { size: string; sizes: string[]; onChange: (size: string) => void }) {
	const resolution = imageResolution(size);
	const ratio = size ? imageRatio(size) : "1:1";
	const resolutions = ["1K", "2K", ...(sizes.some((value) => imageResolution(value) === "4K") ? ["4K"] : [])];
	const ratios = [...imageRatios, ...new Set(sizes.map(imageRatio).filter((value) => !imageRatios.includes(value)))];
	const available = sizes.filter((value) => imageResolution(value) === resolution);
	return <>
		<fieldset className="generation-field generation-resolution"><legend>分辨率</legend><div role="group" aria-label="分辨率">{resolutions.map((option) => {
			const matches = sizes.filter((value) => imageResolution(value) === option);
			return <Button key={option} size="compact" variant="ghost" aria-pressed={resolution === option && sizes.length > 0} disabled={!matches.length} title={matches.length ? matches.map((value) => value.replace("x", " × ")).join("、") : `当前模型尚未配置 ${option} 尺寸`} onClick={() => onChange(matches.find((value) => imageRatio(value) === ratio) ?? matches[0])}>{option}</Button>;
		})}</div></fieldset>
		<fieldset className="generation-field generation-ratios generation-image-ratios"><legend>比例</legend><div role="group" aria-label="画面比例">{ratios.map((option) => {
			const match = available.find((value) => imageRatio(value) === option);
			return <Button key={option} size="compact" variant="ghost" aria-pressed={!!match && ratio === option} disabled={!match} title={match ? `${option} · ${match.replace("x", " × ")}` : `${resolution} 暂无此比例，请检查模型支持的尺寸`} onClick={() => { if (match) onChange(match); }}><RatioBox size={option} /><span>{option}</span></Button>;
		})}</div><p className="generation-field-hint">{size ? `输出尺寸：${size.replace("x", " × ")}` : "配置生成服务后，选择模型支持的分辨率与比例。"}</p></fieldset>
	</>;
}

function artworkTitle(asset: GenerationAsset, importedIndex = 1) {
	const prompt = asset.prompt?.trim().replace(/\s+/g, " ");
	if (!prompt) {
		if (asset.job) return "一瞬灵感";
		const name = asset.name.split(/[\\/]/).pop()?.trim() ?? "";
		const stem = name.replace(/\.[^.]+$/, "").replace(/ \(\d+\)$/, "");
		const opaque = /^(?:\{?[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\}?|[\da-f]{16,})$/i.test(stem);
		return !name || opaque ? `本地导入作品 ${String(importedIndex).padStart(2, "0")}` : name;
	}
	const letters = Array.from(prompt);
	return letters.length > 20 ? `${letters.slice(0, 20).join("")}…` : prompt;
}

function MediaView({ asset, playing = false }: { asset: Pick<GenerationAsset, "kind" | "url" | "name">; playing?: boolean }) {
	const [failed, setFailed] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (playing && videoRef.current) {
			videoRef.current.play().catch(() => {});
		}
	}, [playing, asset.url]);
	if (failed) return <div className="generation-media-failed" role="status"><Icon name={asset.kind === "image" ? "image" : "video"} size={24} /><span>暂时无法预览这个文件</span></div>;
	return asset.kind === "image" ? <img src={asset.url} alt={asset.name} onError={() => setFailed(true)} /> : <video ref={videoRef} src={asset.url} aria-label={asset.name} controls={playing} autoPlay={playing} muted loop playsInline preload="metadata" onError={() => setFailed(true)} />;
}

export function GenerationControls({ kind, studio, onConfigure }: { kind: GenerationKind; studio: GenerationStudio; onConfigure: () => void }) {
	const id = useId();
	const referenceInput = useRef<HTMLInputElement>(null);
	const promptInput = useRef<HTMLTextAreaElement>(null);
	const [dragging, setDragging] = useState(false);
	const draft = studio.drafts[kind];
	const video = kind === "video";
	const update = (patch: Partial<typeof draft>) => studio.updateDraft(kind, patch);
	const { images } = studio;
	const service = images.config?.services.find((item) => item.id === draft.serviceId);
	const model = service?.models.find((item) => item.id === draft.modelId);
	const configured = !video && !!service?.configured && !!model;
	const canGenerate = configured && !images.loading && !images.running && !images.submitting && !!draft.prompt.trim() && !!model?.sizes.includes(draft.size);
	return <aside className="generation-controls" data-kind={kind} aria-label={`${titles[kind]}参数`}>
		<header className="generation-controls-header"><span className="generation-mode-icon"><Icon name={video ? "video" : "imageSpark"} size={20} /></span><div><h1>{titles[kind]}</h1><p>{video ? "让画面，多一点故事" : "让想象，慢慢成形"}</p></div></header>
		<form className="generation-form" onSubmit={(event) => { event.preventDefault(); if (canGenerate) void images.generate({ serviceId: draft.serviceId, modelId: draft.modelId, prompt: draft.prompt, size: draft.size, quality: draft.quality }); }}>
			<div className="generation-fields">
				<div className="generation-field">
					<div className="generation-field-heading"><label htmlFor={`${id}-prompt`}>提示词 <span>Prompt</span></label>{!video && draft.prompt && <Tooltip text="清空提示词"><IconButton size="compact" variant="ghost" aria-label="清空提示词" onClick={() => { update({ prompt: "" }); promptInput.current?.focus(); }}><Icon name="close" size={14} /></IconButton></Tooltip>}</div>
					<TextArea ref={promptInput} id={`${id}-prompt`} rows={video ? 6 : 8} maxLength={32000} value={draft.prompt} aria-keyshortcuts={video ? undefined : "Control+Enter Meta+Enter"} placeholder={video ? "描述画面如何动起来：镜头缓缓推进，微风拂过窗边的花…" : "描述你想看到的画面：窗边的一束花、午后的柔光、温暖的胶片质感…"} onChange={(event) => update({ prompt: event.target.value })} onKeyDown={(event) => {
						if (!video && event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
							event.preventDefault(); event.stopPropagation();
							if (canGenerate && !event.repeat) event.currentTarget.form?.requestSubmit();
						}
					}} />
					<p className="generation-field-hint">{video ? "试着写下主体动作、镜头运动和氛围。" : "试着写下主体、光线、色彩和你喜欢的风格。"}</p>
				</div>
				{!video && <div className="generation-field"><label htmlFor={`${id}-provider`}>生成服务</label><div className="generation-service-control"><Select id={`${id}-provider`} value={draft.serviceId} disabled={!images.config?.services.length} onChange={(event) => { const next = images.config?.services.find((item) => item.id === event.target.value); const first = next?.models.find((item) => item.id === next.defaultModel) ?? next?.models[0]; update({ serviceId: next?.id ?? "", modelId: first?.id ?? "", size: first?.sizes[0] ?? "" }); }}>{images.config?.services.length ? images.config.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">先配置一个生成服务</option>}</Select><Tooltip text={configured ? "管理生成服务" : "配置生成服务"}><IconButton variant="ghost" aria-label={configured ? "管理生成服务" : "配置生成服务"} onClick={onConfigure}><Icon name="settings" size={16} /></IconButton></Tooltip></div></div>}
				<div className="generation-field"><label htmlFor={`${id}-model`}>模型</label><Select id={`${id}-model`} value={draft.modelId} disabled={!configured} aria-describedby={`${id}-service`} onChange={(event) => { const next = service?.models.find((item) => item.id === event.target.value); update({ modelId: next?.id ?? "", size: next?.sizes[0] ?? "" }); }}>{configured ? service.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>) : <option value="">连接生成服务后选择模型</option>}</Select></div>
				{video ? <fieldset className="generation-field generation-ratios"><legend>画面比例</legend><div role="group" aria-label="画面比例">{generationRatios.map((ratio) => <Button key={ratio} size="compact" variant="ghost" aria-pressed={draft.ratio === ratio} onClick={() => update({ ratio })}><span className="generation-ratio-shape" style={{ aspectRatio: ratio.replace(":", "/") }} aria-hidden="true" />{ratio}</Button>)}</div></fieldset> : <ImageSizeControls size={draft.size} sizes={model?.sizes ?? []} onChange={(size) => update({ size })} />}
				{configured && <div className="generation-field"><label htmlFor={`${id}-quality`}>质量</label><Select id={`${id}-quality`} value={draft.quality} onChange={(event) => update({ quality: event.target.value })}><option value="auto">自动</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option></Select><p className="generation-field-hint">更大的尺寸和更高的质量可能增加耗时与费用。</p></div>}
				{video && <>
					<div className="generation-field"><label htmlFor={`${id}-motion`}>运动幅度 <output htmlFor={`${id}-motion`}>{draft.motion < 34 ? "轻柔" : draft.motion < 67 ? "适中" : "灵动"} · {draft.motion}%</output></label><Input id={`${id}-motion`} className="generation-range" type="range" min={0} max={100} step={1} value={draft.motion} onChange={(event) => update({ motion: Number(event.target.value) })} /><div className="generation-range-ends"><span>轻柔</span><span>灵动</span></div></div>
					<div className="generation-field"><label htmlFor={`${id}-duration`}>时长 <output htmlFor={`${id}-duration`}>{draft.duration} 秒</output></label><Input id={`${id}-duration`} className="generation-range" type="range" min={2} max={15} step={1} value={draft.duration} onChange={(event) => update({ duration: Number(event.target.value) })} /><div className="generation-range-ends"><span>2 秒</span><span>15 秒</span></div></div>
					<div className="generation-field"><label htmlFor={`${id}-fps`}>帧率 <output htmlFor={`${id}-fps`}>{draft.fps} fps</output></label><Input id={`${id}-fps`} className="generation-range" type="range" min={12} max={60} step={1} value={draft.fps} onChange={(event) => update({ fps: Number(event.target.value) })} /><div className="generation-range-ends"><span>12 fps</span><span>60 fps</span></div></div>
					<div className="generation-field">
						<span className="generation-field-label">首帧参考图 <small>可选</small></span>
						<Input ref={referenceInput} className="generation-file-input" type="file" accept={imageAccept} aria-label="上传首帧参考图" onChange={(event) => { const file = event.target.files?.[0]; if (file) studio.uploadReference(file); event.target.value = ""; }} />
						<div className={`generation-reference ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) studio.uploadReference(file); }}>
							{studio.reference ? <><div className="generation-reference-image"><MediaView key={studio.reference.url} asset={{ ...studio.reference, kind: "image" }} /></div><div className="generation-reference-caption"><span title={studio.reference.name}>{studio.reference.name}</span><IconButton size="compact" variant="ghost" aria-label="移除首帧参考图" onClick={studio.removeReference}><Icon name="close" /></IconButton></div><Button size="compact" variant="ghost" onClick={() => referenceInput.current?.click()}>替换图片</Button></> : <button type="button" className="generation-reference-upload" onClick={() => referenceInput.current?.click()}><Icon name="image" size={24} /><strong>添加一张起始画面</strong><span>点击上传，或将图片拖到这里</span></button>}
						</div>
						<p className="generation-field-hint">PNG、JPG、WebP、GIF · 最大 20 MB</p>
					</div>
				</>}
				{video && studio.referenceError && <div className="generation-error" role="alert"><span>{studio.referenceError}</span><IconButton size="compact" variant="ghost" aria-label="关闭文件提示" onClick={studio.clearReferenceError}><Icon name="close" /></IconButton></div>}
			</div>
			<footer className="generation-submit"><p id={`${id}-service`}><span className="generation-connection-dot" />{video ? "尚未连接视频生成服务" : images.loading ? "正在读取图片生成服务" : images.running ? "图片正在生成，可切换到其他页面" : configured ? `使用 ${service.name}` : "尚未配置图片生成服务"}</p><Button type="submit" variant="primary" size="primary" disabled={!canGenerate} aria-describedby={`${id}-service`} loading={!video && images.submitting}><Icon name={video ? "video" : "spark"} />{video ? "生成视频" : "生成图片"}</Button>{!video && <span className="generation-shortcut">快速生成 <kbd>{isMacPlatform() ? "⌘" : "Ctrl"} ↵</kbd></span>}<small>{video ? "先收好灵感，连接服务后就能开始创作。" : "每次生成一张，按服务商计费；作品自动保存。"}</small></footer>
		</form>
	</aside>;
}

function GenerationEmpty({ kind, onImport }: { kind: GenerationKind; onImport: () => void }) {
	const video = kind === "video";
	return <div className="generation-empty">
		<div className="generation-empty-art" aria-hidden="true"><span className="generation-empty-back" /><span className="generation-empty-frame"><Icon name={video ? "video" : "image"} size={24} /></span><span className="generation-empty-spark"><Icon name="spark" size={16} /></span></div>
		<h2>{video ? "让灵感动起来" : "从一个画面开始"}</h2>
		<p>{video ? "一阵风、一个回眸、一段光影。\n把想象写下来，留给下一段故事。" : "一束光、一种颜色、一个小小的念头。\n写下你的灵感，让它有机会成为画面。"}</p>
		<Button variant="ghost" size="compact" onClick={onImport}><Icon name="plus" />{video ? "导入一段视频" : "导入一张图片"}</Button>
		<small>生成的作品会出现在这里，也可以先看看已有的作品。</small>
	</div>;
}

function reuseJob(studio: GenerationStudio, job: ImageJob) {
	const service = studio.images.config?.services.find((item) => item.id === job.serviceId);
	const model = service?.models.find((item) => item.id === job.modelId);
	studio.updateDraft("image", { prompt: job.prompt, ...(model ? { serviceId: service!.id, modelId: model.id, size: model.sizes.includes(job.size) ? job.size : model.sizes[0], quality: job.quality } : {}) });
}

function SavedImageActions({ studio, asset }: { studio: GenerationStudio; asset: GenerationAsset }) {
	if (!asset.job) return null;
	return <div className="generation-saved-actions"><Button size="compact" variant="ghost" onClick={() => reuseJob(studio, asset.job!)}><Icon name="edit" size={14} />使用提示词</Button><Button size="compact" variant="ghost" onClick={() => void studio.images.assetAction("export", asset.id)}><Icon name="down" size={14} />另存为</Button><Button size="compact" variant="ghost" onClick={() => void studio.images.assetAction("reveal", asset.id)}><Icon name="folderOpen" size={14} />打开所在文件夹</Button></div>;
}

function usePromptCopy(prompt: string) {
	const [copyStatus, setCopyStatus] = useState("");
	const timer = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => () => clearTimeout(timer.current), []);
	const copyPrompt = async () => {
		try { await navigator.clipboard.writeText(prompt); setCopyStatus("已复制提示词"); }
		catch { setCopyStatus("复制失败，请重试"); }
		clearTimeout(timer.current); timer.current = setTimeout(() => setCopyStatus(""), 2000);
	};
	return { copyStatus, copyPrompt };
}

function ImageHoverActions({ studio, asset }: { studio: GenerationStudio; asset: GenerationAsset }) {
	const { copyStatus, copyPrompt } = usePromptCopy(asset.prompt ?? "");
	return <div className="generation-hover-actions" role="group" aria-label="作品快捷操作">
		<Tooltip text="使用提示词"><IconButton size="compact" variant="ghost" aria-label="使用提示词" onClick={() => reuseJob(studio, asset.job!)}><Icon name="edit" size={16} /></IconButton></Tooltip>
		<Tooltip text={copyStatus || "复制提示词"}><IconButton size="compact" variant="ghost" aria-label="复制提示词" onClick={() => void copyPrompt()}><Icon name={copyStatus === "已复制提示词" ? "check" : "copy"} size={16} /></IconButton></Tooltip>
		<Tooltip text="另存为"><IconButton size="compact" variant="ghost" aria-label="另存为" onClick={() => void studio.images.assetAction("export", asset.id)}><Icon name="down" size={16} /></IconButton></Tooltip>
		{copyStatus && <span className="generation-hover-feedback" role="status">{copyStatus}</span>}
	</div>;
}

function ImageActionsMenu({ studio, asset, onImageToVideo }: { studio: GenerationStudio; asset: GenerationAsset; onImageToVideo: () => void }) {
	const trigger = useRef<HTMLButtonElement>(null);
	const id = useId();
	const [open, setOpen] = useState(false);
	const { copyStatus, copyPrompt } = usePromptCopy(asset.prompt ?? "");
	const focusLast = useRef(false);
	useEffect(() => {
		if (!open) return;
		const items = document.getElementById(id)?.querySelectorAll<HTMLElement>("[role=menuitem]");
		if (items?.length) items[focusLast.current ? items.length - 1 : 0].focus();
	}, [open, id]);
	const close = () => { setOpen(false); trigger.current?.focus(); };
	const action = (run: () => void) => { close(); run(); };
	return <>
		<Tooltip text="更多作品操作"><IconButton ref={trigger} size="compact" variant="ghost" className="generation-more-trigger" aria-label={`更多作品操作：${artworkTitle(asset)}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { focusLast.current = false; setOpen((value) => !value); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); focusLast.current = event.key === "ArrowUp"; setOpen(true); } }}><Icon name="more" size={16} /></IconButton></Tooltip>
		{open && createPortal(<Popover anchor={trigger} id={id} role="menu" aria-label="作品操作" className="generation-actions-menu" onClose={() => setOpen(false)} onKeyDown={(event) => {
			if (event.key === "Tab") { close(); return; }
			if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
			const index = items.indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
			items[next]?.focus();
		}}>
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => action(() => reuseJob(studio, asset.job!))}><Icon name="edit" size={16} />使用提示词</Button>
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => void copyPrompt()}><Icon name={copyStatus === "已复制提示词" ? "check" : "copy"} size={16} />复制提示词</Button>
			{copyStatus && <span className="generation-copy-status" role="status">{copyStatus}</span>}
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => action(() => void studio.images.assetAction("export", asset.id))}><Icon name="down" size={16} />另存为</Button>
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => action(() => void studio.images.assetAction("reveal", asset.id))}><Icon name="folderOpen" size={16} />打开所在文件夹</Button>
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => action(onImageToVideo)}><Icon name="video" size={16} />以此图生成视频</Button>
		</Popover>, trigger.current?.closest("dialog") ?? document.body)}
	</>;
}

function PendingImageCard({ job, studio }: { job?: ImageJob; studio: GenerationStudio }) {
	const draft = studio.drafts.image;
	return <article className="generation-card generation-pending-card" data-status={job?.status ?? "submitting"} aria-busy="true" aria-label="图片生成中">
		<div className="generation-pending-preview" aria-hidden="true"><span className="generation-pending-glow" /><span className="generation-pending-icon"><Icon name="imageSpark" size={28} /></span><span className="generation-pending-caption">让想象，慢慢成形</span></div>
		<div className="generation-pending-content"><strong role="status">{!job ? "正在提交创作…" : job.status === "saving" ? "正在保存图片…" : "正在生成图片…"}</strong><p title={job?.prompt ?? draft.prompt}>{job?.prompt ?? draft.prompt}</p><small>{job?.modelId ?? draft.modelId} · {(job?.size ?? draft.size).replace("x", " × ")}</small>{job && <Button size="compact" variant="ghost" onClick={() => void studio.images.cancel(job.id)}><Icon name="stop" size={12} />停止等待</Button>}<small>停止等待后，服务端可能继续生成并计费。</small></div>
	</article>;
}

function GenerationTaskHistory({ jobs, studio }: { jobs: ImageJob[]; studio: GenerationStudio }) {
	if (!jobs.length) return null;
	return <div className="generation-task-list" aria-label="生成任务">{jobs.map((job) => <article className="generation-task" key={job.id} data-status={job.status}><div><strong role="status">{job.status === "cancelled" ? "已停止等待" : job.status === "interrupted" ? "生成已中断" : "生成失败"}</strong><p>{job.prompt}</p><small>{job.serviceName} · {job.modelId} · {job.size.replace("x", " × ")}</small>{job.message && <p className="generation-task-message">{job.message}</p>}</div><Button size="compact" onClick={() => reuseJob(studio, job)}>使用提示词</Button></article>)}</div>;
}

export function GenerationGallery({ kind, studio, onParameters, onBack, onImageToVideo }: { kind: GenerationKind; studio: GenerationStudio; onParameters: () => void; onBack: () => void; onImageToVideo: (asset: GenerationAsset) => void }) {
	const fileInput = useRef<HTMLInputElement>(null);
	const galleryScroll = useRef<HTMLDivElement>(null);
	const [selected, setSelected] = useState<GenerationAsset>();
	const [columns, setColumns] = useState<GalleryColumns>(readGalleryColumns);
	useEffect(() => { try { localStorage.setItem(galleryColumnsKey, columns); } catch { /* Density still works when storage is unavailable. */ } }, [columns]);
	const assets = studio.assets.filter((asset) => asset.kind === kind);
	const importedIndices = new Map(assets.filter((asset) => !asset.job).map((asset, index) => [asset.id, index + 1]));
	const titleOf = (asset: GenerationAsset) => artworkTitle(asset, importedIndices.get(asset.id));
	const video = kind === "video";
	const tasks = video ? [] : studio.images.jobs.filter((job) => job.status !== "completed");
	const pending = tasks.filter(imageJobPending);
	const settled = tasks.filter((job) => !imageJobPending(job));
	const hasPending = !video && (pending.length > 0 || studio.images.submitting);
	useEffect(() => { if (hasPending) galleryScroll.current?.scrollTo({ top: 0 }); }, [hasPending]);
	const importMedia = () => fileInput.current?.click();
	return <section className="generation-gallery" data-columns={video ? undefined : columns} aria-label={video ? "视频画廊" : "图片画廊"}>
		<header className="generation-workspace-header"><Button size="compact" variant="ghost" onClick={onBack}><Icon name="message" />返回对话</Button><span /><Button size="compact" variant="ghost" onClick={onParameters}><Icon name="sliders" />创作参数</Button></header>
		<div ref={galleryScroll} className="generation-gallery-scroll">
			<div className="generation-gallery-heading"><div><span className="generation-eyebrow">{video ? "MOTION STUDIO" : "IMAGE STUDIO"}</span><h2>{video ? "光影成片" : "灵感画廊"}<span>{assets.length.toString().padStart(2, "0")}</span></h2><p>{video ? "把静止的瞬间，接成流动的故事。" : "把脑海里的风景，留在这里。"}</p></div><div className="generation-gallery-heading-actions">{!video && <SegmentedControl label="画廊列数" value={columns} onChange={setColumns} options={[{ value: "1", label: "1 列" }, { value: "2", label: "2 列" }, { value: "3", label: "3 列" }, { value: "4", label: "4 列" }]} />}<Button className="generation-import" variant="ghost" size="compact" onClick={importMedia}><Icon name="plus" size={14} />导入作品</Button></div></div>
			<Input ref={fileInput} className="generation-file-input" type="file" multiple accept={video ? videoAccept : imageAccept} aria-label={video ? "导入视频作品" : "导入图片作品"} onChange={(event) => { studio.importAssets(kind, Array.from(event.target.files ?? [])); event.target.value = ""; }} />
			{studio.errors[kind] && <p className="generation-gallery-error" role="alert">{studio.errors[kind]}</p>}
			{!video && studio.images.error && <div className="generation-gallery-error" role="alert">{studio.images.error}<Button size="compact" onClick={() => void studio.images.refresh()}>重新读取状态</Button></div>}
			{!hasPending && <GenerationTaskHistory jobs={settled} studio={studio} />}
			{(assets.length > 0 || hasPending) && <div className="generation-gallery-grid">
				{hasPending && !pending.length && <PendingImageCard studio={studio} />}
				{pending.map((job) => <PendingImageCard key={job.id} job={job} studio={studio} />)}
				{assets.map((asset) => <article className="generation-card" key={asset.id} data-kind={asset.kind}>
				<div className="generation-card-media"><button className="generation-card-preview" aria-label={`预览${video ? "视频" : "图片"}：${asset.name}`} onClick={() => setSelected(asset)}><MediaView asset={asset} />{video && <span className="generation-card-play"><Icon name="video" size={24} /></span>}</button>{!video && asset.job && <ImageHoverActions studio={studio} asset={asset} />}</div>
				<div className="generation-card-caption"><strong title={asset.prompt ?? asset.name}>{titleOf(asset)}</strong>{asset.job ? <ImageActionsMenu studio={studio} asset={asset} onImageToVideo={() => onImageToVideo(asset)} /> : <Chip>本地导入</Chip>}</div>
				{asset.job && <div className="generation-asset-info"><span title={asset.job.modelId}>{asset.job.modelId}</span><span>{(asset.job.actualSize ?? asset.job.size).replace("x", " × ")}</span><span className="sr-only">生成作品</span></div>}
				{!video && !asset.job && <div className="generation-card-actions"><Button size="compact" onClick={() => onImageToVideo(asset)}><Icon name="video" />以此图生成视频</Button></div>}
			</article>)}
			</div>}
			{hasPending && <GenerationTaskHistory jobs={settled} studio={studio} />}
			{assets.length > 0 && <p className="generation-session-note">{!video && "生成作品已保存在本机 · "}本地导入内容仅在当前会话中保留</p>}
			{!assets.length && !tasks.length && !hasPending && <GenerationEmpty kind={kind} onImport={importMedia} />}
		</div>
		{selected && <Dialog className="generation-preview-dialog" aria-label={video ? "视频预览" : "图片预览"} onClose={() => setSelected(undefined)}><header><div><strong>{titleOf(selected)}</strong><small>{selected.job ? selected.name : video ? "循环播放" : "图片预览"}</small></div><IconButton size="compact" variant="ghost" aria-label="关闭作品预览" onClick={() => setSelected(undefined)}><Icon name="close" /></IconButton></header><div className="generation-preview-media"><MediaView key={selected.id} asset={selected} playing /></div>{selected.job && <div className="generation-preview-info"><p>{selected.prompt}</p><small>{selected.job.serviceName} · {selected.job.modelId} · {selected.job.actualSize ?? selected.job.size} · {new Date(selected.createdAt).toLocaleString()}</small>{typeof selected.job.usage?.total_tokens === "number" && <small>用量：{selected.job.usage.total_tokens} tokens</small>}<SavedImageActions studio={studio} asset={selected} /></div>}{!video && <footer><Button size="compact" onClick={() => { setSelected(undefined); onImageToVideo(selected); }}><Icon name="video" />以此图生成视频</Button></footer>}</Dialog>}
	</section>;
}
