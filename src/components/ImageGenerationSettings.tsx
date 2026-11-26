import { forwardRef, useState } from "react";
import { settingsProviderEndpointLabel, settingsProviderEndpointTitle } from "../chat/settingsModels";
import type { RelaySpec } from "../chat/useModelFamilies";
import { defaultImageModel, imageGenerationNative, type ImageConcurrencyLimit, type ImageService, type ImageServiceInput } from "../workbench/imageGeneration";
import { imageResolutions, imageSizePresets, maxImageSizes, parseImageSizes } from "../workbench/imageSizes";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, IconButton, Input, SegmentedControl, Select } from "./ui";

let modelKeySeed = 0;
const nextModelKey = () => `img-model-${++modelKeySeed}`;

type DraftModel = { key: string; id: string; sizes: string[]; sizeDraft: string };
type Draft = { kind: "service"; input: Omit<ImageServiceInput, "models">; models: DraftModel[]; original: string };

const draftSnapshot = (input: Draft["input"], models: DraftModel[]) => JSON.stringify([input, models.map(({ id, sizes, sizeDraft }) => [id, sizes, sizeDraft])]);

const CONCURRENCY_OPTIONS: { value: `${ImageConcurrencyLimit}`; label: string }[] = [
	{ value: "3", label: "3 个" },
	{ value: "5", label: "5 个" },
	{ value: "10", label: "10 个" },
	{ value: "0", label: "不限" },
];

