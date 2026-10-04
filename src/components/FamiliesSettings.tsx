import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { TestResult } from "../chat/useModelFamilies";
import { FAMILY_LABELS, blankProvider, blankModel, validateModels, maskBaseUrl, maskKey, type ModelFamily, type ModelSpec, type ProviderSpec } from "../chat/useModelFamilies";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ModelIdField } from "./ModelIdField";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

interface Draft {
	familyId: string;
	provider: ProviderSpec;
	isNew: boolean;
}

/**
 * Settings for the three fixed families. Channels live inside a family card;
 * the add/edit form takes over the dialog body so the list stays uncluttered.
 */
export function FamiliesSettings({ families, autoFailover, onClose, onSave, onDelete, onReorder, onToggle, onSetDefault, onAutoFailover, onTest, configError }: {
	families: ModelFamily[];
	autoFailover: boolean;
	configError?: string;
	onClose: () => void;
	onSave: (familyId: string, provider: ProviderSpec) => Promise<boolean>;
	onDelete: (familyId: string, providerId: string) => Promise<boolean>;
	onReorder: (familyId: string, providerIds: string[]) => Promise<boolean>;
	onToggle: (familyId: string, providerId: string, enabled: boolean) => Promise<boolean>;
	onSetDefault: (familyId: string, providerId: string | null) => Promise<boolean>;
	onAutoFailover: (autoFailover: boolean) => Promise<boolean>;
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number) => Promise<TestResult>;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [draft, setDraft] = useState<Draft>();
	const [removing, setRemoving] = useState<{ familyId: string; provider: ProviderSpec }>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [reveal, setReveal] = useState(false);
	const [testing, setTesting] = useState(false);
	const [cloneOpen, setCloneOpen] = useState(false);
	const [result, setResult] = useState<TestResult>();

	useEffect(() => { dialogRef.current?.showModal(); }, []);
	useEffect(() => { if (dialogRef.current) dialogRef.current.scrollTop = 0; }, [draft?.familyId, draft?.isNew]);

	const open = (familyId: string, provider?: ProviderSpec) => {
		setError(undefined); setResult(undefined); setReveal(false); setCloneOpen(false);
		setDraft({ familyId, provider: provider ? { ...provider, models: provider.models.length ? provider.models.map((model) => ({ ...model })) : [blankModel()] } : blankProvider(), isNew: !provider });
	};
	const patch = (value: Partial<ProviderSpec>) => { setResult(undefined); setDraft((current) => current ? { ...current, provider: { ...current.provider, ...value } } : current); };

	const patchModel = (index: number, value: Partial<ModelSpec>) => {
		if (draft) patch({ models: draft.provider.models.map((model, row) => row === index ? { ...model, ...value } : model) });
	};
	const moveModel = (index: number, offset: number) => {
		if (!draft) return;
		const models = [...draft.provider.models];
		const target = index + offset;
		if (target < 0 || target >= models.length) return;
		[models[index], models[target]] = [models[target], models[index]];
		patch({ models });
	};
	const addModels = (index: number, ids: string[]) => {
		if (!draft) return;
		const models = [...draft.provider.models];
		const existing = new Set(models.map((model) => model.modelId.trim()));
		const additions = ids.filter((id) => !existing.has(id)).map((modelId) => ({ ...blankModel(), modelId }));
		// Fill an empty row first so batch discovery leaves no invalid blank row.
		if (!models[index].modelId.trim() && additions.length) models.splice(index, 1, ...additions);
		else models.splice(index + 1, 0, ...additions);
		patch({ models });
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!draft || pending) return;
		const provider = draft.provider;
		if (!/^https?:\/\//i.test(provider.baseUrl.trim())) { setError("接口地址必须以 http:// 或 https:// 开头"); return; }
		const modelError = validateModels(provider.models);
		if (modelError) { setError(modelError); return; }
		if (families.find((family) => family.id === draft.familyId)?.providers.some((item) => item.id !== provider.id && item.displayName.toLowerCase() === provider.displayName.trim().toLowerCase())) { setError("同家族内显示名不能重复"); return; }
		setPending(true); setError(undefined);
		try {
			if (await onSave(draft.familyId, draft.provider)) setDraft(undefined);
			else setError("保存失败，请检查填写内容");
		} finally { setPending(false); }
	};

	const test = async () => {
		if (!draft || testing) return;
		setTesting(true); setError(undefined); setResult(undefined);
		try { setResult(await onTest(draft.provider.baseUrl, draft.provider.apiKey, draft.provider.models[0].modelId, draft.provider.timeoutSeconds)); }
		catch (e) { setError(String(e)); }
		finally { setTesting(false); }
	};

	const move = async (family: ModelFamily, index: number, offset: number) => {
		const ids = family.providers.map((provider) => provider.id);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		setPending(true);
		try { await onReorder(family.id, ids); } finally { setPending(false); }
	};
	const mutate = async (action: () => Promise<boolean>) => {
		if (pending) return;
		setPending(true); setError(undefined);
		try { await action(); } catch (e) { setError(String(e)); }
		finally { setPending(false); }
	};

	const total = useMemo(() => families.reduce((sum, family) => sum + family.providers.length, 0), [families]);
	// Relay stations usually sell all three families on one endpoint, so cloning
	// an existing channel saves retyping the URL, key, prices and capabilities.
	const clonable = useMemo(() => families.filter((family) => family.id !== draft?.familyId).flatMap((family) => family.providers.map((provider) => ({ family, provider }))), [families, draft?.familyId]);
	const clone = (from: ProviderSpec) => {
		patch({ baseUrl: from.baseUrl, apiKey: from.apiKey, streaming: from.streaming, tools: from.tools, vision: from.vision, reasoning: from.reasoning, timeoutSeconds: from.timeoutSeconds });
		setCloneOpen(false);
	};

	return <dialog ref={dialogRef} className="project-dialog provider-dialog family-dialog" aria-labelledby="families-title" onCancel={(event) => { if (pending) event.preventDefault(); else if (draft) { event.preventDefault(); setDraft(undefined); } else onClose(); }}>
		{draft ? (
			<form onSubmit={(event) => void submit(event)}>
				<div className="dialog-heading"><h2 id="families-title">{draft.isNew ? "添加提供商" : "编辑提供商"} · {FAMILY_LABELS[draft.familyId] ?? draft.familyId}</h2><button type="button" className="icon-btn" onClick={() => setDraft(undefined)} disabled={pending} aria-label="返回提供商列表"><Icon name="close" /></button></div>
				<p className="muted">同一家族可挂多个渠道，每个渠道可配置多个模型及独立单价和限制。</p>
				<div className="clone-row">
					<button type="button" className="btn ghost compact" onClick={() => setCloneOpen((value) => !value)} disabled={pending || !clonable.length} aria-expanded={cloneOpen}><Icon name="copy" size={13} />从其他家族克隆配置</button>
					{cloneOpen && <div className="clone-menu" role="listbox" aria-label="选择要克隆的提供商">
						{clonable.map(({ family, provider }) => <button type="button" key={`${family.id}/${provider.id}`} className="clone-option" onClick={() => clone(provider)} disabled={pending}><span>{FAMILY_LABELS[family.id] ?? family.displayName} · {provider.displayName}</span><small>{maskBaseUrl(provider.baseUrl)}{provider.apiKey ? ` · 密钥 ${maskKey(provider.apiKey)}` : ""}</small></button>)}
					</div>}
					<p className="muted tiny">复用接口地址、密钥和能力开关，请填写本家族的显示名与模型配置。</p>
				</div>
				<div className="provider-field"><label htmlFor="family-name">显示名</label><input id="family-name" required maxLength={32} placeholder="官方直连 / 硅基低价 / 中转站 A" value={draft.provider.displayName} onChange={(event) => patch({ displayName: event.target.value })} disabled={pending} /></div>
				<div className="provider-field"><label htmlFor="family-base">接口地址</label><input id="family-base" required placeholder="https://api.example.com/v1" value={draft.provider.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} disabled={pending} /><small>OpenAI 兼容根地址，以 http:// 或 https:// 开头，包含 /v1 等前缀。</small></div>
				<div className="provider-field"><label htmlFor="family-key">接口密钥</label><span className="field-with-action"><input id="family-key" type={reveal ? "text" : "password"} autoComplete="off" placeholder={draft.isNew ? "sk-…" : "留空则保留原密钥"} value={draft.provider.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} disabled={pending} /><button type="button" className="btn ghost compact" onClick={() => setReveal((value) => !value)} disabled={pending}>{reveal ? "隐藏" : "显示"}</button></span><small>密钥在本机加密保存，列表仅显示后 4 位。</small></div>
				<div className="provider-models">
					<div className="provider-models-heading"><strong>模型配置</strong><small>单价按每百万令牌填写，顺序与选择器一致</small></div>
					{draft.provider.models.map((model, index) => <div className="provider-model-row" key={index}>
						<div className="provider-model-first">
							<ModelIdField baseUrl={draft.provider.baseUrl} apiKey={draft.provider.apiKey} familyId={draft.familyId} value={model.modelId} onChange={(modelId) => patchModel(index, { modelId })} addedIds={draft.provider.models.map((item) => item.modelId.trim())} onAdd={(ids) => addModels(index, ids)} disabled={pending} />
							<div className="provider-model-actions">
								<button type="button" className="icon-btn" disabled={pending || index === 0} onClick={() => moveModel(index, -1)} aria-label={`上移模型 ${index + 1}`} title="上移模型"><Icon name="arrow" size={14} /></button>
								<button type="button" className="icon-btn flip" disabled={pending || index === draft.provider.models.length - 1} onClick={() => moveModel(index, 1)} aria-label={`下移模型 ${index + 1}`} title="下移模型"><Icon name="arrow" size={14} /></button>
								<button type="button" className="icon-btn" disabled={pending || draft.provider.models.length <= 1} onClick={() => patch({ models: draft.provider.models.filter((_, row) => row !== index) })} aria-label={`删除模型 ${index + 1}`} title="删除模型，至少保留一行"><Icon name="trash" size={14} /></button>
							</div>
						</div>
						<div className="provider-model-limits">
							<label>输入单价<input type="number" required min={0} step="0.000001" value={model.inputCost} onChange={(event) => patchModel(index, { inputCost: Number(event.target.value) })} disabled={pending} /></label>
							<label>输出单价<input type="number" required min={0} step="0.000001" value={model.outputCost} onChange={(event) => patchModel(index, { outputCost: Number(event.target.value) })} disabled={pending} /></label>
							<label>币种<select value={model.currency} onChange={(event) => patchModel(index, { currency: event.target.value === "USD" ? "USD" : "CNY" })} disabled={pending}><option value="CNY">人民币</option><option value="USD">美元</option></select></label>
							<label>默认最大输出<input type="number" required min={1} step={1} max={model.contextWindow} value={model.maxTokens} onChange={(event) => patchModel(index, { maxTokens: Number(event.target.value) })} disabled={pending} /></label>
							<label>上下文窗口<input type="number" required min={1} step={1} value={model.contextWindow} onChange={(event) => patchModel(index, { contextWindow: Number(event.target.value) })} disabled={pending} /></label>
						</div>
					</div>)}
					<button type="button" className="btn ghost compact" disabled={pending} onClick={() => patch({ models: [...draft.provider.models, blankModel()] })}>添加模型</button>
				</div>
				<div className="provider-capabilities"><label><input type="checkbox" checked={draft.provider.streaming} onChange={(event) => patch({ streaming: event.target.checked })} disabled={pending} />流式输出</label><label><input type="checkbox" checked={draft.provider.tools} onChange={(event) => patch({ tools: event.target.checked })} disabled={pending} />工具调用</label><label><input type="checkbox" checked={draft.provider.vision} onChange={(event) => patch({ vision: event.target.checked })} disabled={pending} />视觉输入</label></div>
				<div className="provider-field"><label htmlFor="family-timeout">超时（秒）</label><input id="family-timeout" type="number" min={5} max={600} value={draft.provider.timeoutSeconds} onChange={(event) => patch({ timeoutSeconds: Number(event.target.value) })} disabled={pending} /><small>超过此时间会终止请求并提示超时。</small></div>
				<div className="provider-capabilities"><label><input type="checkbox" checked={draft.provider.enabled} onChange={(event) => patch({ enabled: event.target.checked })} disabled={pending} />启用该提供商</label></div>
				<div className="test-row"><button type="button" className="btn ghost" onClick={() => void test()} disabled={pending || testing || !draft.provider.baseUrl || !draft.provider.apiKey || !draft.provider.models[0].modelId}>{testing ? "正在测试…" : "测试连接"}</button>{result && <span className={`test-result ${result.ok ? "ok" : "bad"}`} role="status">{result.ok ? `连接成功 · ${result.latencyMs} ms` : `连接失败 · ${result.latencyMs} ms${result.status ? ` · HTTP ${result.status}` : ""}${result.error ? ` · ${result.error}` : ""}`}</span>}</div>
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><button type="button" className="btn ghost" onClick={() => setDraft(undefined)} disabled={pending}>返回</button><button className="btn primary" disabled={pending}>{pending ? "保存中…" : "保存"}</button></div>
			</form>
		) : (
			<>
				<div className="dialog-heading"><h2 id="families-title">管理提供商</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="关闭提供商设置"><Icon name="close" /></button></div>
				<p className="muted">固定三个模型家族。每个家族可添加任意多个提供商（官方、硅基流动、OpenRouter、中转站等），共 {`${total}`} 个。</p>
				{families.map((family) => <section className="family-card" key={family.id}>
					<div className="family-card-head">
						<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}<small>{family.providers.length} 个提供商</small></span>
						<button type="button" className="btn ghost compact" onClick={() => open(family.id)} disabled={pending}>添加提供商</button>
					</div>
					{family.providers.length === 0 && <p className="family-empty">还没添加提供商，去添加</p>}
					{family.providers.map((provider, index) => <div className={`provider-row ${provider.enabled ? "" : "disabled"}`} key={provider.id}>
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>{provider.displayName}</strong>{family.defaultProviderId === provider.id && <span className="provider-tag">默认</span>}{!provider.enabled && <span className="provider-tag muted-tag">已停用</span>}</div>
							<small>{maskBaseUrl(provider.baseUrl)} · {provider.models.length ? `${provider.models.length} 个模型：${provider.models.map((model) => model.modelId).join("、")}` : "未配置完整，请添加模型"}{provider.apiKey ? ` · 密钥 ${maskKey(provider.apiKey)}` : ""}</small>
						</div>
						<div className="provider-row-actions">
							<label className="provider-toggle" title={provider.enabled ? "停用" : "启用"}><input type="checkbox" checked={provider.enabled} disabled={pending} onChange={(event) => void mutate(() => onToggle(family.id, provider.id, event.target.checked))} aria-label={`${provider.enabled ? "停用" : "启用"} ${provider.displayName}`} /></label>
							<button type="button" className="icon-btn" disabled={pending || index === 0} onClick={() => void move(family, index, -1)} aria-label={`上移 ${provider.displayName}`}><Icon name="arrow" size={14} /></button>
							<button type="button" className="icon-btn flip" disabled={pending || index === family.providers.length - 1} onClick={() => void move(family, index, 1)} aria-label={`下移 ${provider.displayName}`}><Icon name="arrow" size={14} /></button>
							<button type="button" className="icon-btn" disabled={pending || !provider.enabled || !provider.models.length || family.defaultProviderId === provider.id} onClick={() => void mutate(() => onSetDefault(family.id, provider.id))} title="设为默认" aria-label={`将 ${provider.displayName} 设为默认`}><Icon name="check" size={14} /></button>
							<button type="button" className="icon-btn" onClick={() => open(family.id, provider)} disabled={pending} aria-label={`编辑 ${provider.displayName}`}><Icon name="edit" size={14} /></button>
							<button type="button" className="icon-btn" onClick={() => setRemoving({ familyId: family.id, provider })} disabled={pending || family.providers.length <= 1} title={family.providers.length <= 1 ? "每个家族至少保留一个提供商" : "删除"} aria-label={`删除 ${provider.displayName}`}><Icon name="trash" size={14} /></button>
						</div>
					</div>)}
				</section>)}
				<div className="family-footer"><label className="provider-toggle inline"><input type="checkbox" checked={autoFailover} disabled={pending} onChange={(event) => void mutate(() => onAutoFailover(event.target.checked))} />失败时自动切换到同家族下一个可用提供商（默认关闭）</label></div>
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><button type="button" className="btn primary" onClick={onClose} disabled={pending}>完成</button></div>
			</>
		)}
		{removing && <ConfirmDialog title="删除提供商" description={`将从「${FAMILY_LABELS[removing.familyId] ?? removing.familyId}」移除 ${removing.provider.displayName}，其密钥会一并删除。`} onConfirm={() => void mutate(() => onDelete(removing.familyId, removing.provider.id))} onClose={() => setRemoving(undefined)} />}
	</dialog>;
}
