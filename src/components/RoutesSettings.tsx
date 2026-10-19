import { forwardRef, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { latestSettingsTest, settingsTestSummary } from "../chat/settingsManagement";
import { useSettingsMetadata } from "../chat/useSettingsMetadata";
import { blankModel, blankRoute, DEFAULT_THINKING_LEVELS, FAMILY_LABELS, maskBaseUrl, normalizeThinkingLevels, resolveThinkingLevels, THINKING_LEVELS, validateModels, type ModelFamily, type ModelSpec, type RelaySpec, type RouteSpec, type ThinkingLevel } from "../chat/useModelFamilies";
import { catalogVision } from "../chat/modelVision";
import { catalogEntryToPriced, type PricedModel } from "../chat/pricingPage";
import { modelIdMatchesCatalog } from "../chat/latestModels";
import { useModelCatalog } from "../chat/useModelCatalog";
import { useFamilyModels } from "../chat/useFamilyModels";
import { routeBlockedReason, routeMatchesQuery } from "../chat/settingsModels";
import type { SettingsLocation } from "./settingsNavigation";
import { SettingsRouteRow } from "./SettingsRouteRow";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ModelIdField } from "./ModelIdField";
import { PriceImport, type ExtractorPick } from "./PriceImport";
import { useSettingsListFocus, useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Button, IconButton, Input, Select } from "./ui";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

type Draft = { kind: "route"; familyId: string; route: RouteSpec; isNew: boolean } | { kind: "order"; familyId: string; ids: string[] };

