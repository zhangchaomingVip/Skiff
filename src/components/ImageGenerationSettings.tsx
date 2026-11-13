import { forwardRef, useState } from "react";
import { defaultImageModel, imageGenerationNative, type ImageConcurrencyLimit, type ImageService, type ImageServiceInput } from "../workbench/imageGeneration";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, Input, Select } from "./ui";
import { imageResolutions, imageSizePresets, maxImageSizes, parseImageSizes } from "../workbench/imageSizes";

type Draft = { kind: "service"; input: ImageServiceInput; original: string; sizes: string[] };
export const ImageGenerationSettings = forwardRef<SettingsEditorHandle, { images: GenerationStudio["images"]; onLockChange: (locked: boolean, pending: boolean) => void }>(function ImageGenerationSettings({ images, onLockChange }, ref) {
	const { draft, setDraft, pending, error, setError, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange, isDirty: (value) => JSON.stringify([value.input, value.sizes]) !== value.original });
	const [removing, setRemoving] = useState<ImageService>();
	const edit = (service?: ImageService) => {
		rememberEditorTrigger();
		const input: ImageServiceInput = service ? { id: service.id, name: service.name, baseUrl: service.baseUrl, models: structuredClone(service.models), defaultModel: service.defaultModel, apiKey: "", makeDefault: images.config?.defaultServiceId === service.id } : { name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "", models: [structuredClone(defaultImageModel)], defaultModel: defaultImageModel.id, makeDefault: !images.config?.services.length };
		const sizes = input.models.map((model) => model.sizes.join(", "));
		setDraft({ kind: "service", input, sizes, original: JSON.stringify([input, sizes]) });
	};
	const patch = (input: Partial<ImageServiceInput>) => setDraft((current) => current && ({ ...current, input: { ...current.input, ...input } }));
	const submit = () => mutate(async () => {
		if (!draft) return false;
		const input = { ...draft.input, models: draft.input.models.map((model, index) => ({ id: model.id.trim(), sizes: parseImageSizes(draft.sizes[index]) })) };
		const next = await imageGenerationNative.save(input);
		images.setConfig(next); closeDraft(); return true;
	});
	return <section ref={contentRef} className="settings-page image-generation-settings" aria-labelledby="image-generation-title">
		<h2 id="image-generation-title">图片生成</h2>
		<p className="muted">通过 OpenAI Images 接口生成图片，支持自定义兼容服务。图生图需要服务支持图片编辑接口。独立于聊天模型，每次生成一张并自动保存到本地。</p>
		{!draft ? <>
			<div className="settings-group"><div className="settings-row"><div className="settings-row-text"><label htmlFor="image-concurrency-limit" className="settings-row-title">同时生成任务数</label><span id="image-concurrency-hint" className="settings-row-hint">默认 5 个，适用于所有图片生成服务。调低后已有任务会继续；不限时仍受服务商限流约束。</span></div><Select id="image-concurrency-limit" aria-describedby="image-concurrency-hint" value={images.config?.concurrencyLimit ?? 5} disabled={pending || images.loading || !images.config} onChange={(event) => { const limit = Number(event.target.value) as ImageConcurrencyLimit; void mutate(async () => { images.setConfig(await imageGenerationNative.setConcurrency(limit)); return true; }); }}><option value={3}>3 个</option><option value={5}>5 个</option><option value={10}>10 个</option><option value={0}>不限</option></Select></div></div>
			<div className="image-settings-actions"><Button onClick={() => edit()} disabled={pending || images.loading || !images.config}><Icon name="plus" />添加生成服务</Button><Button onClick={() => void images.refresh()} disabled={pending || images.loading} loading={images.loading}>重新读取</Button></div>
			{images.config?.services.map((service) => <div className="settings-group" key={service.id}><div className="settings-row"><div className="settings-row-text"><strong className="settings-row-title">{service.name}{images.config?.defaultServiceId === service.id ? " · 默认" : ""}</strong><span className="settings-row-hint">{service.baseUrl} · {service.models.length} 个模型 · Key {service.keyHint}</span></div><Button disabled={pending || images.loading} onClick={() => edit(service)} aria-label={`编辑生成服务 ${service.name}`}>编辑</Button><Button disabled={pending || images.loading} onClick={() => setRemoving(service)} aria-label={`删除生成服务 ${service.name}`}>删除</Button></div></div>)}
			{images.config && !images.config.services.length && <p className="muted">还没有生成服务。添加后填写 API 地址、Key 与图片模型即可开始。</p>}
		</> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
			<div className="image-settings-actions"><Button onClick={closeDraft} disabled={pending}><Icon name="arrowLeft" />返回服务列表</Button></div>
			<fieldset className="settings-config" disabled={pending}>
				<div className="settings-group">
					<div className="settings-row is-stacked"><label htmlFor="image-service-name" className="settings-row-title">服务名称</label><Input id="image-service-name" required maxLength={64} value={draft.input.name} onChange={(event) => patch({ name: event.target.value })} /></div>
					<div className="settings-row is-stacked"><label htmlFor="image-service-url" className="settings-row-title">API 地址</label><Input id="image-service-url" required type="url" placeholder="https://api.openai.com/v1" value={draft.input.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /><span className="settings-row-hint">填写 API 根地址，例如以 /v1 结尾；无需填写 /images/generations。</span></div>
					<div className="settings-row is-stacked"><label htmlFor="image-service-key" className="settings-row-title">API Key</label><Input id="image-service-key" type="password" autoComplete="new-password" required={!draft.input.id} value={draft.input.apiKey ?? ""} placeholder={draft.input.id ? "已保存，留空保留原 Key" : "填写图片服务的 API Key"} onChange={(event) => patch({ apiKey: event.target.value })} /><span className="settings-row-hint">Key 在本机加密保存。保存配置不会发起生成或消耗额度。</span></div>
				</div>
				<h3>图片模型</h3><p className="muted">手动填写服务实际提供的模型 ID 和支持的尺寸。识图模型不一定支持生图，尺寸不会被自动拉伸转换。</p>
				{draft.input.models.map((model, index) => <div className="settings-group" key={index}>
					<div className="settings-row is-stacked"><label htmlFor={`image-model-${index}`} className="settings-row-title">模型 ID {index + 1}</label><Input id={`image-model-${index}`} required value={model.id} onChange={(event) => { const models = draft.input.models.map((item, position) => position === index ? { ...item, id: event.target.value } : item); patch({ models, defaultModel: draft.input.defaultModel === model.id ? event.target.value : draft.input.defaultModel }); }} /></div>
					<div className="settings-row is-stacked"><label htmlFor={`image-sizes-${index}`} className="settings-row-title">可用尺寸 {index + 1}</label><Input id={`image-sizes-${index}`} required value={draft.sizes[index]} onChange={(event) => setDraft({ ...draft, sizes: draft.sizes.map((value, position) => position === index ? event.target.value : value) })} /><span className="settings-row-hint">以英文逗号分隔，例如 1024x1024, 1536x1024, 1024x1536；只填写此模型实际支持的尺寸。</span></div>
					<div className="image-settings-actions" role="group" aria-label={`尺寸预设 ${index + 1}`}>{imageResolutions.map((resolution) => {
						const current = parseImageSizes(draft.sizes[index]);
						const merged = [...new Set([...current, ...imageSizePresets[resolution]])];
						return <Button key={resolution} size="compact" disabled={merged.length > maxImageSizes || merged.length === current.length} title={merged.length > maxImageSizes ? "每模型最多 32 个尺寸，请先移除不用的尺寸" : imageSizePresets[resolution].join("、")} onClick={() => setDraft({ ...draft, sizes: draft.sizes.map((value, position) => position === index ? merged.join(", ") : value) })}>添加 {resolution} 尺寸</Button>;
					})}</div><p className="settings-row-hint">预设只是常见尺寸示例，不会检测模型能力；请按服务商支持范围添加或删减后保存。4K 档包含约 800 万像素的方图/竖图，每模型最多 32 个尺寸。</p>
					{draft.input.models.length > 1 && <div className="image-settings-actions"><Button onClick={() => { const models = draft.input.models.filter((_, position) => position !== index); setDraft({ ...draft, input: { ...draft.input, models, defaultModel: draft.input.defaultModel === model.id ? models[0].id : draft.input.defaultModel }, sizes: draft.sizes.filter((_, position) => position !== index) }); }}>移除模型 {index + 1}</Button></div>}
				</div>)}
				<div className="image-settings-actions"><Button disabled={draft.input.models.length >= 32} onClick={() => setDraft({ ...draft, input: { ...draft.input, models: [...draft.input.models, { id: "", sizes: ["1024x1024"] }] }, sizes: [...draft.sizes, "1024x1024"] })}><Icon name="plus" />添加模型</Button></div>
				<div className="settings-group"><div className="settings-row is-stacked"><label htmlFor="image-default-model" className="settings-row-title">默认模型</label><Select id="image-default-model" value={draft.input.defaultModel} onChange={(event) => patch({ defaultModel: event.target.value })}>{draft.input.models.map((model, index) => <option key={index} value={model.id}>{model.id || "请填写模型 ID"}</option>)}</Select></div><div className="settings-row"><label className="settings-row-title" htmlFor="image-service-default">设为默认生成服务</label><Input id="image-service-default" type="checkbox" checked={draft.input.makeDefault} onChange={(event) => patch({ makeDefault: event.target.checked })} /></div></div>
				<div className="image-settings-actions"><Button type="submit" variant="primary" loading={pending}>保存生成服务</Button><Button onClick={closeDraft}>取消编辑</Button></div>
			</fieldset>
		</form>}
		{(error || images.error) && <p role="alert" className="generation-gallery-error">{error ?? images.error}</p>}
		{removing && <ConfirmDialog title={`删除生成服务 ${removing.name}？`} description="删除此服务及其 Key。已保存的作品会保留，正在运行的生成任务会继续。" onClose={() => setRemoving(undefined)} onConfirm={() => { void mutate(async () => { try { images.setConfig(await imageGenerationNative.remove(removing.id)); return true; } catch (reason) { setError(String(reason)); return false; } }); }} />}
	</section>;
});
