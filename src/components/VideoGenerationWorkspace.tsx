import { useEffect, useId, useRef, useState } from "react";
import type { GenerationAsset, GenerationStudio } from "../workbench/useGenerationStudio";
import { videoJobActive, videoJobLabels, type VideoJob } from "../workbench/videoGeneration";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, Chip, Dialog, IconButton, Input, Select, TextArea, Tooltip } from "./ui";
import type { GenerationGalleryProps } from "./GenerationWorkspace";
import { assetsInCollection } from "../workbench/designWorkspace";

export function VideoControls({ studio, onConfigure }: { studio: GenerationStudio; onConfigure: () => void }) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const { videos, drafts: { video: draft } } = studio;
	const service = videos.config?.services.find((item) => item.id === draft.serviceId);
	const model = service?.models.find((item) => item.id === draft.modelId);
	const configured = !!service?.configured && !!model;
	const update = (patch: Partial<typeof draft>) => studio.updateDraft("video", patch);
	const canGenerate = configured && !videos.loading && !videos.submitting && !videos.running && !!draft.prompt.trim() && model.durations.includes(draft.duration) && model.ratios.includes(draft.ratio) && (!studio.reference || model.referenceEnabled);
	return <aside className="generation-controls" data-kind="video" aria-label="生成视频参数">
		<header className="generation-controls-header"><span className="generation-mode-icon"><Icon name="video" size={20} /></span><div><h1>生成视频</h1><p>让画面，多一点故事</p></div></header>
		<form className="generation-form" onSubmit={(event) => { event.preventDefault(); if (canGenerate) void videos.generate({ serviceId: draft.serviceId, modelId: draft.modelId, prompt: draft.prompt, duration: draft.duration, ratio: draft.ratio, projectRoot: studio.project?.path }, studio.reference?.url); }}>
			<div className="generation-fields">
				<div className="generation-field"><div className="generation-field-heading"><label htmlFor={`${id}-prompt`}>提示词 <span>Prompt</span></label></div><TextArea id={`${id}-prompt`} rows={6} maxLength={32000} value={draft.prompt} placeholder="描述画面如何动起来：镜头缓缓推进，微风拂过窗边的花…" onChange={(event) => update({ prompt: event.target.value })} /><p className="generation-field-hint">试着写下主体动作、镜头运动和氛围。</p></div>
				<div className="generation-field"><label htmlFor={`${id}-service`}>生成服务</label><div className="generation-service-control"><Select id={`${id}-service`} value={draft.serviceId} disabled={!videos.config?.services.length} onChange={(event) => { const next = videos.config?.services.find((item) => item.id === event.target.value); const first = next?.models.find((item) => item.id === next.defaultModel) ?? next?.models[0]; update({ serviceId: next?.id ?? "", modelId: first?.id ?? "", duration: first?.durations[0] ?? 5, ratio: "9:16" }); }}>{videos.config?.services.length ? videos.config.services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">先配置一个视频服务</option>}</Select><Tooltip text={configured ? "管理视频服务" : "配置视频服务"}><IconButton variant="ghost" aria-label={configured ? "管理视频服务" : "配置视频服务"} onClick={onConfigure}><Icon name="settings" size={16} /></IconButton></Tooltip></div></div>
				<div className="generation-field"><label htmlFor={`${id}-model`}>模型</label><Select id={`${id}-model`} value={draft.modelId} disabled={!configured} onChange={(event) => update({ modelId: event.target.value })}>{configured ? service.models.map((item) => <option key={item.id} value={item.id}>{item.id}</option>) : <option value="">连接生成服务后选择模型</option>}</Select></div>
				<fieldset className="generation-field generation-ratios"><legend>画面比例</legend><div role="group" aria-label="画面比例"><Button size="compact" variant="ghost" aria-pressed={draft.ratio === "9:16"} onClick={() => update({ ratio: "9:16" })}>9:16</Button></div></fieldset>
				<div className="generation-field"><label htmlFor={`${id}-duration`}>时长</label><Select id={`${id}-duration`} value={draft.duration} onChange={(event) => update({ duration: Number(event.target.value) })}><option value={5}>5 秒</option></Select><p className="generation-field-hint">首版开放 5 秒竖屏。实际分辨率以成片为准。</p></div>
				<div className="generation-field"><span className="generation-field-label">首帧参考图 <small>可选</small></span><Input ref={input} className="generation-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传首帧参考图" onChange={(event) => { const file = event.target.files?.[0]; if (file) studio.uploadReference(file); event.target.value = ""; }} />
					<div className={`generation-reference ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) studio.uploadReference(file); }}>
						{studio.reference ? <><div className="generation-reference-image"><img src={studio.reference.url} alt={studio.reference.name} /></div><div className="generation-reference-caption"><span title={studio.reference.name}>{studio.reference.name}</span><IconButton size="compact" variant="ghost" aria-label="移除首帧参考图" onClick={studio.removeReference}><Icon name="close" /></IconButton></div><Button size="compact" variant="ghost" onClick={() => input.current?.click()}>替换图片</Button></> : <button type="button" className="generation-reference-upload" onClick={() => input.current?.click()}><Icon name="image" size={24} /><strong>添加一张起始画面</strong><span>点击上传，或将图片拖到这里</span></button>}
					</div><p className="generation-field-hint">PNG、JPG、WebP、GIF · 最大 20 MB。上传后压缩为静态首帧，生成时发送给视频服务。</p>
				</div>
				{studio.reference && !model?.referenceEnabled && <p className="generation-field-hint" role="status">当前模型未启用单图参考。请移除参考图使用文生视频，或在视频设置中启用实验性单图参考。</p>}
				{studio.referenceError && <p className="generation-error" role="alert">{studio.referenceError}<IconButton size="compact" variant="ghost" aria-label="关闭文件提示" onClick={studio.clearReferenceError}><Icon name="close" /></IconButton></p>}
			</div>
			<footer className="generation-submit"><p id={`${id}-connection`}><span className="generation-connection-dot" />{videos.loading ? "正在读取视频服务" : videos.running ? "已有视频任务，可在作品区查看或继续查询" : configured ? `使用 ${service.name}` : "尚未配置视频生成服务"}</p><Button type="submit" variant="primary" size="primary" disabled={!canGenerate} loading={videos.submitting} aria-describedby={`${id}-connection`}><Icon name="video" />生成视频</Button><small>按服务商计费；作品自动保存。暂停查询不会停止服务端计费。</small></footer>
		</form>
	</aside>;
}

function reuseVideo(studio: GenerationStudio, job: VideoJob) {
	const service = studio.videos.config?.services.find((item) => item.id === job.serviceId);
	const model = service?.models.find((item) => item.id === job.modelId);
	studio.updateDraft("video", { prompt: job.prompt, ...(model ? { serviceId: service!.id, modelId: model.id, duration: job.duration, ratio: "9:16" } : {}) });
}
function actualSpecs(job: VideoJob) {
	return [job.actualWidth && job.actualHeight ? `${job.actualWidth} × ${job.actualHeight}` : "尺寸未知", job.actualDuration ? `${job.actualDuration.toFixed(2)} 秒` : "时长未知", job.actualFps ? `${Number(job.actualFps.toFixed(2))} fps` : "帧率未知"].join(" · ");
}
function usageText(usage: Record<string, unknown>) {
	const parts = [];
	if (typeof usage.billing_seconds === "number") parts.push(`计费时长 ${usage.billing_seconds} 秒`);
	if (typeof usage.videos === "number") parts.push(`${usage.videos} 段视频`);
	if (typeof usage.cost === "number") parts.push(`费用 ${usage.cost}${typeof usage.currency === "string" ? ` ${usage.currency}` : "（服务未提供币种）"}`);
	return parts.join(" · ") || "服务用量已记录";
}
function VideoActions({ studio, job }: { studio: GenerationStudio; job: VideoJob }) {
	return <div className="generation-saved-actions"><Button size="compact" variant="ghost" onClick={() => reuseVideo(studio, job)}><Icon name="edit" size={14} />使用提示词</Button><Button size="compact" variant="ghost" onClick={() => void studio.videos.assetAction("export", job.id)}><Icon name="down" size={14} />另存为</Button><Button size="compact" variant="ghost" onClick={() => void studio.videos.assetAction("reveal", job.id)}><Icon name="folderOpen" size={14} />打开所在文件夹</Button></div>;
}
function VideoPlayer({ asset, playing = false }: { asset: GenerationAsset; playing?: boolean }) {
	const [failed, setFailed] = useState(false);
	const videoRef = useRef<HTMLVideoElement>(null);
	useEffect(() => { if (playing) void videoRef.current?.play().catch(() => {}); }, [playing, asset.url]);
	if (failed) return <div className="generation-media-failed" role="status"><Icon name="video" size={24} /><span>暂时无法预览这个文件</span></div>;
	return <video ref={videoRef} src={asset.url} aria-label={asset.name} controls={playing} autoPlay={playing} muted loop playsInline preload="metadata" onError={() => setFailed(true)} />;
}
export function VideoGallery({ studio, onParameters, collection, active, onSaveToProject, saving }: GenerationGalleryProps) {
	const input = useRef<HTMLInputElement>(null);
	const [selected, setSelected] = useState<GenerationAsset>();
	const [abandoning, setAbandoning] = useState<VideoJob>();
	const { videos } = studio;
	const assets = assetsInCollection(studio.assets.filter((asset) => asset.kind === "video"), collection);
	const tasks = videos.jobs.filter((job) => collection === "failures" ? ["failed", "abandoned", "submission_unknown", "download_failed"].includes(job.status) : collection === "tasks" ? videoJobActive(job) : job.status !== "completed");
	useEffect(() => { if (!active) { setSelected(undefined); setAbandoning(undefined); } }, [active]);
	return <section className="generation-gallery" aria-label="视频画廊">
		<header className="generation-workspace-header"><span className="design-gallery-breadcrumb"><Icon name="video" size={16} />Design / 视频</span><span /><Button size="compact" variant="ghost" onClick={onParameters}><Icon name="sliders" />创作参数</Button></header>
		<div className="generation-gallery-scroll">
			<div className="generation-gallery-heading"><div><span className="generation-eyebrow">MOTION STUDIO</span><h2>光影成片<span>{assets.length.toString().padStart(2, "0")}</span></h2><p>把静止的瞬间，接成流动的故事。</p></div><Button className="generation-import" variant="ghost" size="compact" onClick={() => input.current?.click()}><Icon name="plus" size={14} />导入作品</Button></div>
			<Input ref={input} className="generation-file-input" type="file" multiple accept="video/mp4,video/webm,video/ogg,video/quicktime" aria-label="导入视频作品" onChange={(event) => { studio.importAssets("video", Array.from(event.target.files ?? [])); event.target.value = ""; }} />
			{studio.errors.video && <p className="generation-gallery-error" role="alert">{studio.errors.video}</p>}
			{videos.error && <div className="generation-gallery-error" role="alert">{videos.error}<Button size="compact" onClick={() => void videos.refresh()}>重新读取状态</Button></div>}
			{videos.submitting && !tasks.some(videoJobActive) && <p role="status">正在准备并提交视频…</p>}
			{!!tasks.length && <div className="generation-task-list" aria-label="视频生成任务">{tasks.map((job) => <article className="generation-task" data-status={job.status} key={job.id} aria-busy={videoJobActive(job)}><div><strong role="status">{videoJobLabels[job.status]}{job.progress != null && videoJobActive(job) && job.status !== "downloading" ? ` ${job.progress}%` : ""}</strong><p>{job.prompt}</p><small>{job.serviceName} · {job.modelId} · {job.duration} 秒 · {job.ratio}{job.hasReference ? " · 首帧参考" : ""}</small>{job.remoteId && <small>任务：{job.remoteId}</small>}{job.message && <p className="generation-task-message">{job.message}</p>}<div className="generation-saved-actions">
				{videoJobActive(job) && job.status !== "submitting" && <Button size="compact" variant="ghost" disabled={videos.controlling} onClick={() => void videos.control(job.id, "pause")}>{job.status === "downloading" ? "暂停下载" : "暂停查询"}</Button>}
				{(job.status === "paused" || job.status === "download_failed") && job.remoteId && <Button size="compact" disabled={videos.controlling} onClick={() => void videos.control(job.id, "resume")}>{job.remoteStatus === "completed" ? "重新下载" : "继续查询"}</Button>}
				{(job.status === "paused" || job.status === "submission_unknown") && <Button size="compact" variant="ghost" disabled={videos.controlling} onClick={() => setAbandoning(job)}>核对后结束跟踪</Button>}
				<Button size="compact" variant="ghost" onClick={() => reuseVideo(studio, job)}>使用提示词</Button>
			</div>{videoJobActive(job) && <small>暂停仅停止本地等待，服务端可能继续生成并计费。</small>}</div></article>)}</div>}
			{!!assets.length && <div className="generation-gallery-grid">{assets.map((asset) => <article className="generation-card" data-kind="video" key={asset.id}><div className="generation-card-media"><button className="generation-card-preview" aria-label={`预览视频：${asset.name}`} onClick={() => setSelected(asset)}><VideoPlayer asset={asset} /><span className="generation-card-play"><Icon name="video" size={24} /></span></button></div><div className="generation-card-caption"><strong title={asset.prompt ?? asset.name}>{asset.prompt?.slice(0, 24) || asset.name}</strong><Chip>{asset.videoJob ? "生成作品" : "本地导入"}</Chip></div>{asset.videoJob && <><div className="generation-asset-info"><span>{asset.videoJob.modelId}</span><span>{asset.videoJob.actualWidth} × {asset.videoJob.actualHeight}</span></div><div className="generation-card-actions"><VideoActions studio={studio} job={asset.videoJob} /><Button size="compact" disabled={!studio.project || saving} onClick={() => onSaveToProject(asset)}><Icon name="folderPlus" />保存至当前项目</Button></div></>}</article>)}</div>}
			{!assets.length && !tasks.length && !videos.submitting && <div className="generation-empty"><div className="generation-empty-art" aria-hidden="true"><span className="generation-empty-back" /><span className="generation-empty-frame"><Icon name="video" size={24} /></span><span className="generation-empty-spark"><Icon name="spark" size={16} /></span></div><h2>让灵感动起来</h2><p>一阵风、一个回眸、一段光影。<br />把想象写下来，留给下一段故事。</p><Button variant="ghost" size="compact" onClick={() => input.current?.click()}><Icon name="plus" />导入一段视频</Button><small>生成的作品会出现在这里，也可以先看看已有的作品。</small></div>}
			{!!assets.length && <p className="generation-session-note">生成作品已保存在本机 · 本地导入内容仅在当前会话中保留</p>}
		</div>
		{selected && <Dialog className="generation-preview-dialog" aria-label="视频预览" onClose={() => setSelected(undefined)}><header><div><strong>{selected.prompt?.slice(0, 24) || selected.name}</strong><small>循环播放 · 可切换声音</small></div><IconButton size="compact" variant="ghost" aria-label="关闭作品预览" onClick={() => setSelected(undefined)}><Icon name="close" /></IconButton></header><div className="generation-preview-media"><VideoPlayer key={selected.id} asset={selected} playing /></div>{selected.videoJob && <div className="generation-preview-info"><p>{selected.prompt}</p><small>{selected.videoJob.serviceName} · {selected.videoJob.modelId} · {new Date(selected.videoJob.completedAt ?? selected.createdAt).toLocaleString()}</small><small>实际成片：{actualSpecs(selected.videoJob)}</small><small>请求：{selected.videoJob.duration} 秒 · {selected.videoJob.ratio} · {selected.videoJob.resolution}（不保证输出分辨率）</small>{selected.videoJob.usage && <small>服务返回用量：{usageText(selected.videoJob.usage)}</small>}<VideoActions studio={studio} job={selected.videoJob} /><Button size="compact" disabled={!studio.project || saving} onClick={() => { setSelected(undefined); onSaveToProject(selected); }}><Icon name="folderPlus" />保存至当前项目</Button></div>}</Dialog>}
		{abandoning && <ConfirmDialog title="结束本地任务跟踪？" description="请先核对服务端记录。此操作不会取消远端任务，服务端可能继续生成并计费；结束后可提交新视频。" confirmText="已核对，结束跟踪" onClose={() => setAbandoning(undefined)} onConfirm={() => { void videos.control(abandoning.id, "abandon"); }} />}
	</section>;
}