export const ImageGenerationSettings = forwardRef<SettingsEditorHandle, {
	images: GenerationStudio["images"];
	relays?: RelaySpec[];
	onLockChange: (locked: boolean, pending: boolean) => void;
}>(function ImageGenerationSettings({ images, relays, onLockChange }, ref) {
	const { draft, setDraft, pending, error, setError, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({
		ref,
		onLockChange,
		isDirty: (value) => draftSnapshot(value.input, value.models) !== value.original,
	});
	const [removing, setRemoving] = useState<ImageService>();
	const services = images.config?.services ?? [];
	const importableRelays = (relays ?? []).filter((relay) => relay.baseUrl.trim());

	const edit = (service?: ImageService) => {
		rememberEditorTrigger();
		const input: Draft["input"] = service
			? { id: service.id, name: service.name, baseUrl: service.baseUrl, defaultModel: service.defaultModel, apiKey: "", makeDefault: images.config?.defaultServiceId === service.id }
			: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "", defaultModel: defaultImageModel.id, makeDefault: !services.length };
		const models: DraftModel[] = (service ? service.models : [defaultImageModel]).map((model) => ({
			key: nextModelKey(),
			id: model.id,
			sizes: [...model.sizes],
			sizeDraft: "",
		}));
		setDraft({ kind: "service", input, models, original: draftSnapshot(input, models) });
	};

	const setDefault = (service: ImageService) => void mutate(async () => {
		const next = await imageGenerationNative.save({
			id: service.id,
			name: service.name,
			baseUrl: service.baseUrl,
			models: service.models,
			defaultModel: service.defaultModel,
			apiKey: "",
			makeDefault: true,
		});
		images.setConfig(next);
		return true;
	});

	const patch = (input: Partial<Draft["input"]>) => setDraft((current) => current && ({ ...current, input: { ...current.input, ...input } }));
	const patchModel = (modelKey: string, updater: (model: DraftModel) => DraftModel) => setDraft((current) => current && ({
		...current,
		models: current.models.map((item) => item.key === modelKey ? updater(item) : item),
	}));

	const commitSizeDraft = (modelKey: string) => setDraft((current) => {
		if (!current) return current;
		return {
			...current,
			models: current.models.map((item) => {
				if (item.key !== modelKey) return item;
				const parsed = parseImageSizes(item.sizeDraft);
				if (!parsed.length) return item;
				const merged = [...new Set([...item.sizes, ...parsed])].slice(0, maxImageSizes);
				return { ...item, sizes: merged, sizeDraft: "" };
			}),
		};
	});

	const submit = () => mutate(async () => {
		if (!draft) return false;
		const models = draft.models.map((model) => ({
			id: model.id.trim(),
			sizes: [...new Set([...model.sizes, ...parseImageSizes(model.sizeDraft)])],
		}));
		const next = await imageGenerationNative.save({ ...draft.input, models });
		images.setConfig(next);
		closeDraft();
		return true;
	});

	return <section ref={contentRef} className="settings-page image-generation-settings" aria-labelledby="image-generation-title">
		<h2 id="image-generation-title">图片生成</h2>
		<p className="muted">使用兼容 OpenAI Images 接口的服务生成图片；图生图需服务支持图片编辑接口。</p>
		{!draft ? <>
			<div className="settings-group">
				<div className="settings-row">
					<div className="settings-row-text">
						<span className="settings-row-title">同时生成任务数</span>
						<span id="image-concurrency-hint" className="settings-row-hint">默认 5 个，适用于所有图片生成服务。调低后已有任务会继续；不限时仍受服务商限流约束。</span>
					</div>
					<SegmentedControl
						label="同时生成任务数"
						value={String(images.config?.concurrencyLimit ?? 5) as `${ImageConcurrencyLimit}`}
						disabled={pending || images.loading || !images.config}
						options={CONCURRENCY_OPTIONS}
						onChange={(value) => {
							const limit = Number(value) as ImageConcurrencyLimit;
							void mutate(async () => { images.setConfig(await imageGenerationNative.setConcurrency(limit)); return true; });
						}}
					/>
				</div>
			</div>
			<div className="image-settings-section-head">
				<h3>生成服务{services.length > 0 && <span className="image-settings-count">{services.length}</span>}</h3>
				<Button variant="primary" onClick={() => edit()} disabled={pending || images.loading || !images.config}><Icon name="plus" size={14} />添加生成服务</Button>
			</div>
			{!!services.length && <section className="provider-list family-card image-provider-list" aria-label="图片生成服务列表">{services.map((service) => {
				const isDefault = images.config?.defaultServiceId === service.id;
				const primaryModel = service.defaultModel || service.models[0]?.id || "";
				const modelSummary = service.models.length > 1 ? `${primaryModel} 等 ${service.models.length} 个模型` : primaryModel || `${service.models.length} 个模型`;
				const allModelsTitle = service.models.map((model) => model.id).join("、");
				return <div className={`provider-row provider-relay-row${isDefault ? " is-default" : ""}`} key={service.id}>
					<div className="provider-relay-main">
						<span className="provider-avatar"><Icon name="imageSpark" size={20} /></span>
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
							{!isDefault && <IconButton type="button" variant="ghost" size="compact" className="image-set-default-button" disabled={pending || images.loading} onClick={() => setDefault(service)} aria-label={`设为默认生成服务 ${service.name}`} title="设为默认生成服务"><Icon name="star" size={15} /></IconButton>}
							<IconButton type="button" variant="ghost" size="compact" disabled={pending || images.loading} onClick={() => edit(service)} aria-label={`编辑生成服务 ${service.name}`} title="编辑生成服务"><Icon name="edit" size={15} /></IconButton>
							<IconButton type="button" variant="ghost" size="compact" disabled={pending || images.loading} onClick={() => setRemoving(service)} aria-label={`删除生成服务 ${service.name}`} title="删除生成服务"><Icon name="trash" size={15} /></IconButton>
						</div>
					</div>
				</div>;
			})}</section>}
			{images.config && !services.length && <p className="muted">还没有生成服务。添加后填写 API 地址、Key 与图片模型即可开始。</p>}
		</> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
			<div className="image-settings-actions"><Button onClick={closeDraft} disabled={pending}><Icon name="arrowLeft" />返回服务列表</Button></div>
			<fieldset className="settings-config" disabled={pending}>
				{importableRelays.length > 0 && <div className="settings-group">
					<div className="settings-row is-stacked">
						<label htmlFor="image-import-relay" className="settings-row-title">从已有供应商填充</label>
						<Select id="image-import-relay" value="" onChange={(event) => {
							const relay = importableRelays.find((item) => item.id === event.target.value);
							if (!relay) return;
							const shouldUpdateName = !draft.input.id && (!draft.input.name.trim() || draft.input.name === "OpenAI");
							patch({
								...(shouldUpdateName ? { name: relay.name } : {}),
								baseUrl: relay.baseUrl,
								...(relay.apiKey ? { apiKey: relay.apiKey } : {}),
							});
						}}>
							<option value="">选择已有供应商以填入地址与 Key…</option>
							{importableRelays.map((relay) => <option key={relay.id} value={relay.id}>{relay.name} ({settingsProviderEndpointLabel(relay.baseUrl)})</option>)}
						</Select>
						<span className="settings-row-hint">仅填入 API 地址与 Key；图片模型与尺寸仍需按服务商实际能力配置。</span>
					</div>
				</div>}
				<div className="settings-group">
					<div className="settings-row is-stacked"><label htmlFor="image-service-name" className="settings-row-title">服务名称</label><Input id="image-service-name" required maxLength={64} value={draft.input.name} onChange={(event) => patch({ name: event.target.value })} /></div>
					<div className="settings-row is-stacked"><label htmlFor="image-service-url" className="settings-row-title">API 地址</label><Input id="image-service-url" required type="url" placeholder="https://api.openai.com/v1" value={draft.input.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} /><span className="settings-row-hint">填写 API 根地址，例如以 /v1 结尾；无需填写 /images/generations。</span></div>
					<div className="settings-row is-stacked"><label htmlFor="image-service-key" className="settings-row-title">API Key</label><Input id="image-service-key" type="password" autoComplete="new-password" required={!draft.input.id} value={draft.input.apiKey ?? ""} placeholder={draft.input.id ? "已保存，留空保留原 Key" : "填写图片服务的 API Key"} onChange={(event) => patch({ apiKey: event.target.value })} /><span className="settings-row-hint">Key 在本机加密保存。保存配置不会发起生成或消耗额度。</span></div>
				</div>
				<h3>图片模型</h3><p className="muted">手动填写服务实际提供的模型 ID 和支持的尺寸。识图模型不一定支持生图，尺寸不会被自动拉伸转换。</p>
				{draft.models.map((model, index) => {
					const draftSizes = parseImageSizes(model.sizeDraft);
					const combinedCount = new Set([...model.sizes, ...draftSizes]).size;
					return <div className="settings-group" key={model.key}>
						<div className="settings-row is-stacked">
							<label htmlFor={`image-model-${model.key}`} className="settings-row-title">模型 ID {index + 1}</label>
							<Input id={`image-model-${model.key}`} required value={model.id} onChange={(event) => {
								const nextId = event.target.value;
								setDraft((current) => current && ({
									...current,
									input: { ...current.input, defaultModel: current.input.defaultModel === model.id ? nextId : current.input.defaultModel },
									models: current.models.map((item) => item.key === model.key ? { ...item, id: nextId } : item),
								}));
							}} />
						</div>
						<div className="settings-row is-stacked">
							<div className="image-sizes-label-row">
								<label htmlFor={`image-sizes-${model.key}`} className="settings-row-title">可用尺寸 {index + 1}</label>
								<span className="settings-row-hint">{model.sizes.length} / {maxImageSizes}</span>
							</div>
							{model.sizes.length > 0 && <div className="image-size-chips" role="list" aria-label={`已配置尺寸 ${index + 1}`}>
								{model.sizes.map((size) => <span className="image-size-chip" role="listitem" key={size}>
									<span>{size}</span>
									<button type="button" className="image-size-chip-remove" aria-label={`移除尺寸 ${size}`} title={`移除 ${size}`} onClick={() => patchModel(model.key, (item) => ({ ...item, sizes: item.sizes.filter((value) => value !== size) }))}><Icon name="close" size={11} /></button>
								</span>)}
							</div>}
							<div className="image-size-input-row">
								<Input
									id={`image-sizes-${model.key}`}
									required={model.sizes.length === 0}
									placeholder="输入尺寸如 1024x1024，支持逗号分隔后回车添加"
									value={model.sizeDraft}
									onChange={(event) => patchModel(model.key, (item) => ({ ...item, sizeDraft: event.target.value }))}
									onKeyDown={(event) => {
										if (event.key === "Enter" && model.sizeDraft.trim()) {
											event.preventDefault();
											commitSizeDraft(model.key);
										}
									}}
								/>
								<Button type="button" size="compact" disabled={!draftSizes.length || combinedCount > maxImageSizes} onClick={() => commitSizeDraft(model.key)}>添加</Button>
							</div>
							<span className="settings-row-hint">只填写此模型实际支持的尺寸；可输入后回车添加，或使用下方预设。</span>
						</div>
						<div className="image-settings-actions" role="group" aria-label={`尺寸预设 ${index + 1}`}>{imageResolutions.map((resolution) => {
							const merged = [...new Set([...model.sizes, ...imageSizePresets[resolution]])];
							return <Button key={resolution} size="compact" disabled={merged.length > maxImageSizes || merged.length === model.sizes.length} title={merged.length > maxImageSizes ? "每模型最多 32 个尺寸，请先移除不用的尺寸" : imageSizePresets[resolution].join("、")} onClick={() => patchModel(model.key, (item) => ({ ...item, sizes: merged }))}>添加 {resolution} 尺寸</Button>;
						})}</div>
						<p className="settings-row-hint">预设只是常见尺寸示例，不会检测模型能力；请按服务商支持范围添加或删减后保存。4K 档包含约 800 万像素的方图/竖图，每模型最多 32 个尺寸。</p>
						{draft.models.length > 1 && <div className="image-settings-actions"><Button onClick={() => setDraft((current) => {
							if (!current) return current;
							const models = current.models.filter((item) => item.key !== model.key);
							return {
								...current,
								input: { ...current.input, defaultModel: current.input.defaultModel === model.id ? models[0].id : current.input.defaultModel },
								models,
							};
						})}>移除模型 {index + 1}</Button></div>}
					</div>;
				})}
				<div className="image-settings-actions"><Button disabled={draft.models.length >= 32} onClick={() => setDraft((current) => current && ({ ...current, models: [...current.models, { key: nextModelKey(), id: "", sizes: ["1024x1024"], sizeDraft: "" }] }))}><Icon name="plus" />添加模型</Button></div>
				<div className="settings-group">
					<div className="settings-row is-stacked"><label htmlFor="image-default-model" className="settings-row-title">默认模型</label><Select id="image-default-model" value={draft.input.defaultModel} onChange={(event) => patch({ defaultModel: event.target.value })}>{draft.models.map((model) => <option key={model.key} value={model.id}>{model.id || "请填写模型 ID"}</option>)}</Select></div>
					<div className="settings-row">
						<label className="settings-row-title" htmlFor="image-service-default">设为默认生成服务</label>
						<label className="switch"><input id="image-service-default" type="checkbox" checked={draft.input.makeDefault} onChange={(event) => patch({ makeDefault: event.target.checked })} /><span className="slider" /></label>
					</div>
				</div>
				<div className="image-settings-actions"><Button type="submit" variant="primary" loading={pending}>保存生成服务</Button><Button onClick={closeDraft}>取消编辑</Button></div>
			</fieldset>
		</form>}
		{(error || images.error) && <div className="image-settings-error">
			<p role="alert" className="generation-gallery-error">{error ?? images.error}</p>
			{images.error && !draft && <Button type="button" variant="ghost" size="compact" disabled={pending || images.loading} loading={images.loading} onClick={() => void images.refresh()}>重新读取</Button>}
		</div>}
		{removing && <ConfirmDialog title={`删除生成服务 ${removing.name}？`} description="删除此服务及其 Key。已保存的作品会保留，正在运行的生成任务会继续。" onClose={() => setRemoving(undefined)} onConfirm={() => { void mutate(async () => { try { images.setConfig(await imageGenerationNative.remove(removing.id)); return true; } catch (reason) { setError(String(reason)); return false; } }); }} />}
	</section>;
});
