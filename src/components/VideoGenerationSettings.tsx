import { forwardRef, useState } from "react";
import { defaultVideoModel, videoGenerationNative, type VideoService, type VideoServiceInput } from "../workbench/videoGeneration";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, Input } from "./ui";

type Draft = { kind: "service"; input: VideoServiceInput; original: string };
export const VideoGenerationSettings = forwardRef<SettingsEditorHandle, { videos: GenerationStudio["videos"]; onLockChange: (locked: boolean, pending: boolean) => void }>(function VideoGenerationSettings({ videos, onLockChange }, ref) {
	const { draft, setDraft, pending, error, setError, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange, isDirty: (value) => JSON.stringify(value.input) !== value.original });
	const [removing, setRemoving] = useState<VideoService>();
	const edit = (service?: VideoService) => {
		rememberEditorTrigger();
		const input: VideoServiceInput = service ? { id: service.id, name: service.name, baseUrl: service.baseUrl, models: structuredClone(service.models), defaultModel: service.defaultModel, apiKey: "", makeDefault: videos.config?.defaultServiceId === service.id } : { name: "Muse 视频", baseUrl: "https://api.aisenyu.com/v1", apiKey: "", models: [structuredClone(defaultVideoModel)], defaultModel: defaultVideoModel.id, makeDefault: !videos.config?.services.length };
		setDraft({ kind: "service", input, original: JSON.stringify(input) });
	};
	const patch = (input: Partial<VideoServiceInput>) => setDraft((current) => current && ({ ...current, input: { ...current.input, ...input } }));
	return <section ref={contentRef} className="settings-page image-generation-settings" aria-labelledby="video-generation-title">
		<h2 id="video-generation-title">视频生成</h2><p className="muted">通过 Muse 视频接口创作，支持文生视频与单张首帧参考图。任务与作品保存在本机，独立于聊天模型。</p>
		{!draft ? <>
			<div className="image-settings-actions"><Button onClick={() => edit()} disabled={videos.loading || !videos.config}><Icon name="plus" />添加视频服务</Button><Button onClick={() => void videos.refresh()} disabled={videos.loading} loading={videos.loading}>重新读取</Button></div>
			{videos.config?.services.map((service) => <div className="settings-group" key={service.id}><div className="settings-row"><div className="settings-row-text"><strong className="settings-row-title">{service.name}{videos.config?.defaultServiceId === service.id ? " · 默认" : ""}</strong><span className="settings-row-hint">{service.baseUrl} · {service.models.map((model) => model.id).join("、")} · Key {service.keyHint}</span></div><Button onClick={() => edit(service)} aria-label={`编辑视频服务 ${service.name}`}>编辑</Button><Button onClick={() => setRemoving(service)} aria-label={`删除视频服务 ${service.name}`}>删除</Button></div></div>)}
			{videos.config && !videos.config.services.length && <p className="muted">还没有视频服务。填写地址、Key 和模型后即可开始。</p>}
		</> : <form onSubmit={(event) => { event.preventDefault(); void mutate(async () => { videos.setConfig(await videoGenerationNative.save(draft.input)); closeDraft(); return true; }); }}>
			<div className="image-settings-actions"><Button onClick={closeDraft} disabled={pending}><Icon name="arrowLeft" />返回服务列表</Button></div>
			<fieldset className="settings-config" disabled={pending}><div className="settings-group">
				<div className="settings-row is-stacked"><label htmlFor="video-service-name" className="settings-row-title">服务名称</label><Input id="video-service-name" required maxLength={64} value={draft.input.name} onChange={(event) => patch({ name: event.target.value })} /></div>
				<div className="settings-row is-stacked"><label htmlFor="video-service-url" className="settings-row-title">API 地址</label><Input id="video-service-url" required type="url" value={draft.input.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /><span className="settings-row-hint">填写服务根地址，例如 https://api.aisenyu.com/v1；不包含 /videos。</span></div>
				<div className="settings-row is-stacked"><label htmlFor="video-service-key" className="settings-row-title">API Key</label><Input id="video-service-key" type="password" autoComplete="new-password" required={!draft.input.id} value={draft.input.apiKey ?? ""} placeholder={draft.input.id ? "已保存，留空保留原 Key" : "填写视频服务的 API Key"} onChange={(event) => patch({ apiKey: event.target.value })} /><span className="settings-row-hint">Key 在本机加密保存。保存和读取配置不发起生成。</span></div>
				{draft.input.models.map((model, index) => <div className="settings-row is-stacked" key={index}><label htmlFor={`video-model-${index}`} className="settings-row-title">模型 ID {index + 1}</label><Input id={`video-model-${index}`} required value={model.id} onChange={(event) => patch({ models: draft.input.models.map((value, position) => position === index ? { ...value, id: event.target.value } : value), defaultModel: draft.input.defaultModel === model.id ? event.target.value : draft.input.defaultModel })} /><span className="settings-row-hint">首版开放 5 秒、9:16；实际分辨率以生成结果为准。</span></div>)}
				{draft.input.models.map((model, index) => <div className="settings-row is-stacked" key={`reference-${index}`}><label className="settings-row-title" htmlFor={`video-reference-${index}`}>启用单图参考（实验）<Input id={`video-reference-${index}`} type="checkbox" checked={model.referenceEnabled} onChange={(event) => patch({ models: draft.input.models.map((item, position) => position === index ? { ...item, referenceEnabled: event.target.checked } : item) })} /></label><span className="settings-row-hint">当前实测曾返回“找不到上传控件”。默认关闭；启用后单图生成仍可能因服务端问题失败。</span></div>)}
				<div className="settings-row"><label className="settings-row-title" htmlFor="video-default">设为默认视频服务</label><Input id="video-default" type="checkbox" checked={draft.input.makeDefault} onChange={(event) => patch({ makeDefault: event.target.checked })} /></div>
			</div><div className="image-settings-actions"><Button type="submit" variant="primary" loading={pending}>保存视频服务</Button><Button onClick={closeDraft}>取消编辑</Button></div></fieldset>
		</form>}
		{(error || videos.error) && <p role="alert" className="generation-gallery-error">{error ?? videos.error}</p>}
		{removing && <ConfirmDialog title={`删除视频服务 ${removing.name}？`} description="删除此服务及其 Key，保留作品。正在运行的任务继续；重启后恢复查询需要原服务及凭据。" onClose={() => setRemoving(undefined)} onConfirm={() => { void mutate(async () => { try { videos.setConfig(await videoGenerationNative.remove(removing.id)); return true; } catch (reason) { setError(String(reason)); return false; } }); }} />}
	</section>;
});
