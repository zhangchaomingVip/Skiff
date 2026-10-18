import { forwardRef, useMemo, useState, type FormEvent } from "react";
import { blankModel, blankRoute, DEFAULT_THINKING_LEVELS, FAMILY_LABELS, maskBaseUrl, normalizeThinkingLevels, resolveThinkingLevels, THINKING_LEVELS, validateModels, type ModelFamily, type ModelSpec, type RelaySpec, type RouteSpec, type ThinkingLevel } from "../chat/useModelFamilies";
import { catalogVision } from "../chat/modelVision";
import { catalogEntryToPriced, type PricedModel } from "../chat/pricingPage";
import { useModelCatalog } from "../chat/useModelCatalog";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ModelIdField } from "./ModelIdField";
import { PriceImport, type ExtractorPick } from "./PriceImport";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Button, IconButton, Input, Select } from "./ui";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

type Draft = { kind: "route"; familyId: string; route: RouteSpec; isNew: boolean };

/**
 * Model routes: what each family can run, on which provider, at what price.
 * Providers themselves live in `ProvidersSettings`; a route only picks one by
 * id, so the page keeps a cross-link for the case where none exists yet.
 */
export type RoutesSettingsProps = {
	families: ModelFamily[];
	relays: RelaySpec[];
	autoFailover: boolean;
	usdCnyRate: number;
	onSaveRate: (rate: number) => Promise<boolean>;
	configError?: string;
	onSaveRoute: (familyId: string, route: RouteSpec) => Promise<boolean>;
	onDeleteRoute: (familyId: string, relayId: string) => Promise<boolean>;
	onReorderRoutes: (familyId: string, relayIds: string[]) => Promise<boolean>;
	onSetDefaultRoute: (familyId: string, relayId: string | null) => Promise<boolean>;
	onAutoFailover: (autoFailover: boolean) => Promise<boolean>;
	onOpenProviders: () => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

export const RoutesSettingsContent = forwardRef<SettingsEditorHandle, RoutesSettingsProps>(function RoutesSettingsContent({ families, relays, autoFailover, usdCnyRate, onSaveRate, configError, onSaveRoute, onDeleteRoute, onReorderRoutes, onSetDefaultRoute, onAutoFailover, onOpenProviders, onLockChange }, ref) {
	const { catalog, catalogStale, catalogFetchedAt, latest } = useModelCatalog();
	// 家族筛选：undefined 表示「全部线路」。
	const [selectedFamily, setSelectedFamily] = useState<string>();
	const { draft, setDraft, pending, setPending, error, setError, removing, setRemoving, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange });

	const openRoute = (familyId: string, route?: RouteSpec, preferredRelayId?: string) => {
		rememberEditorTrigger();
		setError(undefined);
		const fallbackRelay = preferredRelayId ?? relays[0]?.id ?? "";
		setDraft({ kind: "route", familyId, route: route ? { ...route, models: route.models.length ? route.models.map((model) => ({ ...model, vision: model.vision ?? catalogVision(model.modelId, catalog) })) : [blankModel()] } : blankRoute(fallbackRelay), isNew: !route });
	};
	const patchRoute = (value: Partial<RouteSpec>) => {
		setDraft((current) => current && current.kind === "route" ? { ...current, route: { ...current.route, ...value } } : current);
	};
	const patchModel = (index: number, value: Partial<ModelSpec>) => {
		if (!draft || draft.kind !== "route") return;
		patchRoute({ models: draft.route.models.map((model, row) => row === index ? { ...model, ...value } : model) });
	};
	// Toggling one level pins the model to an explicit list starting from what
	// it currently shows, so the first edit does not silently drop the others.
	const toggleModelLevel = (model: ModelSpec, level: ThinkingLevel, enabled: boolean, routeLevels: readonly string[] | undefined): ThinkingLevel[] | undefined => {
		const current = resolveThinkingLevels(model.thinkingLevels, routeLevels);
		return normalizeThinkingLevels(THINKING_LEVELS.filter((item) => item === level ? enabled : current.includes(item)));
	};
	const toggleRouteLevel = (routeLevels: readonly string[] | undefined, level: ThinkingLevel, enabled: boolean): ThinkingLevel[] => {
		const current = routeLevels?.length ? normalizeThinkingLevels(routeLevels) : DEFAULT_THINKING_LEVELS;
		return normalizeThinkingLevels(THINKING_LEVELS.filter((item) => item === level ? enabled : current.includes(item)));
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
		if (!entry) return { ...blank, modelId, vision: catalogVision(modelId, catalog) };
		const priced = catalogEntryToPriced(entry, usdCnyRate);
		const contextWindow = priced.contextWindow ?? blank.contextWindow;
		return {
			...blank,
			modelId: entry.modelId,
			vision: priced.vision,
			inputCost: priced.inputCost,
			outputCost: priced.outputCost,
			currency: "CNY",
			contextWindow,
			maxTokens: priced.maxTokens ? Math.min(priced.maxTokens, contextWindow) : Math.min(blank.maxTokens, contextWindow),
		};
	};
	const addModels = (index: number, ids: string[]) => {
		if (!draft || draft.kind !== "route") return;
		const excluded = relays.find((relay) => relay.id === draft.route.relayId)?.excludedModelIds ?? [];
		const models = [...draft.route.models];
		const existing = new Set(models.map((model) => model.modelId.trim()));
		const additions = ids.filter((id) => !existing.has(id) && !excluded.includes(id)).map(fillFromCatalog);
		// Fill an empty row first so batch discovery leaves no invalid blank row.
		if (!models[index].modelId.trim() && additions.length) models.splice(index, 1, ...additions);
		else models.splice(index + 1, 0, ...additions);
		patchRoute({ models });
	};
	// Pricing-page import refreshes prices on existing ids and appends the rest,
	// dropping the placeholder row once real models land.
	const importPriced = (priced: PricedModel[]) => {
		if (!draft || draft.kind !== "route") return;
		const excluded = relays.find((relay) => relay.id === draft.route.relayId)?.excludedModelIds ?? [];
		const models = [...draft.route.models];
		for (const item of priced) {
			if (excluded.includes(item.modelId)) continue;
			const index = models.findIndex((model) => model.modelId.trim().toLowerCase() === item.modelId.toLowerCase());
			if (index >= 0) {
				const contextWindow = item.contextWindow ?? models[index].contextWindow;
				models[index] = {
					...models[index], inputCost: item.inputCost, outputCost: item.outputCost, currency: item.currency,
					vision: models[index].vision ?? item.vision,
					contextWindow, maxTokens: item.maxTokens ? Math.min(item.maxTokens, contextWindow) : models[index].maxTokens,
				};
			} else {
				const blank = blankModel();
				const contextWindow = item.contextWindow ?? blank.contextWindow;
				models.push({
					...blank, modelId: item.modelId, vision: item.vision, inputCost: item.inputCost, outputCost: item.outputCost, currency: item.currency,
					contextWindow, maxTokens: item.maxTokens ? Math.min(item.maxTokens, contextWindow) : blank.maxTokens,
				});
			}
		}
		if (models.length > 1 && !models[0].modelId.trim()) models.shift();
		patchRoute({ models });
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
			if (await onSaveRoute(draft.familyId, route)) { setSelectedFamily(draft.familyId); setDraft(undefined); }
			else setError("保存失败，请检查填写内容");
		} finally { setPending(false); }
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
					if (!model.modelId.trim() || relay.excludedModelIds?.includes(model.modelId)) continue;
					picks.push({ key: `${relay.id} ${model.modelId}`, relayName: relay.name, baseUrl: relay.baseUrl, apiKey: relay.apiKey, modelId: model.modelId.trim(), inputCost: model.inputCost, outputCost: model.outputCost, currency: model.currency, vision: model.vision ?? route.vision });
				}
			}
		}
		return picks.sort((a, b) => Number(b.vision) - Number(a.vision));
	}, [families, relays]);
	const relayName = (relayId: string) => relays.find((relay) => relay.id === relayId)?.name ?? "未知中转";
	const reorder = (routes: RouteSpec[], index: number, offset: number) => {
		const ids = routes.map((route) => route.id);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return ids;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		return ids;
	};

	return <div ref={contentRef} className={`settings-editor ${draft ? "is-editing" : ""}`}>
		{draft?.kind === "route" ? (
			<form onSubmit={(event) => void submitRoute(event)}>
				<div className="dialog-heading"><h2 id="routes-title">{draft.isNew ? "添加线路" : "编辑线路"} · {FAMILY_LABELS[draft.familyId] ?? draft.familyId}</h2><IconButton type="button"  onClick={closeDraft} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton></div>
				<p className="muted">图片输入按模型单独设置，目录导入会填入已知能力；流式、工具与推理开关按线路生效。</p>
				<div className="provider-field"><label htmlFor="route-relay">所属中转</label><Select id="route-relay" required value={draft.route.relayId} onChange={(event) => patchRoute({ relayId: event.target.value })} disabled={pending || !draft.isNew}>
					<option value="" disabled>选择中转…</option>
					{relays.map((relay) => <option key={relay.id} value={relay.id}>{relay.name}（{maskBaseUrl(relay.baseUrl)}）</option>)}
				</Select><small>地址与密钥来自中转，无需重复填写。</small></div>
				<label className="provider-toggle inline"><input type="checkbox" checked={draft.route.enabled} onChange={(event) => patchRoute({ enabled: event.target.checked })} disabled={pending} />启用此线路（供应商总开关也须启用）</label>
				<div className="provider-models">
					<div className="provider-models-heading"><strong>模型配置</strong><small>单价按每百万令牌填写，顺序与选择器一致</small><PriceImport key={`${draft.familyId}:${draft.route.relayId}`} familyId={draft.familyId} addedIds={draft.route.models.map((model) => model.modelId.trim()).filter(Boolean)} extractors={extractors} catalog={catalog} catalogStale={catalogStale} catalogFetchedAt={catalogFetchedAt} usdCnyRate={usdCnyRate} onSaveRate={onSaveRate} relayBaseUrl={relays.find((relay) => relay.id === draft.route.relayId)?.baseUrl ?? ""} disabled={pending} onImport={importPriced} /></div>
					{draft.route.models.map((model, index) => <div className="provider-model-row" key={index}>
						<div className="provider-model-first">
							<ModelIdField baseUrl={relays.find((relay) => relay.id === draft.route.relayId)?.baseUrl ?? ""} apiKey={relays.find((relay) => relay.id === draft.route.relayId)?.apiKey ?? ""} familyId={draft.familyId} value={model.modelId} onChange={(modelId) => patchModel(index, { modelId, vision: catalogVision(modelId, catalog) })} addedIds={draft.route.models.map((item) => item.modelId.trim())} excludedIds={relays.find((relay) => relay.id === draft.route.relayId)?.excludedModelIds} onAdd={(ids) => addModels(index, ids)} disabled={pending} latest={latest.size ? latest : undefined} />
							<div className="provider-model-actions">
								<IconButton type="button"  disabled={pending || index === 0} onClick={() => moveModel(index, -1)} aria-label={`上移模型 ${index + 1}`} title="上移模型"><Icon name="arrow" size={14} /></IconButton>
								<IconButton type="button" className="flip" disabled={pending || index === draft.route.models.length - 1} onClick={() => moveModel(index, 1)} aria-label={`下移模型 ${index + 1}`} title="下移模型"><Icon name="arrow" size={14} /></IconButton>
								<IconButton type="button"  disabled={pending || draft.route.models.length <= 1} onClick={() => patchRoute({ models: draft.route.models.filter((_, row) => row !== index) })} aria-label={`删除模型 ${index + 1}`} title="删除模型，至少保留一行"><Icon name="trash" size={14} /></IconButton>
							</div>
						</div>
						<label className="provider-model-alias">模型别名<Input maxLength={64} placeholder="可选，仅改变显示名称" value={model.alias} onChange={(event) => patchModel(index, { alias: event.target.value })} disabled={pending} /></label>
						{relays.find((relay) => relay.id === draft.route.relayId)?.excludedModelIds?.includes(model.modelId) && <small className="muted">此模型已在供应商中剔除，不会出现在模型选择列表。可在供应商页面恢复。</small>}
						<div className="provider-model-limits">
							<label>输入单价<Input type="number" required min={0} step="0.000001" value={model.inputCost} onChange={(event) => patchModel(index, { inputCost: Number(event.target.value) })} disabled={pending} /></label>
							<label>输出单价<Input type="number" required min={0} step="0.000001" value={model.outputCost} onChange={(event) => patchModel(index, { outputCost: Number(event.target.value) })} disabled={pending} /></label>
							<label>币种<Select value={model.currency} onChange={(event) => patchModel(index, { currency: event.target.value === "USD" ? "USD" : "CNY" })} disabled={pending}><option value="CNY">人民币</option><option value="USD">美元</option></Select></label>
							<label>默认最大输出<Input type="number" required min={1} step={1} max={model.contextWindow} value={model.maxTokens} onChange={(event) => patchModel(index, { maxTokens: Number(event.target.value) })} disabled={pending} /></label>
							<label>上下文窗口<Input type="number" required min={1} step={1} value={model.contextWindow} onChange={(event) => patchModel(index, { contextWindow: Number(event.target.value) })} disabled={pending} /></label>
							<label>图片输入<Select aria-label={`模型 ${index + 1} 图片输入`} value={model.vision === undefined ? "default" : String(model.vision)} onChange={(event) => patchModel(index, { vision: event.target.value === "default" ? undefined : event.target.value === "true" })} disabled={pending}><option value="default">跟随线路默认</option><option value="true">支持图片</option><option value="false">仅文本</option></Select></label>
						</div>
						<div className="provider-model-cache">
							<label>缓存读取单价<Input type="number" required min={0} step="0.000001" value={model.cacheReadCost} onChange={(event) => patchModel(index, { cacheReadCost: Number(event.target.value) })} disabled={pending} /></label>
							<label>缓存写入单价<Input type="number" required min={0} step="0.000001" value={model.cacheWriteCost} onChange={(event) => patchModel(index, { cacheWriteCost: Number(event.target.value) })} disabled={pending} /></label>
						</div>
						<div className="provider-model-levels"><span>推理等级</span>
							{THINKING_LEVELS.map((level) => <label key={level} className="provider-level-option" title={model.thinkingLevels?.length ? "该模型单独设置" : "跟随线路默认"}><input type="checkbox" aria-label={`模型 ${index + 1} 支持 ${level}`} checked={resolveThinkingLevels(model.thinkingLevels, draft.route.thinkingLevels).includes(level)} onChange={(event) => patchModel(index, { thinkingLevels: toggleModelLevel(model, level, event.target.checked, draft.route.thinkingLevels) })} disabled={pending || !draft.route.reasoning} />{level}</label>)}
							{model.thinkingLevels?.length ? <Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => patchModel(index, { thinkingLevels: undefined })}>恢复线路默认</Button> : <small className="muted">跟随线路</small>}
						</div>
					</div>)}
					<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => patchRoute({ models: [...draft.route.models, blankModel()] })}>添加模型</Button>
				</div>
				<div className="provider-capabilities"><label><input type="checkbox" checked={draft.route.streaming} onChange={(event) => patchRoute({ streaming: event.target.checked })} disabled={pending} />流式输出</label><label><input type="checkbox" checked={draft.route.tools} onChange={(event) => patchRoute({ tools: event.target.checked })} disabled={pending} />工具调用</label><label><input type="checkbox" checked={draft.route.vision} onChange={(event) => patchRoute({ vision: event.target.checked })} disabled={pending} />默认支持图片</label><label><input type="checkbox" checked={draft.route.reasoning} onChange={(event) => patchRoute({ reasoning: event.target.checked })} disabled={pending} />推理输出</label></div>
				<div className="provider-model-levels route-levels"><span>线路默认推理等级</span>
					{THINKING_LEVELS.map((level) => <label key={level} className="provider-level-option"><input type="checkbox" aria-label={`线路默认支持 ${level}`} checked={resolveThinkingLevels(draft.route.thinkingLevels, DEFAULT_THINKING_LEVELS).includes(level)} onChange={(event) => patchRoute({ thinkingLevels: toggleRouteLevel(draft.route.thinkingLevels, level, event.target.checked) })} disabled={pending || !draft.route.reasoning} />{level}</label>)}
					<small className="muted">按模型单独勾选可覆盖；全部留空时与 pi 默认一致。</small>
				</div>
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><Button type="button" variant="ghost" onClick={closeDraft} disabled={pending}>返回</Button><Button type="submit" variant="primary" size="primary" disabled={pending}>{pending ? "保存中…" : "保存"}</Button></div>
			</form>
		) : (
			<>
				<h2 id="routes-title">模型线路</h2>
				<p className="muted">线路把一个供应商接到一个模型家族上，模型、单价与能力按线路保存；共 {`${total}`} 条线路。</p>
				{relays.length === 0 ? (
					<section className="family-card">
						<div className="family-card-head">
							<span className="family-card-title">还没有供应商</span>
							<Button type="button" variant="ghost" size="compact" onClick={onOpenProviders}>去添加供应商</Button>
						</div>
						<p className="family-empty">线路依附于供应商：先到「供应商」添加地址与密钥，再回来为各家族配置线路。</p>
					</section>
				) : (
					<div className="family-layout">
					<nav className="family-nav" aria-label="按家族筛选线路">
						<button type="button" className={`family-nav-item ${selectedFamily ? "" : "active"}`} aria-pressed={!selectedFamily} onClick={() => setSelectedFamily(undefined)}>
							<span className="family-nav-label">全部线路</span>
							<small>{total}</small>
						</button>
						{families.map((family) => <button type="button" key={family.id} className={`family-nav-item ${selectedFamily === family.id ? "active" : ""}`} aria-pressed={selectedFamily === family.id} onClick={() => setSelectedFamily(family.id)}>
							{brand(family.id) && <BrandIcon name={brand(family.id)!} size={14} />}
							<span className="family-nav-label">{FAMILY_LABELS[family.id] ?? family.displayName}</span>
							<small>{family.routes.length}</small>
						</button>)}
					</nav>
					<div className="family-panel">
					{(selectedFamily ? families.filter((family) => family.id === selectedFamily) : families).map((family) => <section className="family-card" key={family.id}>
						<div className="family-card-head">
							<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}<small>{family.routes.length} 条线路</small></span>
							<Button type="button" variant="ghost" size="compact" onClick={() => openRoute(family.id)} disabled={pending || !relays.length} title={relays.length ? undefined : "请先添加供应商"}>添加线路</Button>
						</div>
						{family.routes.length === 0 && <p className="family-empty">还没添加线路，去添加</p>}
					{family.routes.map((route, index) => <div className={`provider-row ${route.enabled ? "" : "disabled"}`} key={route.id || route.relayId}>
							<label className="switch" title={route.enabled && family.defaultRouteId === route.id ? "默认线路不可停用，请先选择替代线路或清空默认值" : route.enabled ? "停用线路" : "启用线路"}>
								<input type="checkbox" checked={route.enabled} disabled={pending || (route.enabled && family.defaultRouteId === route.id)} onChange={(event) => void mutate(() => onSaveRoute(family.id, { ...route, enabled: event.target.checked }))} aria-label={`${route.enabled ? "停用" : "启用"} ${relayName(route.relayId)} 的线路`} />
								<span className="slider" />
							</label>
							<div className="provider-row-main">
							<div className="provider-row-title"><strong>{relayName(route.relayId)}</strong>{family.defaultRouteId === route.id && <span className="provider-tag">默认</span>}{!route.enabled && <span className="provider-tag muted-tag">线路已停用</span>}</div>
								<small>{route.models.length ? `${route.models.length} 个模型：${route.models.map((model) => model.modelId).join("、")}` : "未配置完整，请添加模型"}</small>
							</div>
							<div className="provider-row-actions">
								<IconButton type="button"  disabled={pending || index === 0} onClick={() => void mutate(() => onReorderRoutes(family.id, reorder(family.routes, index, -1)))} aria-label={`上移 ${relayName(route.relayId)} 的线路`}><Icon name="arrow" size={14} /></IconButton>
								<IconButton type="button" className="flip" disabled={pending || index === family.routes.length - 1} onClick={() => void mutate(() => onReorderRoutes(family.id, reorder(family.routes, index, 1)))} aria-label={`下移 ${relayName(route.relayId)} 的线路`}><Icon name="arrow" size={14} /></IconButton>
								<IconButton type="button"  disabled={pending || family.defaultRouteId === route.id || !route.models.length || !route.enabled || !relays.find((relay) => relay.id === route.relayId)?.enabled} onClick={() => void mutate(() => onSetDefaultRoute(family.id, route.id))} title="设为默认线路" aria-label={`将 ${relayName(route.relayId)} 的线路设为默认`}><Icon name="check" size={14} /></IconButton>
								<IconButton type="button"  onClick={() => openRoute(family.id, route)} disabled={pending} aria-label={`编辑 ${relayName(route.relayId)} 的线路`}><Icon name="edit" size={14} /></IconButton>
								<IconButton type="button"  onClick={() => setRemoving({ title: "删除线路", description: `将从「${FAMILY_LABELS[family.id] ?? family.displayName}」移除 ${relayName(route.relayId)} 的线路。`, action: () => onDeleteRoute(family.id, route.id) })} disabled={pending} title="删除" aria-label={`删除 ${relayName(route.relayId)} 的线路`}><Icon name="trash" size={14} /></IconButton>
							</div>
						</div>)}
						{family.defaultRouteId && <Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => setRemoving({ title: "清空默认线路", description: `明确清空 ${FAMILY_LABELS[family.id] ?? family.displayName} 的默认线路后，可停用或删除原默认线路。已有会话仍使用钉住的线路。`, action: () => onSetDefaultRoute(family.id, null) })}>清空 {FAMILY_LABELS[family.id] ?? family.displayName} 默认线路</Button>}
					</section>)}
					<div className="family-footer"><label className="provider-toggle inline"><input type="checkbox" checked={autoFailover} disabled={pending} onChange={(event) => void mutate(() => onAutoFailover(event.target.checked))} />失败时自动切换到同家族下一条提供相同模型的启用线路（默认关闭）</label></div>
					</div>
					</div>
				)}
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
			</>
		)}
		{removing && <ConfirmDialog title={removing.title} description={removing.description} onConfirm={() => void mutate(removing.action)} onClose={() => setRemoving(undefined)} />}
	</div>;
});