/**
 * Routes: how each family reaches its providers. One row is a relay bound to
 * a family with its served models, prices and capabilities; providers
 * themselves live in `ProvidersSettings`, so the page keeps a cross-link for
 * the case where none exists yet.
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
	onOpenModels: () => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
	focusFamily?: string;
	focusLocation?: SettingsLocation;
};

export const RoutesSettingsContent = forwardRef<SettingsEditorHandle, RoutesSettingsProps>(function RoutesSettingsContent({ families, relays, autoFailover, usdCnyRate, onSaveRate, configError, onSaveRoute, onDeleteRoute, onReorderRoutes, onSetDefaultRoute, onAutoFailover, onOpenProviders, onLockChange, focusFamily, focusLocation }, ref) {
	const metadata = useSettingsMetadata(relays);
	const dragId = useRef<string>();
	const [orderNotice, setOrderNotice] = useState("");
	const { catalog, catalogStale, catalogFetchedAt, latest } = useModelCatalog();
	const { config: visibleModels } = useFamilyModels();
	const [query, setQuery] = useState("");
	const [onlyAvailable, setOnlyAvailable] = useState(false);
	const filtered = !!query.trim() || onlyAvailable;
	const shownRoutes = (family: ModelFamily) => family.routes.filter((route) => routeMatchesQuery(route, relays.find((relay) => relay.id === route.relayId), query) && (!onlyAvailable || !routeBlockedReason(route, relays.find((relay) => relay.id === route.relayId))));
	// 家族筛选：undefined 表示「全部路线」。
	const [selectedFamily, setSelectedFamily] = useState<string>();
	useEffect(() => { if (focusFamily) setSelectedFamily(focusFamily); }, [focusFamily]);
	const { draft, setDraft, pending, setPending, error, setError, removing, setRemoving, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange });
	useSettingsListFocus(contentRef, !!draft);

	const openRoute = (familyId: string, route?: RouteSpec, preferredRelayId?: string) => {
		rememberEditorTrigger();
		setError(undefined);
		const fallbackRelay = preferredRelayId ?? relays[0]?.id ?? "";
		setDraft({ kind: "route", familyId, route: route ? { ...route, models: route.models.length ? route.models.map((model) => ({ ...model, vision: model.vision ?? catalogVision(model.modelId, catalog) })) : [blankModel()] } : blankRoute(fallbackRelay), isNew: !route });
	};
	useEffect(() => {
		if (!focusLocation?.familyId) return;
		const family = families.find((item) => item.id === focusLocation.familyId);
		const route = family?.routes.find((item) => (!focusLocation.routeId || item.id === focusLocation.routeId) && (!focusLocation.relayId || item.relayId === focusLocation.relayId));
		setSelectedFamily(focusLocation.familyId);
		if (family && route && (focusLocation.routeId || focusLocation.relayId)) {
			Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-route-id]") ?? []).find((element) => element.dataset.routeId === route.id)?.querySelector<HTMLButtonElement>(".provider-row-actions button")?.focus();
			openRoute(family.id, route);
		}
	}, [focusLocation]);
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
		const entry = catalog.find((item) => modelIdMatchesCatalog(modelId, item));
		const blank = blankModel();
		if (!entry) return { ...blank, modelId, vision: catalogVision(modelId, catalog) };
		const priced = catalogEntryToPriced(entry, usdCnyRate);
		const contextWindow = priced.contextWindow ?? blank.contextWindow;
		return {
			...blank,
			// Keep the exact ID returned by this relay; the catalog only supplies metadata.
			modelId,
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
		if (!route.relayId) { setError("请选择该路线所属的中转"); return; }
		const modelError = validateModels(route.models);
		if (modelError) { setError(modelError); return; }
		setPending(true); setError(undefined);
		try {
			if (await onSaveRoute(draft.familyId, route)) { setSelectedFamily(draft.familyId); setDraft(undefined); }
			else setError("保存失败，请检查填写内容");
		} finally { setPending(false); }
	};

	const total = useMemo(() => families.reduce((sum, family) => sum + family.routes.length, 0), [families]);
	// 已配置的模型都可用于截图识别；视觉路线优先，选择器默认落在真能看图的那个。
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

	const startOrder = (family: ModelFamily, index?: number, offset = 0) => {
		rememberEditorTrigger(); setError(undefined); setOrderNotice("");
		setDraft({ kind: "order", familyId: family.id, ids: index === undefined ? family.routes.map((route) => route.id) : reorder(family.routes, index, offset) });
	};
	const moveOrder = (id: string, target: number) => {
		if (draft?.kind !== "order" || pending || target < 0 || target >= draft.ids.length) return;
		const ids = [...draft.ids]; const index = ids.indexOf(id); if (index < 0) return;
		ids.splice(index, 1); ids.splice(target, 0, id);
		setDraft({ ...draft, ids }); setOrderNotice(`已移到第 ${target + 1} 位，尚未保存`);
		requestAnimationFrame(() => {
			const row = Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[data-order-id]") ?? []).find((row) => row.dataset.orderId === id);
			if (row && (!row.contains(document.activeElement) || document.activeElement?.matches(":disabled"))) row.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
		});
	};
	const orderingFamily = draft?.kind === "order" ? families.find((family) => family.id === draft.familyId) : undefined;
	const orderConflict = draft?.kind === "order" && (!orderingFamily || orderingFamily.routes.length !== draft.ids.length || orderingFamily.routes.some((route) => !draft.ids.includes(route.id)));
	return <div ref={contentRef} className={`settings-editor ${draft ? "is-editing" : ""}`}>
		{draft?.kind === "order" ? (
			<section aria-label="调整切换顺序">
				<h2 id="routes-title">调整切换顺序 · {FAMILY_LABELS[draft.familyId] ?? draft.familyId}</h2>
				<p className="muted">显示家族全部路线，暂不应用搜索或可用筛选。保存后影响相同实际模型 ID 的向后故障切换；仍遵守能力要求及扣费账户授权。</p>
				<p className="muted">拖动或使用上移、下移按钮调整；默认路线、模型顺序及已有会话的固定路线保持原值。</p>
				<ol className="settings-order-list">{draft.ids.map((id, index) => {
					const route = orderingFamily?.routes.find((route) => route.id === id);
					const relay = relays.find((relay) => relay.id === route?.relayId);
					const name = relay?.name ?? id;
					return <li key={id} data-order-id={id} draggable={!pending && !orderConflict} onDragStart={(event) => { dragId.current = id; event.dataTransfer.setData("text/plain", id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { dragId.current = undefined; }} onDragOver={(event) => { if (!pending && !orderConflict) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); if (dragId.current && !orderConflict) moveOrder(dragId.current, index); dragId.current = undefined; }}>
						<span className="provider-row-main"><strong>{index + 1}. {name}</strong><small>{route ? routeBlockedReason(route, relay) ?? "可用" : "路线已移除"}{orderingFamily?.defaultRouteId === id ? " · 家族默认" : ""}</small><small>{route?.models.map((model) => model.modelId).join("、") || "未配置模型"}</small></span>
						<div className="provider-row-actions"><Button size="compact" variant="ghost" disabled={pending || orderConflict || index === 0} aria-label={`上移 ${name}`} onClick={() => moveOrder(id, index - 1)}>上移</Button><Button size="compact" variant="ghost" disabled={pending || orderConflict || index === draft.ids.length - 1} aria-label={`下移 ${name}`} onClick={() => moveOrder(id, index + 1)}>下移</Button></div>
					</li>;
				})}</ol>
				<p role="status" className="muted">{orderNotice}</p>
				{orderConflict && <p className="form-error" role="alert">路线集合已变化，旧顺序不能保存，请重新加载后调整。</p>}
				{(error || configError) && <p className="form-error" role="alert">{error || configError}</p>}
				<div className="dialog-actions"><Button disabled={pending} onClick={closeDraft}>取消排序</Button>{orderConflict && orderingFamily && <Button disabled={pending} onClick={() => startOrder(orderingFamily)}>重新加载顺序</Button>}<Button variant="primary" disabled={pending || orderConflict} onClick={() => void mutate(async () => { const ok = await onReorderRoutes(draft.familyId, draft.ids); if (ok) closeDraft(); return ok; })}>{pending ? "保存中…" : "保存顺序"}</Button></div>
			</section>
		) : draft?.kind === "route" ? (
			<form onSubmit={(event) => void submitRoute(event)}>
				<div className="dialog-heading"><h2 id="routes-title">{draft.isNew ? "添加路线" : "编辑路线"} · {FAMILY_LABELS[draft.familyId] ?? draft.familyId}</h2><IconButton type="button"  onClick={closeDraft} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton></div>
				<p className="muted">图片输入按模型单独设置，目录导入会填入已知能力；流式、工具与推理开关按路线生效。</p>
				<div className="provider-field"><label htmlFor="route-relay">所属中转</label><Select id="route-relay" required value={draft.route.relayId} onChange={(event) => patchRoute({ relayId: event.target.value })} disabled={pending || !draft.isNew}>
					<option value="" disabled>选择中转…</option>
					{relays.map((relay) => <option key={relay.id} value={relay.id}>{relay.name}（{maskBaseUrl(relay.baseUrl)}）</option>)}
				</Select><small>地址与密钥来自中转，无需重复填写。</small></div>
				<label className="provider-toggle inline"><input type="checkbox" checked={draft.route.enabled} onChange={(event) => patchRoute({ enabled: event.target.checked })} disabled={pending} />启用此路线（供应商总开关也须启用）</label>
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
							<label>图片输入<Select aria-label={`模型 ${index + 1} 图片输入`} value={model.vision === undefined ? "default" : String(model.vision)} onChange={(event) => patchModel(index, { vision: event.target.value === "default" ? undefined : event.target.value === "true" })} disabled={pending}><option value="default">跟随路线默认</option><option value="true">支持图片</option><option value="false">仅文本</option></Select></label>
						</div>
						<div className="provider-model-cache">
							<label>缓存读取单价<Input type="number" required min={0} step="0.000001" value={model.cacheReadCost} onChange={(event) => patchModel(index, { cacheReadCost: Number(event.target.value) })} disabled={pending} /></label>
							<label>缓存写入单价<Input type="number" required min={0} step="0.000001" value={model.cacheWriteCost} onChange={(event) => patchModel(index, { cacheWriteCost: Number(event.target.value) })} disabled={pending} /></label>
						</div>
						<div className="provider-model-levels"><span>推理等级</span>
							{THINKING_LEVELS.map((level) => <label key={level} className="provider-level-option" title={model.thinkingLevels?.length ? "该模型单独设置" : "跟随路线默认"}><input type="checkbox" aria-label={`模型 ${index + 1} 支持 ${level}`} checked={resolveThinkingLevels(model.thinkingLevels, draft.route.thinkingLevels).includes(level)} onChange={(event) => patchModel(index, { thinkingLevels: toggleModelLevel(model, level, event.target.checked, draft.route.thinkingLevels) })} disabled={pending || !draft.route.reasoning} />{level}</label>)}
							{model.thinkingLevels?.length ? <Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => patchModel(index, { thinkingLevels: undefined })}>恢复路线默认</Button> : <small className="muted">跟随路线</small>}
						</div>
					</div>)}
					<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => patchRoute({ models: [...draft.route.models, blankModel()] })}>添加模型</Button>
				</div>
				<div className="provider-capabilities"><label><input type="checkbox" checked={draft.route.streaming} onChange={(event) => patchRoute({ streaming: event.target.checked })} disabled={pending} />流式输出</label><label><input type="checkbox" checked={draft.route.tools} onChange={(event) => patchRoute({ tools: event.target.checked })} disabled={pending} />工具调用</label><label><input type="checkbox" checked={draft.route.vision} onChange={(event) => patchRoute({ vision: event.target.checked })} disabled={pending} />默认支持图片</label><label><input type="checkbox" checked={draft.route.reasoning} onChange={(event) => patchRoute({ reasoning: event.target.checked })} disabled={pending} />推理输出</label></div>
				<div className="provider-model-levels route-levels"><span>路线默认推理等级</span>
					{THINKING_LEVELS.map((level) => <label key={level} className="provider-level-option"><input type="checkbox" aria-label={`路线默认支持 ${level}`} checked={resolveThinkingLevels(draft.route.thinkingLevels, DEFAULT_THINKING_LEVELS).includes(level)} onChange={(event) => patchRoute({ thinkingLevels: toggleRouteLevel(draft.route.thinkingLevels, level, event.target.checked) })} disabled={pending || !draft.route.reasoning} />{level}</label>)}
					<small className="muted">按模型单独勾选可覆盖；全部留空时与 pi 默认一致。</small>
				</div>
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><Button type="button" variant="ghost" onClick={closeDraft} disabled={pending}>返回</Button><Button type="submit" variant="primary" size="primary" disabled={pending}>{pending ? "保存中…" : "保存"}</Button></div>
			</form>
		) : (
			<>
				<h2 id="routes-title">路线</h2>
				<p className="muted">路线把供应商接到模型家族，价格与能力按模型配置；共 {total} 条路线。</p>
				<div className="settings-toolbar" role="group" aria-label="路线筛选">
					<Input aria-label="搜索路线" placeholder="搜索供应商、模型 ID 或显示名…" value={query} onChange={(event) => setQuery(event.target.value)} />
					<label className="provider-toggle inline"><input type="checkbox" checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} />仅看可用</label>
				</div>
				{relays.length === 0 ? (
					<section className="family-card">
						<div className="family-card-head">
							<span className="family-card-title">还没有供应商</span>
							<Button type="button" variant="ghost" size="compact" onClick={onOpenProviders}>去添加供应商</Button>
						</div>
						<p className="family-empty">路线依附于供应商：先到「供应商」添加地址与密钥，再回来为各家族配置路线。</p>
					</section>
				) : (
					<div className="family-layout">
					<nav className="family-nav" aria-label="按家族筛选路线">
						<button type="button" className={`family-nav-item ${selectedFamily ? "" : "active"}`} aria-pressed={!selectedFamily} onClick={() => setSelectedFamily(undefined)}>
							<span className="family-nav-label">全部路线</span>
							<small>{families.reduce((sum, family) => sum + shownRoutes(family).length, 0)} / {total}</small>
						</button>
						{families.map((family) => <button type="button" key={family.id} className={`family-nav-item ${selectedFamily === family.id ? "active" : ""}`} aria-pressed={selectedFamily === family.id} onClick={() => setSelectedFamily(family.id)}>
							{brand(family.id) && <BrandIcon name={brand(family.id)!} size={14} />}
							<span className="family-nav-label">{FAMILY_LABELS[family.id] ?? family.displayName}</span>
							<small>{shownRoutes(family).length} / {family.routes.length}</small>
						</button>)}
					</nav>
					<div className="family-panel">
					{(selectedFamily ? families.filter((family) => family.id === selectedFamily) : families).map((family) => <section className="family-card" key={family.id}>
						<div className="family-card-head">
							<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}<small>显示 {shownRoutes(family).length} / 共 {family.routes.length} 条</small></span>
							<Button type="button" variant="ghost" size="compact" disabled={pending || family.routes.length < 2} onClick={() => startOrder(family)}>调整切换顺序</Button>
							<Button type="button" variant="ghost" size="compact" onClick={() => openRoute(family.id)} disabled={pending || !relays.length} title={relays.length ? undefined : "请先添加供应商"}>添加路线</Button>
						</div>
						{family.routes.length === 0 && <p className="family-empty">还没添加路线，去添加</p>}
						{family.routes.length > 0 && shownRoutes(family).length === 0 && <p className="family-empty">没有匹配的路线，请清除筛选。</p>}
						{shownRoutes(family).map((route) => {
							const index = family.routes.indexOf(route);
							const relay = relays.find((item) => item.id === route.relayId);
							const name = relayName(route.relayId);
							const isDefault = family.defaultRouteId === route.id;
							return <SettingsRouteRow key={route.id} family={family} route={route} relay={relay} catalog={catalog} visibleIds={(visibleModels[family.id] ?? []).map((entry) => entry.modelId)} pending={pending} testHistory={settingsTestSummary(latestSettingsTest(metadata.tests, route.relayId, route.models.map((model) => model.modelId)))}
								onToggle={(enabled) => void mutate(async () => { const ok = await onSaveRoute(family.id, { ...route, enabled }); if (ok && onlyAvailable) requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>(".settings-toolbar input")?.focus()); return ok; })}
								actions={[
									{ label: "编辑", accessible: `编辑 ${name} 的路线`, run: () => openRoute(family.id, route) },
									{ label: "设为默认", accessible: `将 ${name} 的路线设为默认`, reason: isDefault ? "已是家族默认路线" : routeBlockedReason(route, relay), run: () => void mutate(() => onSetDefaultRoute(family.id, route.id)) },
									{ label: "上移", accessible: `上移 ${name} 的路线`, reason: filtered ? "请清除搜索并关闭仅看可用后排序" : index === 0 ? "已经是第一条路线" : undefined, run: () => startOrder(family, index, -1) },
									{ label: "下移", accessible: `下移 ${name} 的路线`, reason: filtered ? "请清除搜索并关闭仅看可用后排序" : index === family.routes.length - 1 ? "已经是最后一条路线" : undefined, run: () => startOrder(family, index, 1) },
									{ label: "删除", accessible: `删除 ${name} 的路线`, reason: isDefault ? "默认路线不可删除，请先选择替代路线或显式清空默认值" : undefined, run: () => setRemoving({ title: "删除路线", description: `将从「${FAMILY_LABELS[family.id] ?? family.displayName}」移除 ${name} 的路线。`, action: async () => { const ok = await onDeleteRoute(family.id, route.id); if (ok) requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>(".settings-toolbar input")?.focus()); return ok; } }) },
								]} />;
						})}
						{family.defaultRouteId && <Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => setRemoving({ title: "清空默认路线", description: `明确清空 ${FAMILY_LABELS[family.id] ?? family.displayName} 的默认路线后，可停用或删除原默认路线。已有会话仍使用钉住的路线。`, action: () => onSetDefaultRoute(family.id, null) })}>清空 {FAMILY_LABELS[family.id] ?? family.displayName} 默认路线</Button>}
					</section>)}
					<div className="family-footer"><label className="provider-toggle inline"><input type="checkbox" checked={autoFailover} disabled={pending} onChange={(event) => void mutate(() => onAutoFailover(event.target.checked))} />失败时自动切换到同家族下一条提供相同模型的启用路线（默认关闭）</label></div>
					</div>
					</div>
				)}
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
			</>
		)}
		{removing && <ConfirmDialog title={removing.title} description={removing.description} onConfirm={() => void mutate(removing.action)} onClose={() => setRemoving(undefined)} />}
	</div>;
});
