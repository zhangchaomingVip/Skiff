import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TestResult } from "../chat/useModelFamilies";
import { FAMILY_LABELS, blankRelay, blankRoute, blankModel, validateModels, maskBaseUrl, maskKey, type ModelFamily, type ModelSpec, type RelaySpec, type RouteSpec } from "../chat/useModelFamilies";
import { filterPresets, hostOf, matchPreset, PRESET_KINDS, type ProviderPreset } from "../chat/providerPresets";
import type { PricedModel } from "../chat/pricingPage";
import { catalogEntryToPriced } from "../chat/pricingPage";
import { fetchPublicCatalog, type CatalogEntry } from "../rpc/pricingPage";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ModelIdField } from "./ModelIdField";
import { PriceImport, type ExtractorPick } from "./PriceImport";
import { ProviderIcon } from "./ProviderIcon";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

const openLink = (url: string) => void invoke("open_url", { url }).catch((error) => console.error(String(error)));

type Draft =
	| { kind: "pick" }
	| { kind: "relay"; relay: RelaySpec; isNew: boolean; preset?: ProviderPreset }
	| { kind: "route"; familyId: string; route: RouteSpec; isNew: boolean };

/**
 * Settings for relays and model families. Adding a relay starts from a
 * vendor directory (search + kind sections); the editor asks for the key
 * over the preset's endpoint. Forms take over the dialog body so the lists
 * stay uncluttered.
 */
