import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { TestResult } from "../chat/useModelFamilies";
import { FAMILY_LABELS, blankRelay, blankRoute, blankModel, validateModels, maskBaseUrl, maskKey, type ModelFamily, type ModelSpec, type RelaySpec, type RouteSpec } from "../chat/useModelFamilies";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ModelIdField } from "./ModelIdField";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

type Draft = { kind: "relay"; relay: RelaySpec; isNew: boolean } | { kind: "route"; familyId: string; route: RouteSpec; isNew: boolean };

/**
 * Settings for relays and model families. Relays hold the endpoint and key;
 * family cards list the routes (relay × family) with their models. Forms take
 * over the dialog body so the lists stay uncluttered.
 */
export function FamiliesSettings({ families, relays, autoFailover, onClose, onSaveRelay, onDeleteRelay, onSetRelayEnabled, onSaveRoute, onDeleteRoute, onReorderRoutes, onSetDefaultRoute, onAutoFailover, onTest, onDiscover, configError }: {
	families: ModelFamily[];
	relays: RelaySpec[];
	autoFailover: boolean;
	configError?: string;
	onClose: () => void;
	onSaveRelay: (relay: RelaySpec) => Promise<boolean>;
	onDeleteRelay: (relayId: string) => Promise<boolean>;
	onSetRelayEnabled: (relayId: string, enabled: boolean) => Promise<boolean>;
	onSaveRoute: (familyId: string, route: RouteSpec) => Promise<boolean>;
	onDeleteRoute: (familyId: string, relayId: string) => Promise<boolean>;
	onReorderRoutes: (familyId: string, relayIds: string[]) => Promise<boolean>;
	onSetDefaultRoute: (familyId: string, relayId: string | null) => Promise<boolean>;
	onAutoFailover: (autoFailover: boolean) => Promise<boolean>;
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number) => Promise<TestResult>;
	onDiscover: (baseUrl: string, apiKey: string) => Promise<string[]>;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [draft, setDraft] = useState<Draft>();
	const [removing, setRemoving] = useState<{ title: string; description: string; action: () => Promise<boolean> }>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [reveal, setReveal] = useState(false);
	const [testing, setTesting] = useState(false);
	const [result, setResult] = useState<TestResult>();

	useEffect(() => { dialogRef.current?.showModal(); }, []);

	const openRelay = (relay?: RelaySpec) => {
		setError(undefined); setResult(undefined); setReveal(false);
		setDraft({ kind: "relay", relay: relay ? { ...relay } : blankRelay(), isNew: !relay });
	};
	const openRoute = (familyId: string, route?: RouteSpec) => {
		setError(undefined); setResult(undefined); setReveal(false);
		setDraft({ kind: "route", familyId, route: route ? { ...route, models: route.models.length ? route.models.map((model) => ({ ...model })) : [blankModel()] } : blankRoute(relays[0]?.id), isNew: !route });
	};

	const patchRelay = (value: Partial<RelaySpec>) => {
		setResult(undefined);
		setDraft((current) => current && current.kind === "relay" ? { ...current, relay: { ...current.relay, ...value } } : current);
	};
	const patchRoute = (value: Partial<RouteSpec>) => {
		setDraft((current) => current && current.kind === "route" ? { ...current, route: { ...current.route, ...value } } : current);
	};

	const patchModel = (index: number, value: Partial<ModelSpec>) => {
		if (!draft || draft.kind !== "route") return;
		patchRoute({ models: draft.route.models.map((model, row) => row === index ? { ...model, ...value } : model) });
	};
	const moveModel = (index: number, offset: number) => {
		if (!draft || draft.kind !== "route") return;
		const models = [...draft.route.models];
		const target = index + offset;
		if (target < 0 || target >= models.length) return;
		[models[index], models[target]] = [models[target], models[index]];
		patchRoute({ models });
	};
	const addModels = (index: number, ids: string[]) => {
		if (!draft || draft.kind !== "route") return;
		const models = [...draft.route.models];
		const existing = new Set(models.map((model) => model.modelId.trim()));
		const additions = ids.filter((id) => !existing.has(id)).map((modelId) => ({ ...blankModel(), modelId }));
		// Fill an empty row first so batch discovery leaves no invalid blank row.
		if (!models[index].modelId.trim() && additions.length) models.splice(index, 1, ...additions);
		else models.splice(index + 1, 0, ...additions);
		patchRoute({ models });
	};

	// A new relay must pass one live connection test (max_tokens=1) before it
	// can be saved; the test model is picked from the relay's own /models list.
	const testRelay = async () => {
		if (!draft || draft.kind !== "relay" || testing) return;
		const relay = draft.relay;
		setTesting(true); setError(undefined); setResult(undefined);
		try {
			const models = await onDiscover(relay.baseUrl, relay.apiKey);
			if (!models.length) { setError("接口未返回模型，无法测试连接"); return; }
			setResult(await onTest(relay.baseUrl, relay.apiKey, models[0], relay.timeoutSeconds));
		} catch (e) { setError(String(e)); }
		finally { setTesting(false); }
	};

	const submitRelay = async (event: FormEvent) => {
		event.preventDefault();
		if (!draft || draft.kind !== "relay" || pending) return;
		const relay = draft.relay;
		if (!/^https?:\/\//i.test(relay.baseUrl.trim())) { setError("接口地址必须以 http:// 或 https:// 开头"); return; }
		if (relays.some((item) => item.id !== relay.id && item.name.trim().toLowerCase() === relay.name.trim().toLowerCase())) { setError("中转名称不能重复"); return; }
		if (draft.isNew && !result?.ok) { setError("请先通过连接测试再保存新中转"); return; }
		setPending(true); setError(undefined);
		try {
			if (await onSaveRelay(relay)) setDraft(undefined);
			else setError("保存失败，请检查填写内容");
		} finally { setPending(false); }
	};

	const submitRoute = async (event: FormEvent) => {
		event.preventDefault();
		if (!draft || draft.kind !== "route" || pending) return;
		const route = draft.route;
		if (!route.relayId) { setError("请选择该线路所属的中转"); return; }
		const modelError = validateModels(route.models);
		if (modelError) { setError(modelError); return; }
		setPending(true); setError(undefined);
		try {
			if (await onSaveRoute(draft.familyId, route)) setDraft(undefined);
			else setError("保存失败，请检查填写内容");
		} finally { setPending(false); }
	};

	const mutate = async (action: () => Promise<boolean>) => {
		if (pending) return;
		setPending(true); setError(undefined);
		try { await action(); } catch (e) { setError(String(e)); }
		finally { setPending(false); }
	};

	const total = useMemo(() => families.reduce((sum, family) => sum + family.routes.length, 0), [families]);
	const relayName = (relayId: string) => relays.find((relay) => relay.id === relayId)?.name ?? "未知中转";
	const reorder = (routes: RouteSpec[], index: number, offset: number) => {
		const ids = routes.map((route) => route.relayId);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return ids;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		return ids;
	};

	return <dialog ref={dialogRef} className="project-dialog provider-dialog family-dialog" aria-labelledby="families-title" onCancel={(event) => { if (pending) event.preventDefault(); else if (draft) { event.preventDefault(); setDraft(undefined); } else onClose(); }}>
		{draft?.kind === "relay" ? (
			<form onSubmit={(event) => void submitRelay(event)}>
				<div className="dialog-heading"><h2 id="families-title">{draft.isNew ? "添加中转" : "编辑中转"}</h2><button type="button" className="icon-btn" onClick={() => setDraft(undefined)} disabled={pending} aria-label="返回列表"><Icon name="close" /></button></div>
				<p className="muted">中转是接入点：一个 OpenAI 兼容地址加一个密钥，可同时服务多个家族而无需重复录入。</p>
				<div className="provider-field"><label htmlFor="relay-name">名称</label><input id="relay-name" required maxLength={32} placeholder="官方直连 / 硅基低价 / 中转站 A" value={draft.relay.name} onChange={(event) => patchRelay({ name: event.target.value })} disabled={pending} /></div>
				<div className="provider-field"><label htmlFor="relay-base">接口地址</label><input id="relay-base" required placeholder="https://api.example.com/v1" value={draft.relay.baseUrl} onChange={(event) => patchRelay({ baseUrl: event.target.value })} disabled={pending} /><small>OpenAI 兼容根地址，以 http:// 或 https:// 开头，包含 /v1 等前缀。</small></div>
				<div className="provider-field"><label htmlFor="relay-key">接口密钥</label><span className="field-with-action"><input id="relay-key" type={reveal ? "text" : "password"} autoComplete="off" placeholder={draft.isNew ? "sk-…" : "留空则保留原密钥"} value={draft.relay.apiKey} onChange={(event) => patchRelay({ apiKey: event.target.value })} disabled={pending} /><button type="button" className="btn ghost compact" onClick={() => setReveal((value) => !value)} disabled={pending}>{reveal ? "隐藏" : "显示"}</button></span><small>密钥在本机加密保存，列表仅显示后 4 位。</small></div>
				<div className="provider-field"><label htmlFor="relay-timeout">超时（秒）</label><input id="relay-timeout" type="number" min={5} max={600} value={draft.relay.timeoutSeconds} onChange={(event) => patchRelay({ timeoutSeconds: Number(event.target.value) })} disabled={pending} /><small>超过此时间会终止请求并提示超时。</small></div>
				{draft.isNew && <div className="test-row"><button type="button" className="btn ghost" onClick={() => void testRelay()} disabled={pending || testing || !draft.relay.baseUrl || !draft.relay.apiKey}>{testing ? "正在测试…" : "测试连接"}</button>{result && <span className={`test-result ${result.ok ? "ok" : "bad"}`} role="status">{result.ok ? `连接成功 · ${result.latencyMs} ms` : `连接失败 · ${result.latencyMs} ms${result.status ? ` · HTTP ${result.status}` : ""}${result.error ? ` · ${result.error}` : ""}`}</span>}<small>新中转需先通过一次连接测试才能保存。</small></div>}
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><button type="button" className="btn ghost" onClick={() => setDraft(undefined)} disabled={pending}>返回</button><button className="btn primary" disabled={pending || (draft.isNew && !result?.ok)}>{pending ? "保存中…" : "保存"}</button></div>
			</form>
		) : draft?.kind === "route" ? (
			<form onSubmit={(event) => void submitRoute(event)}>
				<div className="dialog-heading"><h2 id="families-title">{draft.isNew ? "添加线路" : "编辑线路"} · {FAMILY_LABELS[draft.familyId] ?? draft.familyId}</h2><button type="button" className="icon-btn" onClick={() => setDraft(undefined)} disabled={pending} aria-label="返回列表"><Icon name="close" /></button></div>
				<p className="muted">线路声明该中转在本家族下可用的模型及价格，能力开关按线路生效。</p>
				<div className="provider-field"><label htmlFor="route-relay">所属中转</label><select id="route-relay" required value={draft.route.relayId} onChange={(event) => patchRoute({ relayId: event.target.value })} disabled={pending || !draft.isNew}>
					<option value="" disabled>选择中转…</option>
					{relays.map((relay) => <option key={relay.id} value={relay.id}>{relay.name}（{maskBaseUrl(relay.baseUrl)}）</option>)}
				</select><small>地址与密钥来自中转，无需重复填写。</small></div>
				<div className="provider-models">
					<div className="provider-models-heading"><strong>模型配置</strong><small>单价按每百万令牌填写，顺序与选择器一致</small></div>
					{draft.route.models.map((model, index) => <div className="provider-model-row" key={index}>
						<div className="provider-model-first">
							<ModelIdField baseUrl={relays.find((relay) => relay.id === draft.route.relayId)?.baseUrl ?? ""} apiKey={relays.find((relay) => relay.id === draft.route.relayId)?.apiKey ?? ""} familyId={draft.familyId} value={model.modelId} onChange={(modelId) => patchModel(index, { modelId })} addedIds={draft.route.models.map((item) => item.modelId.trim())} onAdd={(ids) => addModels(index, ids)} disabled={pending} />
							<div className="provider-model-actions">
								<button type="button" className="icon-btn" disabled={pending || index === 0} onClick={() => moveModel(index, -1)} aria-label={`上移模型 ${index + 1}`} title="上移模型"><Icon name="arrow" size={14} /></button>
								<button type="button" className="icon-btn flip" disabled={pending || index === draft.route.models.length - 1} onClick={() => moveModel(index, 1)} aria-label={`下移模型 ${index + 1}`} title="下移模型"><Icon name="arrow" size={14} /></button>
								<button type="button" className="icon-btn" disabled={pending || draft.route.models.length <= 1} onClick={() => patchRoute({ models: draft.route.models.filter((_, row) => row !== index) })} aria-label={`删除模型 ${index + 1}`} title="删除模型，至少保留一行"><Icon name="trash" size={14} /></button>
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
					<button type="button" className="btn ghost compact" disabled={pending} onClick={() => patchRoute({ models: [...draft.route.models, blankModel()] })}>添加模型</button>
				</div>
				<div className="provider-capabilities"><label><input type="checkbox" checked={draft.route.streaming} onChange={(event) => patchRoute({ streaming: event.target.checked })} disabled={pending} />流式输出</label><label><input type="checkbox" checked={draft.route.tools} onChange={(event) => patchRoute({ tools: event.target.checked })} disabled={pending} />工具调用</label><label><input type="checkbox" checked={draft.route.vision} onChange={(event) => patchRoute({ vision: event.target.checked })} disabled={pending} />视觉输入</label><label><input type="checkbox" checked={draft.route.reasoning} onChange={(event) => patchRoute({ reasoning: event.target.checked })} disabled={pending} />推理输出</label></div>
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><button type="button" className="btn ghost" onClick={() => setDraft(undefined)} disabled={pending}>返回</button><button className="btn primary" disabled={pending}>{pending ? "保存中…" : "保存"}</button></div>
			</form>
		) : (
			<>
				<div className="dialog-heading"><h2 id="families-title">模型配置</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="关闭设置"><Icon name="close" /></button></div>
				<p className="muted">先添加中转（地址与密钥），再在家族卡片里为它配置线路；共 {`${total}`} 条线路。</p>
				<section className="family-card">
					<div className="family-card-head">
						<span className="family-card-title"><Icon name="settings" size={15} />中转提供商<small>{relays.length} 个中转</small></span>
						<button type="button" className="btn ghost compact" onClick={() => openRelay()} disabled={pending}>添加中转</button>
					</div>
					{relays.length === 0 && <p className="family-empty">还没添加中转，去添加</p>}
					{relays.map((relay) => <div className={`provider-row ${relay.enabled ? "" : "disabled"}`} key={relay.id}>
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>{relay.name}</strong>{!relay.enabled && <span className="provider-tag muted-tag">已停用</span>}</div>
							<small>{maskBaseUrl(relay.baseUrl)}{relay.apiKey ? ` · 密钥 ${maskKey(relay.apiKey)}` : ""} · 超时 {relay.timeoutSeconds}s</small>
						</div>
						<div className="provider-row-actions">
							<label className="provider-toggle" title={relay.enabled ? "停用" : "启用"}><input type="checkbox" checked={relay.enabled} disabled={pending} onChange={(event) => void mutate(() => onSetRelayEnabled(relay.id, event.target.checked))} aria-label={`${relay.enabled ? "停用" : "启用"} ${relay.name}`} /></label>
							<button type="button" className="icon-btn" onClick={() => openRelay(relay)} disabled={pending} aria-label={`编辑 ${relay.name}`}><Icon name="edit" size={14} /></button>
							<button type="button" className="icon-btn" onClick={() => setRemoving({ title: "删除中转", description: `将删除中转「${relay.name}」，其全部线路与密钥会一并删除。`, action: () => onDeleteRelay(relay.id) })} disabled={pending} title="删除" aria-label={`删除 ${relay.name}`}><Icon name="trash" size={14} /></button>
						</div>
					</div>)}
				</section>
				{families.map((family) => <section className="family-card" key={family.id}>
					<div className="family-card-head">
						<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}<small>{family.routes.length} 条线路</small></span>
						<button type="button" className="btn ghost compact" onClick={() => openRoute(family.id)} disabled={pending || !relays.length} title={relays.length ? undefined : "请先添加中转"}>添加线路</button>
					</div>
					{family.routes.length === 0 && <p className="family-empty">还没添加线路，去添加</p>}
					{family.routes.map((route, index) => <div className="provider-row" key={route.relayId}>
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>{relayName(route.relayId)}</strong>{family.defaultRelayId === route.relayId && <span className="provider-tag">默认</span>}</div>
							<small>{route.models.length ? `${route.models.length} 个模型：${route.models.map((model) => model.modelId).join("、")}` : "未配置完整，请添加模型"}</small>
						</div>
						<div className="provider-row-actions">
							<button type="button" className="icon-btn" disabled={pending || index === 0} onClick={() => void mutate(() => onReorderRoutes(family.id, reorder(family.routes, index, -1)))} aria-label={`上移 ${relayName(route.relayId)} 的线路`}><Icon name="arrow" size={14} /></button>
							<button type="button" className="icon-btn flip" disabled={pending || index === family.routes.length - 1} onClick={() => void mutate(() => onReorderRoutes(family.id, reorder(family.routes, index, 1)))} aria-label={`下移 ${relayName(route.relayId)} 的线路`}><Icon name="arrow" size={14} /></button>
							<button type="button" className="icon-btn" disabled={pending || family.defaultRelayId === route.relayId || !route.models.length} onClick={() => void mutate(() => onSetDefaultRoute(family.id, route.relayId))} title="设为默认线路" aria-label={`将 ${relayName(route.relayId)} 的线路设为默认`}><Icon name="check" size={14} /></button>
							<button type="button" className="icon-btn" onClick={() => openRoute(family.id, route)} disabled={pending} aria-label={`编辑 ${relayName(route.relayId)} 的线路`}><Icon name="edit" size={14} /></button>
							<button type="button" className="icon-btn" onClick={() => setRemoving({ title: "删除线路", description: `将从「${FAMILY_LABELS[family.id] ?? family.displayName}」移除 ${relayName(route.relayId)} 的线路。`, action: () => onDeleteRoute(family.id, route.relayId) })} disabled={pending} title="删除" aria-label={`删除 ${relayName(route.relayId)} 的线路`}><Icon name="trash" size={14} /></button>
						</div>
					</div>)}
				</section>)}
				<div className="family-footer"><label className="provider-toggle inline"><input type="checkbox" checked={autoFailover} disabled={pending} onChange={(event) => void mutate(() => onAutoFailover(event.target.checked))} />失败时自动切换到同家族下一条提供相同模型的启用线路（默认关闭）</label></div>
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><button type="button" className="btn primary" onClick={onClose} disabled={pending}>完成</button></div>
			</>
		)}
		{removing && <ConfirmDialog title={removing.title} description={removing.description} onConfirm={() => void mutate(removing.action)} onClose={() => setRemoving(undefined)} />}
	</dialog>;
}

