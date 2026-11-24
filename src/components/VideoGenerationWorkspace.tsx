import { useEffect, useId, useRef } from "react";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import type { VideoJob } from "../workbench/videoGeneration";
import { Icon } from "./Icon";
import { CanvasPicker } from "./CanvasPicker";
import { GenerationPicker } from "./GenerationPicker";
import { Button, IconButton, Input, Select, TextArea, Tooltip } from "./ui";
import type { ComposerProps } from "./GenerationWorkspace";
import { useReferenceDrop } from "./useReferenceDrop";

export function VideoControls({ studio, onConfigure, onSubmitted, variant, modeSwitch }: ComposerProps) {
	const id = useId();
	const input = useRef<HTMLInputElement>(null);
	const promptInput = useRef<HTMLTextAreaElement>(null);
	const drop = useReferenceDrop(studio.uploadReference);
	const { videos, drafts: { video: draft } } = studio;
	const service = videos.config?.services.find((item) => item.id === draft.serviceId);
	const model = service?.models.find((item) => item.id === draft.modelId);
	const configured = !!service?.configured && !!model;
	const update = (patch: Partial<typeof draft>) => studio.updateDraft("video", patch);
	const canGenerate = configured && !videos.loading && !videos.submitting && !videos.running && !!draft.prompt.trim() && model.durations.includes(draft.duration) && model.ratios.includes(draft.ratio) && (!studio.reference || model.referenceEnabled);
	const status = videos.loading ? "正在读取视频服务" : videos.running ? "已有视频任务，可在对话流中查看或继续查询" : configured ? "" : "尚未配置视频生成服务";
	// Same growth rule as the image panel: a few lines at rest, capped and scrollable.
	useEffect(() => {
		const node = promptInput.current;
		if (variant !== "panel" || !node) return;
		node.style.height = "auto";
		node.style.height = `${Math.min(200, node.scrollHeight)}px`;
	}, [draft.prompt, variant]);
	return <aside className="generation-controls" data-kind="video" data-variant={variant} aria-label="生成视频参数">
		<header className="generation-controls-header"><span className="generation-mode-icon"><Icon name="video" size={20} /></span><div><h1>生成视频</h1><p>让画面，多一点故事</p></div></header>
		<form className="generation-form" onSubmit={(event) => { event.preventDefault(); if (!canGenerate) return; void videos.generate({ serviceId: draft.serviceId, modelId: draft.modelId, prompt: draft.prompt, duration: draft.duration, ratio: draft.ratio, projectRoot: studio.project?.path, canvasId: studio.canvasId || undefined }, studio.reference?.url); update({ prompt: "" }); onSubmitted?.(); }} {...drop.handlers}>
			<div className="generation-fields">
				<div className="generation-field generation-field-prompt"><div className="generation-field-heading"><label htmlFor={`${id}-prompt`}>提示词 <span>Prompt</span></label></div><TextArea ref={promptInput} id={`${id}-prompt`} rows={variant === "panel" ? 2 : 4} maxLength={32000} value={draft.prompt} aria-keyshortcuts="Control+Enter Meta+Enter" placeholder="描述画面如何动起来：镜头缓缓推进，微风拂过窗边的花…" onChange={(event) => update({ prompt: event.target.value })} onPaste={(event) => { const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/")); if (!file) return; event.preventDefault(); studio.uploadReference(file); }} onKeyDown={(event) => {
						if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
							event.preventDefault(); event.stopPropagation();
							if (canGenerate && !event.repeat) event.currentTarget.form?.requestSubmit();
						}
					}} /><p className="generation-field-hint">试着写下主体动作、镜头运动和氛围。</p></div>
				<div className="generation-field generation-field-reference" data-filled={!!studio.reference}><span className="generation-field-label">首帧参考图 <small>可选</small></span><Input ref={input} className="generation-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传首帧参考图" onChange={(event) => { const file = event.target.files?.[0]; if (file) studio.uploadReference(file); event.target.value = ""; }} />
					<div className={`generation-reference ${studio.reference ? "has-image" : "is-empty"} ${drop.dragging ? "is-dragging" : ""}`}>
						{studio.reference ? <><button type="button" className="generation-reference-image" aria-label={`替换首帧参考图：${studio.reference.name}`} onClick={() => input.current?.click()}><img src={studio.reference.url} alt={studio.reference.name} /></button><div className="generation-reference-caption"><span title={studio.reference.name}>{studio.reference.name}</span><IconButton size="compact" variant="ghost" aria-label="移除首帧参考图" onClick={studio.removeReference}><Icon name="close" size={13} /></IconButton></div></> : <button type="button" className="generation-reference-upload" aria-label="添加一张起始画面" onClick={() => input.current?.click()}><Icon name="video" size={15} /><strong>添加首帧</strong><span>点击上传，或将图片拖入、粘贴到这里</span></button>}
					</div><p className="generation-field-hint">PNG、JPG、WebP、GIF · 最大 20 MB。上传后压缩为静态首帧，生成时发送给视频服务。</p>
				</div>
				<div className="generation-settings">
					{modeSwitch && <div className="generation-field generation-field-mode">{modeSwitch}</div>}
					<CanvasPicker studio={studio} id={`${id}-canvas`} />
					{variant === "hero" && <span className="design-composer-divider" aria-hidden="true" />}
					<div className="generation-field generation-field-service"><label htmlFor={`${id}-service`}>生成服务</label><div className="generation-service-control"><GenerationPicker id={`${id}-service`} label="生成服务" icon="layers" value={draft.serviceId} disabled={!videos.config?.services.length} placeholder={videos.config?.services.length ? "选择一个服务" : "先配置一个视频服务"} options={(videos.config?.services ?? []).map((item) => ({ value: item.id, label: item.name, hint: `${item.models.length} 个模型${item.configured ? "" : " · 未配置密钥"}` }))} onChange={(serviceId) => { const next = videos.config?.services.find((item) => item.id === serviceId); const first = next?.models.find((item) => item.id === next.defaultModel) ?? next?.models[0]; update({ serviceId, modelId: first?.id ?? "", duration: first?.durations[0] ?? 5, ratio: "9:16" }); }} /><Tooltip text={configured ? "管理视频服务" : "配置视频服务"}><IconButton variant="ghost" aria-label={configured ? "管理视频服务" : "配置视频服务"} onClick={onConfigure}><Icon name="settings" size={16} /></IconButton></Tooltip></div></div>
					<div className="generation-field generation-field-model"><label htmlFor={`${id}-model`}>模型</label><GenerationPicker id={`${id}-model`} label="模型" icon="spark" value={configured ? draft.modelId : ""} disabled={!configured} placeholder={configured ? "选择模型" : "连接生成服务后选择模型"} options={configured ? (service?.models ?? []).map((item) => ({ value: item.id, label: item.id, hint: `${item.durations.join(" / ")} 秒${item.referenceEnabled ? " · 支持首帧" : ""}` })) : []} onChange={(modelId) => update({ modelId })} /></div>
					<fieldset className="generation-field generation-ratios"><legend>画面比例</legend><div role="group" aria-label="画面比例"><Button size="compact" variant="ghost" aria-pressed={draft.ratio === "9:16"} onClick={() => update({ ratio: "9:16" })}>9:16</Button></div></fieldset>
					<div className="generation-field generation-field-duration"><label htmlFor={`${id}-duration`}>时长</label><Select id={`${id}-duration`} value={draft.duration} onChange={(event) => update({ duration: Number(event.target.value) })}>{(model?.durations.length ? model.durations : [5]).map((duration) => <option key={duration} value={duration}>{variant === "hero" ? `${draft.ratio} · ${duration} 秒` : `${duration} 秒`}</option>)}</Select><p className="generation-field-hint">支持 5 秒与 10 秒竖屏。实际分辨率以成片为准。</p></div>
				</div>
				{studio.reference && !model?.referenceEnabled && <p className="generation-field-hint" role="status">当前模型未启用单图参考。请移除参考图使用文生视频，或在视频设置中启用实验性单图参考。</p>}
				{studio.referenceError && <p className="generation-error" role="alert">{studio.referenceError}<IconButton size="compact" variant="ghost" aria-label="关闭文件提示" onClick={studio.clearReferenceError}><Icon name="close" /></IconButton></p>}
			</div>
			{status && <p className="generation-service-status" id={`${id}-connection`} role="status">{status}</p>}
			<footer className="generation-submit"><Button type="submit" variant="primary" size="primary" disabled={!canGenerate} loading={videos.submitting} aria-describedby={status ? `${id}-connection` : undefined}><Icon name="video" />生成视频</Button></footer>
		</form>
		{drop.dragging && <div className="generation-dropzone" aria-hidden="true"><span className="generation-dropzone-icon"><Icon name="video" size={20} /></span><strong>松开图片，作为首帧参考</strong><small>PNG、JPG、WebP、GIF · 最大 20 MB</small></div>}
	</aside>;
}

/** Restores a settled job's prompt and, when the model still exists, its route. */
export function reuseVideo(studio: GenerationStudio, job: VideoJob) {
	const service = studio.videos.config?.services.find((item) => item.id === job.serviceId);
	const model = service?.models.find((item) => item.id === job.modelId);
	studio.updateDraft("video", { prompt: job.prompt, ...(model ? { serviceId: service!.id, modelId: model.id, duration: job.duration, ratio: "9:16" } : {}) });
}
