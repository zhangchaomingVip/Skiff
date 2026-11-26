import { forwardRef, useState } from "react";
import { settingsProviderEndpointLabel, settingsProviderEndpointTitle } from "../chat/settingsModels";
import { defaultVideoModel, videoGenerationNative, type VideoService, type VideoServiceInput } from "../workbench/videoGeneration";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, IconButton, Input } from "./ui";

type Draft = { kind: "service"; input: VideoServiceInput; original: string };
export const VideoGenerationSettings = forwardRef<SettingsEditorHandle, { videos: GenerationStudio["videos"]; onLockChange: (locked: boolean, pending: boolean) => void }>(function VideoGenerationSettings({ videos, onLockChange }, ref) {
	const { draft, setDraft, pending, error, setError, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange, isDirty: (value) => JSON.stringify(value.input) !== value.original });
	const [removing, setRemoving] = useState<VideoService>();
	const services = videos.config?.services ?? [];
	const edit = (service?: VideoService) => {
		rememberEditorTrigger();
		const input: VideoServiceInput = service ? { id: service.id, name: service.name, baseUrl: service.baseUrl, models: structuredClone(service.models), defaultModel: service.defaultModel, apiKey: "", makeDefault: videos.config?.defaultServiceId === service.id } : { name: "Muse 视频", baseUrl: "https://api.aisenyu.com/v1", apiKey: "", models: [structuredClone(defaultVideoModel)], defaultModel: defaultVideoModel.id, makeDefault: !services.length };
		setDraft({ kind: "service", input, original: JSON.stringify(input) });
	};
	const setDefault = (service: VideoService) => void mutate(async () => {
		videos.setConfig(await videoGenerationNative.save({
			id: service.id,
			name: service.name,
			baseUrl: service.baseUrl,
			models: service.models,
			defaultModel: service.defaultModel,
			apiKey: "",
			makeDefault: true,
		}));
		return true;
	});
	const patch = (input: Partial<VideoServiceInput>) => setDraft((current) => current && ({ ...current, input: { ...current.input, ...input } }));
	return <section ref={contentRef} className="settings-page image-generation-settings" aria-labelledby="video-generation-title">
		<h2 id="video-generation-title">视频生成</h2><p className="muted">使用 Muse 视频接口生成视频，支持首帧参考图。</p>
		{!draft ? <>
			<div className="image-settings-section-head">
				<h3>视频服务{services.length > 0 && <span className="image-settings-count">{services.length}</span>}</h3>
				<Button variant="primary" onClick={() => edit()} disabled={pending || videos.loading || !videos.config}><Icon name="plus" size={14} />添加视频服务</Button>
			</div>
			{!!services.length && <section className="provider-list family-card image-provider-list" aria-label="视频生成服务列表">{services.map((service) => {
				const isDefault = videos.config?.defaultServiceId === service.id;
				const primaryModel = service.defaultModel || service.models[0]?.id || "";
				const modelSummary = service.models.length > 1 ? `${primaryModel} 等 ${service.models.length} 个模型` : primaryModel || `${service.models.length} 个模型`;
				const allModelsTitle = service.models.map((model) => model.id).join("、");
				return <div className={`provider-row provider-relay-row${isDefault ? " is-default" : ""}`} key={service.id}>
					<div className="provider-relay-main">
						<span className="provider-avatar"><Icon name="video" size={20} /></span>
						<span className="provider-row-text">
							<span className="provider-row-title">
								<strong title={service.name}>{service.name}</strong>
								{isDefault && <span className="provider-tag image-default-tag">默认</span>}
							</span>
							<small className="provider-row-meta">
								<span className="provider-row-endpoint" title={settingsProviderEndpointTitle(service.baseUrl)}>{settingsProviderEndpointLabel(service.baseUrl)}</span>
								<span className="provider-row-count" title={allModelsTitle}>· {modelSummary}</span>
							</small>
						</span>
					</div>
					<div className="provider-row-side">
						<span className="settings-key-fingerprint" title="已保存密钥的指纹">Key {service.keyHint}</span>
						<div className="provider-row-actions">
							{!isDefault && <IconButton type="button" variant="ghost" size="compact" className="image-set-default-button" disabled={pending || videos.loading} onClick={() => setDefault(service)} aria-label={`设为默认视频服务 ${service.name}`} title="设为默认视频服务"><Icon name="star" size={15} /></IconButton>}
							<IconButton type="button" variant="ghost" size="compact" disabled={pending || videos.loading} onClick={() => edit(service)} aria-label={`编辑视频服务 ${service.name}`} title="编辑视频服务"><Icon name="edit" size={15} /></IconButton>
							<IconButton type="button" variant="ghost" size="compact" disabled={pending || videos.loading} onClick={() => setRemoving(service)} aria-label={`删除视频服务 ${service.name}`} title="删除视频服务"><Icon name="trash" size={15} /></IconButton>
						</div>
					</div>
				</div>;
			})}</section>}
			{videos.config && !services.length && <p className="muted">还没有视频服务。填写地址、Key 和模型后即可开始。</p>}
		</> : <form onSubmit={(event) => { event.preventDefault(); void mutate(async () => { videos.setConfig(await videoGenerationNative.save(draft.input)); closeDraft(); return true; }); }}>
			<div className="image-settings-actions"><Button onClick={closeDraft} disabled={pending}><Icon name="arrowLeft" />返回服务列表</Button></div>
			<fieldset className="settings-config" disabled={pending}><div className="settings-group">
				<div className="settings-row is-stacked"><label htmlFor="video-service-name" className="settings-row-title">服务名称</label><Input id="video-service-name" required maxLength={64} value={draft.input.name} onChange={(event) => patch({ name: event.target.value })} /></div>
				<div className="settings-row is-stacked"><label htmlFor="video-service-url" className="settings-row-title">API 地址</label><Input id="video-service-url" required type="url" value={draft.input.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /><span className="settings-row-hint">填写服务根地址，例如 https://api.aisenyu.com/v1；不包含 /videos。</span></div>
				<div className="settings-row is-stacked"><label htmlFor="video-service-key" className="settings-row-title">API Key</label><Input id="video-service-key" type="password" autoComplete="new-password" required={!draft.input.id} value={draft.input.apiKey ?? ""} placeholder={draft.input.id ? "已保存，留空保留原 Key" : "填写视频服务的 API Key"} onChange={(event) => patch({ apiKey: event.target.value })} /><span className="settings-row-hint">Key 在本机加密保存。保存和读取配置不发起生成。</span></div>
				{draft.input.models.map((model, index) => <div className="settings-row is-stacked" key={index}><label htmlFor={`video-model-${index}`} className="settings-row-title">模型 ID {index + 1}</label><Input id={`video-model-${index}`} required value={model.id} onChange={(event) => patch({ models: draft.input.models.map((value, position) => position === index ? { ...value, id: event.target.value } : value), defaultModel: draft.input.defaultModel === model.id ? event.target.value : draft.input.defaultModel })} /><span className="settings-row-hint">支持 5 秒与 10 秒、9:16 竖屏；实际分辨率以生成结果为准。</span></div>)}
				{draft.input.models.map((model, index) => <div className="settings-row" key={`reference-${index}`}><div className="settings-row-text"><label className="settings-row-title" htmlFor={`video-reference-${index}`}>启用单图参考（实验）</label><span className="settings-row-hint">当前实测曾返回“找不到上传控件”。默认关闭；启用后单图生成仍可能因服务端问题失败。</span></div><label className="switch"><input id={`video-reference-${index}`} type="checkbox" checked={model.referenceEnabled} onChange={(event) => patch({ models: draft.input.models.map((item, position) => position === index ? { ...item, referenceEnabled: event.target.checked } : item) })} /><span className="slider" /></label></div>)}
				<div className="settings-row"><label className="settings-row-title" htmlFor="video-default">设为默认视频服务</label><label className="switch"><input id="video-default" type="checkbox" checked={draft.input.makeDefault} onChange={(event) => patch({ makeDefault: event.target.checked })} /><span className="slider" /></label></div>
			</div><div className="image-settings-actions"><Button type="submit" variant="primary" loading={pending}>保存视频服务</Button><Button onClick={closeDraft}>取消编辑</Button></div></fieldset>
		</form>}
		{(error || videos.error) && <div className="image-settings-error">
			<p role="alert" className="generation-gallery-error">{error ?? videos.error}</p>
			{videos.error && !draft && <Button type="button" variant="ghost" size="compact" disabled={pending || videos.loading} loading={videos.loading} onClick={() => void videos.refresh()}>重新读取</Button>}
		</div>}
		{removing && <ConfirmDialog title={`删除视频服务 ${removing.name}？`} description="删除此服务及其 Key，保留作品。正在运行的任务继续；重启后恢复查询需要原服务及凭据。" onClose={() => setRemoving(undefined)} onConfirm={() => { void mutate(async () => { try { videos.setConfig(await videoGenerationNative.remove(removing.id)); return true; } catch (reason) { setError(String(reason)); return false; } }); }} />}
	</section>;
});