export function FamiliesSettings({ families, relays, autoFailover, usdCnyRate, onSaveRate, onClose, onSaveRelay, onDeleteRelay, onSetRelayEnabled, onSaveRoute, onDeleteRoute, onReorderRoutes, onSetDefaultRoute, onAutoFailover, onTest, onDiscover, configError }: {
	families: ModelFamily[];
	relays: RelaySpec[];
	autoFailover: boolean;
	usdCnyRate: number;
	onSaveRate: (rate: number) => Promise<boolean>;
	configError?: string;
	onClose: () => void;
	onSaveRelay: (relay: RelaySpec) => Promise<RelaySpec | undefined>;
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
	const [tab, setTab] = useState<"relays" | "families">(relays.length ? "families" : "relays");
	const [draft, setDraft] = useState<Draft>();
	const [query, setQuery] = useState("");
	const [added, setAdded] = useState<{ relayId: string; relayName: string; familyId: string }>();
	const [removing, setRemoving] = useState<{ title: string; description: string; action: () => Promise<boolean> }>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [reveal, setReveal] = useState(false);
	const [testing, setTesting] = useState(false);
	const [result, setResult] = useState<TestResult>();
	const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
	const [catalogStale, setCatalogStale] = useState(false);
	const [catalogFetchedAt, setCatalogFetchedAt] = useState(0);

	// 官方牌价目录：失败静默（导入面板的牌价区会显示加载中/不可用）。
	useEffect(() => {
		let alive = true;
		void fetchPublicCatalog().then((response) => {
			if (!alive) return;
			setCatalog(response.models);
			setCatalogStale(response.stale);
			setCatalogFetchedAt(response.fetchedAt);
		}).catch(() => {});
		return () => { alive = false; };
	}, []);

	useEffect(() => { dialogRef.current?.showModal(); }, []);

	const openPick = () => {
		setError(undefined); setResult(undefined); setReveal(false); setQuery("");
		setDraft({ kind: "pick" });
	};
	const openRelay = (relay?: RelaySpec, preset?: ProviderPreset) => {
		setError(undefined); setResult(undefined); setReveal(false);
		if (relay) {
			setDraft({ kind: "relay", relay: { ...relay }, isNew: false, preset: preset ?? matchPreset(relay.baseUrl) });
		} else if (preset) {
			setDraft({ kind: "relay", relay: { ...blankRelay(), name: preset.name, baseUrl: preset.baseUrl }, isNew: true, preset });
		} else {
			setDraft({ kind: "relay", relay: blankRelay(), isNew: true });
		}
	};
	const openRoute = (familyId: string, route?: RouteSpec, preferredRelayId?: string) => {
		setError(undefined); setResult(undefined); setReveal(false);
		const fallbackRelay = preferredRelayId ?? relays[0]?.id ?? "";
		setDraft({ kind: "route", familyId, route: route ? { ...route, models: route.models.length ? route.models.map((model) => ({ ...model })) : [blankModel()] } : blankRoute(fallbackRelay), isNew: !route });
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
	// Discovery only returns ids; matched catalog entries arrive with official
	// prices already converted to CNY at the configured rate.
	const fillFromCatalog = (modelId: string): ModelSpec => {
		const entry = catalog.find((item) => item.modelId.toLowerCase() === modelId.toLowerCase());
		const blank = blankModel();
		if (!entry) return { ...blank, modelId };
		const priced = catalogEntryToPriced(entry, usdCnyRate);
		const contextWindow = priced.contextWindow ?? blank.contextWindow;
		return {
			...blank,
			modelId: entry.modelId,
			inputCost: priced.inputCost,
			outputCost: priced.outputCost,
			currency: "CNY",
			contextWindow,
			maxTokens: priced.maxTokens ? Math.min(priced.maxTokens, contextWindow) : Math.min(blank.maxTokens, contextWindow),
		};
	};

	const addModels = (index: number, ids: string[]) => {
		if (!draft || draft.kind !== "route") return;
		const models = [...draft.route.models];
		const existing = new Set(models.map((model) => model.modelId.trim()));
		const additions = ids.filter((id) => !existing.has(id)).map(fillFromCatalog);
		// Fill an empty row first so batch discovery leaves no invalid blank row.
		if (!models[index].modelId.trim() && additions.length) models.splice(index, 1, ...additions);
		else models.splice(index + 1, 0, ...additions);
		patchRoute({ models });
	};

	// Pricing-page import refreshes prices on existing ids and appends the rest,
	// dropping the placeholder row once real models land.
	const importPriced = (priced: PricedModel[]) => {
		if (!draft || draft.kind !== "route") return;
		const models = [...draft.route.models];
		for (const item of priced) {
			const index = models.findIndex((model) => model.modelId.trim().toLowerCase() === item.modelId.toLowerCase());
			if (index >= 0) {
				const contextWindow = item.contextWindow ?? models[index].contextWindow;
				models[index] = {
					...models[index], inputCost: item.inputCost, outputCost: item.outputCost, currency: item.currency,
					contextWindow, maxTokens: item.maxTokens ? Math.min(item.maxTokens, contextWindow) : models[index].maxTokens,
				};
			} else {
				const blank = blankModel();
				const contextWindow = item.contextWindow ?? blank.contextWindow;
				models.push({
					...blank, modelId: item.modelId, inputCost: item.inputCost, outputCost: item.outputCost, currency: item.currency,
					contextWindow, maxTokens: item.maxTokens ? Math.min(item.maxTokens, contextWindow) : blank.maxTokens,
				});
			}
		}
		if (models.length > 1 && !models[0].modelId.trim()) models.shift();
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
		if (!relay.name.trim()) { setError("请填写名称"); return; }
		if (!/^https?:\/\//i.test(relay.baseUrl.trim())) { setError("接口地址必须以 http:// 或 https:// 开头"); return; }
		if (relays.some((item) => item.id !== relay.id && item.name.trim().toLowerCase() === relay.name.trim().toLowerCase())) { setError("名称不能重复"); return; }
		if (draft.isNew && !result?.ok) { setError("请先通过连接测试再保存"); return; }
		setPending(true); setError(undefined);
		try {
			const saved = await onSaveRelay(relay);
			if (saved) {
				// 保存成功后回到列表；有默认家族的预设引导去配置线路。
				if (draft.preset?.familyId) {
					setAdded({ relayId: saved.id, relayName: saved.name, familyId: draft.preset.familyId });
					setTab("families");
				}
				setDraft(undefined);
			} else {
				setError("保存失败，请检查填写内容");
			}
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
	// 已配置的模型都可用于截图识别；视觉线路优先，选择器默认落在真能看图的那个。
	const extractors = useMemo(() => {
		const picks: ExtractorPick[] = [];
		for (const family of families) {
			for (const route of family.routes) {
				const relay = relays.find((item) => item.id === route.relayId);
				if (!relay || !relay.enabled || !relay.apiKey) continue;
				for (const model of route.models) {
					if (!model.modelId.trim()) continue;
					picks.push({ key: `${relay.id} ${model.modelId}`, relayName: relay.name, baseUrl: relay.baseUrl, apiKey: relay.apiKey, modelId: model.modelId.trim(), inputCost: model.inputCost, outputCost: model.outputCost, currency: model.currency, vision: route.vision });
				}
			}
		}
		return picks.sort((a, b) => Number(b.vision) - Number(a.vision));
	}, [families, relays]);
	const relayName = (relayId: string) => relays.find((relay) => relay.id === relayId)?.name ?? "未知中转";
	// 密钥指纹：前 4 + 后 4（如 sk-1…8961），列表右侧的状态提示。
	const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : maskKey(key));
	// 供应商行展示该中继跨家族去重后的模型数。
	const relayModelCount = useMemo(() => {
		const counts = new Map<string, Set<string>>();
		for (const family of families) {
			for (const route of family.routes) {
				let bucket = counts.get(route.relayId);
				if (!bucket) counts.set(route.relayId, bucket = new Set());
				for (const model of route.models) if (model.modelId.trim()) bucket.add(model.modelId.trim());
			}
		}
		return (relayId: string) => counts.get(relayId)?.size ?? 0;
	}, [families]);
	const reorder = (routes: RouteSpec[], index: number, offset: number) => {
		const ids = routes.map((route) => route.relayId);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return ids;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		return ids;
	};

	return <dialog ref={dialogRef} className="project-dialog provider-dialog family-dialog" aria-labelledby="families-title" onCancel={(event) => { if (pending) event.preventDefault(); else if (draft) { event.preventDefault(); setDraft(undefined); } else onClose(); }}>
		{draft?.kind === "pick" ? (
			<div className="provider-sheet">
				<div className="dialog-heading provider-sheet-head">
					<h2 id="families-title">{relays.length ? "添加供应商" : "添加第一个供应商"}</h2>
					<span className="provider-sheet-search"><Icon name="search" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索供应商…" aria-label="搜索供应商" autoFocus /></span>
					<button type="button" className="icon-btn" onClick={() => setDraft(undefined)} aria-label="返回列表"><Icon name="close" /></button>
				</div>
				<div className="provider-sheet-body">
					{PRESET_KINDS.map(({ kind, title, hint }) => {
						const list = filterPresets(query).filter((preset) => preset.kind === kind);
						if (!list.length) return null;
						return <section key={kind}>
							<h3 className="preset-kind-title">{title}<span>{hint}</span></h3>
							<div className="preset-grid">
								{list.map((preset) => {
									const addedPreset = relays.some((relay) => matchPreset(relay.baseUrl)?.id === preset.id);
									return <button key={preset.id} type="button" className="preset-tile" onClick={() => openRelay(undefined, preset)}>
										<ProviderIcon id={preset.id} name={preset.name} size={18} />
										<span className="preset-tile-name">{preset.name}</span>
										{addedPreset && <span className="preset-tile-added">已添加</span>}
									</button>;
								})}
							</div>
						</section>;
					})}
					{filterPresets(query).length === 0 && <p className="family-empty">没有叫「{query.trim()}」的供应商，可以添加为自定义供应商。</p>}
					<button type="button" className="preset-custom" onClick={() => openRelay()}>
						<Icon name="plus" size={14} />
						<span>自定义供应商</span>
						<small>任意 OpenAI 兼容地址</small>
					</button>
				</div>
			</div>
		) : draft?.kind === "relay" ? (
			(() => {
				const relay = draft.relay;
				const preset = draft.preset;
				const site = preset?.website;
				return <form className="preset-editor" onSubmit={(event) => void submitRelay(event)}>
					<div className="editor-head">
						<ProviderIcon id={preset?.id ?? ""} name={relay.name} size={20} />
						<h2 id="families-title">{draft.isNew ? (preset ? preset.name : "自定义供应商") : relay.name}</h2>
						{preset?.familyId && <span className="provider-tag">{FAMILY_LABELS[preset.familyId]} 家族</span>}
						<span className="grow" />
						{site && <button type="button" className="editor-site" onClick={() => openLink(site)} title={site}>{hostOf(site)} ↗</button>}
						<button type="button" className="icon-btn" onClick={() => setDraft(undefined)} disabled={pending} aria-label="返回列表"><Icon name="close" /></button>
					</div>
					{draft.isNew && preset && <p className="muted">地址已按预设填好，粘贴密钥并通过连接测试即可；保存后到「模型选择」为它配置线路。</p>}
					<div className="editor-field">
						<label htmlFor="relay-name">名称</label>
						<div className="editor-control">
							<input id="relay-name" required maxLength={32} placeholder="官方直连 / 硅基低价 / 中转站 A" value={relay.name} onChange={(event) => patchRelay({ name: event.target.value })} disabled={pending} />
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-key">API 密钥</label>
						<div className="editor-control">
							<span className="editor-key-row">
								<input id="relay-key" type={reveal ? "text" : "password"} autoComplete="off" placeholder={draft.isNew ? (preset?.keyOptional ? "可选，本地服务可留空" : "粘贴 API 密钥") : "留空则保留原密钥"} value={relay.apiKey} onChange={(event) => patchRelay({ apiKey: event.target.value })} disabled={pending} />
								<button type="button" className="btn ghost compact" onClick={() => setReveal((value) => !value)} disabled={pending}>{reveal ? "隐藏" : "显示"}</button>
								{preset?.keysUrl && <button type="button" className="btn ghost compact" onClick={() => openLink(preset.keysUrl)}>获取密钥 ↗</button>}
							</span>
							<small>密钥在本机加密保存，列表仅显示后 4 位。</small>
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-base">端点</label>
						<div className="editor-control">
							<span className="editor-endpoint">
								<span className="editor-protocol" title="OpenAI 兼容接口">OpenAI</span>
								<input id="relay-base" required placeholder="https://api.example.com/v1" value={relay.baseUrl} onChange={(event) => patchRelay({ baseUrl: event.target.value })} disabled={pending} />
							</span>
							<small>OpenAI 兼容根地址，以 http:// 或 https:// 开头，包含 /v1 等前缀。</small>
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-timeout">超时</label>
						<div className="editor-control">
							<input id="relay-timeout" type="number" min={5} max={600} value={relay.timeoutSeconds} onChange={(event) => patchRelay({ timeoutSeconds: Number(event.target.value) })} disabled={pending} />
							<small>超过此时间会终止请求并提示超时。</small>
						</div>
					</div>
					{draft.isNew && <div className="test-row"><button type="button" className="btn ghost" onClick={() => void testRelay()} disabled={pending || testing || !relay.baseUrl || (!relay.apiKey && !preset?.keyOptional)}>{testing ? "正在测试…" : "测试连接"}</button>{result && <span className={`test-result ${result.ok ? "ok" : "bad"}`} role="status">{result.ok ? `连接成功 · ${result.latencyMs} ms` : `连接失败 · ${result.latencyMs} ms${result.status ? ` · HTTP ${result.status}` : ""}${result.error ? ` · ${result.error}` : ""}`}</span>}<small>新中转需先通过一次连接测试才能保存。</small></div>}
					{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
					<div className="dialog-actions editor-actions">
						{!draft.isNew && <button type="button" className="btn text-danger" onClick={() => setRemoving({ title: "删除供应商", description: `将删除供应商「${relay.name}」，其全部线路与密钥会一并删除。`, action: async () => { const ok = await onDeleteRelay(relay.id); if (ok) setDraft(undefined); return ok; } })} disabled={pending}>删除</button>}
						<span className="grow" />
						<button type="button" className="btn ghost" onClick={() => setDraft(undefined)} disabled={pending}>取消</button>
						<button className="btn primary" disabled={pending || (draft.isNew && !result?.ok)}>{pending ? "保存中…" : draft.isNew ? "添加" : "保存"}</button>
					</div>
				</form>;
			})()
		) : draft?.kind === "route" ? (
			<form onSubmit={(event) => void submitRoute(event)}>
				<div className="dialog-heading"><h2 id="families-title">{draft.isNew ? "添加线路" : "编辑线路"} · {FAMILY_LABELS[draft.familyId] ?? draft.familyId}</h2><button type="button" className="icon-btn" onClick={() => setDraft(undefined)} disabled={pending} aria-label="返回列表"><Icon name="close" /></button></div>
				<p className="muted">线路声明该中转在本家族下可用的模型及价格，能力开关按线路生效。</p>
				<div className="provider-field"><label htmlFor="route-relay">所属中转</label><select id="route-relay" required value={draft.route.relayId} onChange={(event) => patchRoute({ relayId: event.target.value })} disabled={pending || !draft.isNew}>
					<option value="" disabled>选择中转…</option>
					{relays.map((relay) => <option key={relay.id} value={relay.id}>{relay.name}（{maskBaseUrl(relay.baseUrl)}）</option>)}
				</select><small>地址与密钥来自中转，无需重复填写。</small></div>
				<div className="provider-models">
					<div className="provider-models-heading"><strong>模型配置</strong><small>单价按每百万令牌填写，顺序与选择器一致</small><PriceImport key={`${draft.familyId}:${draft.route.relayId}`} familyId={draft.familyId} addedIds={draft.route.models.map((model) => model.modelId.trim()).filter(Boolean)} extractors={extractors} catalog={catalog} catalogStale={catalogStale} catalogFetchedAt={catalogFetchedAt} usdCnyRate={usdCnyRate} onSaveRate={onSaveRate} relayBaseUrl={relays.find((relay) => relay.id === draft.route.relayId)?.baseUrl ?? ""} disabled={pending} onImport={importPriced} /></div>
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
				<p className="muted">先从供应商目录添加地址与密钥，再在家族卡片里为它配置线路；共 {`${total}`} 条线路。</p>
				<div className="dialog-tabs" role="tablist" aria-label="模型配置分类">
					<button type="button" role="tab" id="families-tab-relays" aria-selected={tab === "relays"} aria-controls="families-panel-relays" className={`dialog-tab ${tab === "relays" ? "active" : ""}`} onClick={() => setTab("relays")}>供应商<small>{relays.length} 个</small></button>
					<button type="button" role="tab" id="families-tab-models" aria-selected={tab === "families"} aria-controls="families-panel-models" className={`dialog-tab ${tab === "families" ? "active" : ""}`} onClick={() => setTab("families")}>模型选择<small>{total} 条线路</small></button>
				</div>
				{tab === "relays" ? (
					<>
					<section className="family-card" id="families-panel-relays" role="tabpanel" aria-labelledby="families-tab-relays">
						{relays.length === 0 && <p className="family-empty">还没添加供应商，从下面的目录挑一个，或用自定义地址。</p>}
						{relays.map((relay) => {
							const preset = matchPreset(relay.baseUrl);
							return <div className={`provider-row ${relay.enabled ? "" : "disabled"}`} key={relay.id}>
								<button type="button" className="provider-relay-btn" onClick={() => openRelay(relay, preset)} disabled={pending} aria-label={`编辑 ${relay.name}`}>
									<ProviderIcon id={preset?.id ?? ""} name={relay.name} size={22} />
									<span className="provider-row-text">
										<span className="provider-row-title"><strong>{relay.name}</strong>{!relay.enabled && <span className="provider-tag muted-tag">已停用</span>}</span>
										<small>{maskBaseUrl(relay.baseUrl)} · {relayModelCount(relay.id) ? `${relayModelCount(relay.id)} 个模型` : "未配置模型"}</small>
									</span>
								</button>
								<div className="provider-row-side">
									{relay.apiKey && <span className="provider-key" title="密钥已保存"><span className="dot ok" />{keyHint(relay.apiKey)}</span>}
									<label className="switch" title={relay.enabled ? "停用" : "启用"}>
										<input type="checkbox" checked={relay.enabled} disabled={pending} onChange={(event) => void mutate(() => onSetRelayEnabled(relay.id, event.target.checked))} aria-label={`${relay.enabled ? "停用" : "启用"} ${relay.name}`} />
										<span className="slider" />
									</label>
									<Icon name="chevron" size={14} />
								</div>
							</div>;
						})}
					</section>
					<button type="button" className="preset-custom provider-add" onClick={openPick} disabled={pending}>
						<Icon name="plus" size={14} />
						<span>添加供应商</span>
					</button>
					</>
				) : (
					<div id="families-panel-models" role="tabpanel" aria-labelledby="families-tab-models">
						{added && <p className="family-added-hint" role="status">已添加「{added.relayName}」，去 {FAMILY_LABELS[added.familyId]} 家族配置模型线路：<button type="button" className="btn ghost compact" disabled={pending || !relays.some((relay) => relay.id === added.relayId)} onClick={() => { openRoute(added.familyId, undefined, added.relayId); setAdded(undefined); }}>添加线路</button></p>}
						{relays.length === 0 && <section className="family-card">
							<div className="family-card-head">
								<span className="family-card-title">还没有供应商</span>
								<button type="button" className="btn ghost compact" onClick={() => setTab("relays")}>去添加供应商</button>
							</div>
							<p className="family-empty">线路依附于供应商：先到「供应商」添加地址与密钥，再回来为各家族配置线路。</p>
						</section>}
						{families.map((family) => <section className="family-card" key={family.id}>
							<div className="family-card-head">
								<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}<small>{family.routes.length} 条线路</small></span>
								<button type="button" className="btn ghost compact" onClick={() => openRoute(family.id)} disabled={pending || !relays.length} title={relays.length ? undefined : "请先添加供应商"}>添加线路</button>
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
					</div>
				)}
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><button type="button" className="btn primary" onClick={onClose} disabled={pending}>完成</button></div>
			</>
		)}
		{removing && <ConfirmDialog title={removing.title} description={removing.description} onConfirm={() => void mutate(removing.action)} onClose={() => setRemoving(undefined)} />}
	</dialog>;
}
