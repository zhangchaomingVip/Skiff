import { forwardRef, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FAMILY_LABELS, type ModelFamily, type RelaySpec, type TestResult } from "../chat/useModelFamilies";
import { catalogModelIdsMatch, sameModelId } from "../chat/latestModels";
import { useFamilyModels } from "../chat/useFamilyModels";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { Icon } from "./Icon";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Button, IconButton, Input } from "./ui";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const EDITABLE = [...BRANDABLE] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

type Draft = { kind: "family-models" };

type CatalogIdentity = { modelId: string; name?: string | null };

type ModelRouteMapping = {
	relayName: string;
	modelIds: string[];
	excludedModelIds: string[];
	active: boolean;
};

type ModelMappingGroup = {
	modelId: string;
	mappings: ModelRouteMapping[];
};

/** One model's live test, keyed by family plus model ID. */
type ModelTest = { state: "running" | "done"; relayName: string; result?: TestResult };

const testKeyOf = (familyId: string, modelId: string) => `${familyId}\u0000${modelId}`;

const testTextOf = (test: ModelTest) => test.state === "running"
	? `正在通过 ${test.relayName} 测试…`
	: test.result?.ok
		? `${test.relayName} · 成功 · ${test.result.latencyMs} ms`
		: `${test.relayName} · 失败${test.result?.status ? ` · HTTP ${test.result.status}` : ""}${test.result?.error ? ` · ${test.result.error}` : ""}`;

/** Routes that can actually serve a model: enabled route on an enabled relay, not excluded. */
const availableRoutes = (family: ModelFamily, relays: RelaySpec[], modelId: string, catalog: readonly { modelId: string; name?: string | null }[]) =>
	family.routes.filter((route) => {
		const relay = relays.find((item) => item.id === route.relayId);
		if (!route.enabled || !relay?.enabled) return false;
		return route.models.some((model) => (sameModelId(model.modelId, modelId) || catalogModelIdsMatch(model.modelId, modelId, catalog)) && !relay.excludedModelIds?.includes(model.modelId));
	}).length;

/** Enabled routes of the family, regardless of which models they carry. */
const familyRoutesAvailable = (family: ModelFamily, relays: RelaySpec[]) =>
	family.routes.filter((route) => route.enabled && relays.find((item) => item.id === route.relayId)?.enabled).length;

const matchesModel = (modelId: string, targetId: string, catalog: readonly CatalogIdentity[]) =>
	sameModelId(modelId, targetId) || catalogModelIdsMatch(modelId, targetId, catalog);

const aliasFor = (family: ModelFamily, modelId: string, catalog: readonly CatalogIdentity[]) =>
	family.routes.flatMap((route) => route.models).find((model) => matchesModel(model.modelId, modelId, catalog) && model.alias.trim())?.alias;

/**
 * The route a single-model test runs on: the family default when it serves
 * this model, otherwise the first enabled route on an enabled relay that does.
 * Mirrors how a chat picks its line, so the result describes real usage.
 */
const routeForModelTest = (family: ModelFamily, relays: RelaySpec[], modelId: string, catalog: readonly CatalogIdentity[]) => {
	const serving = family.routes.filter((route) => {
		const relay = relays.find((item) => item.id === route.relayId);
		return route.enabled && relay?.enabled && relay.baseUrl.trim() && route.models.some((model) => matchesModel(model.modelId, modelId, catalog) && !relay.excludedModelIds?.includes(model.modelId));
	});
	const route = serving.find((item) => item.id === family.defaultRouteId) ?? serving[0];
	const relay = route ? relays.find((item) => item.id === route.relayId) : undefined;
	return route && relay ? { route, relay } : undefined;
};

const routeMappingsFor = (family: ModelFamily, relays: RelaySpec[], modelId: string, catalog: readonly CatalogIdentity[]): ModelRouteMapping[] =>
	family.routes.flatMap((route) => {
		const relay = relays.find((item) => item.id === route.relayId);
		const matched = route.models.filter((model) => matchesModel(model.modelId, modelId, catalog));
		if (!matched.length) return [];
		const modelIds = [...new Set(matched.map((model) => model.modelId.trim()).filter(Boolean))];
		const excludedModelIds = modelIds.filter((id) => relay?.excludedModelIds?.includes(id));
		return [{ relayName: relay?.name ?? route.relayId, modelIds, excludedModelIds, active: !!relay?.enabled && route.enabled }];
	});

const routeMappingsForAuto = (family: ModelFamily, relays: RelaySpec[]): ModelRouteMapping[] => family.routes.flatMap((route) => {
	const relay = relays.find((item) => item.id === route.relayId);
	const modelIds = [...new Set(route.models.map((model) => model.modelId.trim()).filter(Boolean))];
	if (!modelIds.length) return [];
	const excludedModelIds = modelIds.filter((id) => relay?.excludedModelIds?.includes(id));
	return [{ relayName: relay?.name ?? route.relayId, modelIds, excludedModelIds, active: !!relay?.enabled && route.enabled }];
});

const modelMappingPanel = (groups: ModelMappingGroup[]) => {
	const providerNames = [...new Set(groups.flatMap((group) => group.mappings.map((mapping) => mapping.relayName)))];
	return <div className="model-mapping-panel" role="status" aria-label="实际线路映射">
		{providerNames.length ? <>
			<p className="model-mapping-legend"><span><i className="model-route-status is-active" aria-hidden="true" />绿灯：启用</span><span><i className="model-route-status is-disabled" aria-hidden="true" />红灯：停用</span></p>
			<p className="model-mapping-help">同一单元格出现多个 ID，表示该提供商配置了多个实际调用 ID；开始聊天时使用你选中的具体模型和路线，不会在这些 ID 之间随机切换。未指定路线时按默认路线顺序选择。</p>
			<div className="model-mapping-table-wrap"><table className="model-mapping-table"><thead><tr><th scope="col">提供商</th>{groups.map((group) => <th scope="col" key={group.modelId}>{group.modelId}</th>)}</tr></thead><tbody>{providerNames.map((providerName) => <tr key={providerName}><th scope="row">{providerName}{groups.some((group) => group.mappings.some((mapping) => mapping.relayName === providerName && !mapping.active)) && <em>（含停用）</em>}</th>{groups.map((group) => {
			const mappings = group.mappings.filter((mapping) => mapping.relayName === providerName);
			const modelIds = mappings.flatMap((mapping) => mapping.modelIds.map((id) => ({ id, active: mapping.active && !mapping.excludedModelIds.includes(id) })));
			const uniqueIds = [...new Map(modelIds.map((item) => [`${item.id}:${item.active}`, item])).values()];
			return <td key={`${providerName}:${group.modelId}`}>{uniqueIds.length ? <span className="model-mapping-ids">{uniqueIds.map(({ id, active }) => <span className="model-mapping-id" key={`${id}:${active}`}><i className={`model-route-status ${active ? "is-active" : "is-disabled"}`} title={active ? "路线启用" : "路线停用"} aria-label={active ? "路线启用" : "路线停用"} /><code className={!active ? "is-excluded" : undefined}>{id}</code></span>)}</span> : <span className="model-mapping-missing">未检出</span>}</td>;
		})}</tr>)}</tbody></table></div>
		</> : <span className="muted">暂无匹配的路线模型</span>}
	</div>;
};

/**
 * Model families: the two newest models each family runs, from the
 * user-editable family-models config (seeded offline, refreshable online).
 * Provider wiring and prices live in `RoutesSettings`.
 */
export type ModelsSettingsProps = {
	families: ModelFamily[];
	relays: RelaySpec[];
	configError?: string;
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string) => Promise<TestResult>;
	onCancelTest: (requestId: string) => Promise<unknown>;
	onOpenRoutes: (familyId?: string) => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

export const ModelsSettingsContent = forwardRef<SettingsEditorHandle, ModelsSettingsProps>(function ModelsSettingsContent({ families, relays, configError, onTest, onCancelTest, onOpenRoutes, onLockChange }, ref) {
	const { config, catalog, setFamilyModels, refreshFamily, updating, updateNotice, clearUpdateNotice } = useFamilyModels();
	const { draft, setDraft, pending, error, setError, contentRef, closeDraft } = useSettingsEditor<Draft>({ ref, onLockChange });
	const [adding, setAdding] = useState<string>();
	const [addingId, setAddingId] = useState("");
	const [mappingOpen, setMappingOpen] = useState<string>();
	const [selectedFamily, setSelectedFamily] = useState<string>(EDITABLE[0]);
	const editing = draft?.kind === "family-models";

	const rows = useMemo(() => families.filter((family) => EDITABLE.includes(family.id as (typeof EDITABLE)[number])).map((family) => ({
		family,
		entries: config[family.id] ?? [],
	})), [families, config]);
	const autoFamily = families.find((family) => family.id === "auto");
	const autoRoutes = autoFamily ? familyRoutesAvailable(autoFamily, relays) : 0;

	const startEdit = () => { setError(undefined); clearUpdateNotice(); setDraft({ kind: "family-models" }); };
	const addManual = (familyId: string, event: FormEvent) => {
		event.preventDefault();
		const modelId = addingId.trim();
		if (!modelId) return;
		const current = config[familyId] ?? [];
		if (current.some((entry) => entry.modelId.trim().toLowerCase() === modelId.toLowerCase())) { setError("该模型已在列表中"); return; }
		setFamilyModels(familyId, [{ modelId, origin: "manual" }, ...current]);
		setAddingId("");
		setAdding(undefined);
		setError(undefined);
	};

	// Per-model connectivity check: one in-flight request per model, cancelled
	// when the row asks to stop or the page unmounts.
	const [modelTests, setModelTests] = useState<Record<string, ModelTest>>({});
	const modelTestRequests = useRef(new Map<string, string>());
	useEffect(() => () => {
		for (const requestId of modelTestRequests.current.values()) void onCancelTest(requestId).catch(() => {});
		modelTestRequests.current.clear();
	}, []);
	// The guard runs while recording, not inside the state updater: React may
	// defer the updater until after the request key is already cleaned up.
	const recordModelTest = (key: string, requestId: string, next: ModelTest) => {
		if (modelTestRequests.current.get(key) !== requestId) return;
		setModelTests((previous) => ({ ...previous, [key]: next }));
	};
	const runModelTest = async (family: ModelFamily, modelId: string) => {
		const target = routeForModelTest(family, relays, modelId, catalog);
		if (!target) return;
		const key = testKeyOf(family.id, modelId);
		const requestId = crypto.randomUUID();
		modelTestRequests.current.set(key, requestId);
		recordModelTest(key, requestId, { state: "running", relayName: target.relay.name });
		const started = Date.now();
		try {
			recordModelTest(key, requestId, { state: "done", relayName: target.relay.name, result: await onTest(target.relay.baseUrl, target.relay.apiKey, modelId, target.relay.timeoutSeconds, requestId) });
		} catch (cause) {
			recordModelTest(key, requestId, { state: "done", relayName: target.relay.name, result: { ok: false, latencyMs: Date.now() - started, status: null, error: String(cause) } });
		} finally {
			if (modelTestRequests.current.get(key) === requestId) modelTestRequests.current.delete(key);
		}
	};
	const stopModelTest = (familyId: string, modelId: string) => {
		const key = testKeyOf(familyId, modelId);
		const requestId = modelTestRequests.current.get(key);
		if (!requestId) return;
		modelTestRequests.current.delete(key);
		setModelTests((previous) => { const next = { ...previous }; delete next[key]; return next; });
		void onCancelTest(requestId).catch(() => {});
	};
	const modelTestStatus = (family: ModelFamily, modelId: string) => {
		const test = modelTests[testKeyOf(family.id, modelId)];
		const running = test?.state === "running";
		return <span className={`test-result model-test-result ${test && !running ? test.result?.ok ? "ok" : "bad" : "muted"}`} role={test ? "status" : undefined} title={test ? testTextOf(test) : undefined}>{test ? testTextOf(test) : ""}</span>;
	};
	/** The action cell is always present, so every row keeps the same column widths. */
	const modelTestAction = (family: ModelFamily, modelId: string) => {
		if (modelTests[testKeyOf(family.id, modelId)]?.state === "running") return <Button type="button" variant="ghost" size="compact" onClick={() => stopModelTest(family.id, modelId)}>停止</Button>;
		const target = routeForModelTest(family, relays, modelId, catalog);
		return <Button type="button" variant="ghost" size="compact" disabled={pending || !target} title={target ? `通过 ${target.relay.name} 测试 ${modelId}` : "该模型还没有可用路线，请先在路线页接上供应商"} onClick={() => void runModelTest(family, modelId)}>测试</Button>;
	};

	return <div ref={contentRef} className="settings-editor">
		{editing ? (
			<div>
				<div className="dialog-heading"><h2 id="models-title">编辑家族模型</h2><IconButton type="button" onClick={closeDraft} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton></div>
				<p className="muted">每个家族最多保留两个自动更新的模型；手动添加的模型标为「手动」，不会被联网更新覆盖。</p>
				{rows.map(({ family, entries }) => <section className="family-card" key={family.id}>
					<div className="family-card-head">
						<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}</span>
						<Button type="button" variant="ghost" size="compact" disabled={updating.has(family.id)} onClick={() => void refreshFamily(family.id)}>{updating.has(family.id) ? "更新中…" : "联网更新"}</Button>
					</div>
					{entries.length === 0 && <p className="family-empty">暂无模型，点「联网更新」获取，或手动添加。</p>}
					{entries.map((entry, index) => <div className="provider-row model-family-row" key={`${entry.modelId}:${index}`}>
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>{entry.modelId}</strong><span className="provider-tag">{entry.origin === "manual" ? "手动" : "自动"}</span></div>
						</div>
						{modelTestStatus(family, entry.modelId)}
						<div className="provider-row-actions">
							{modelTestAction(family, entry.modelId)}
							<IconButton type="button" disabled={pending} onClick={() => setFamilyModels(family.id, entries.filter((_, row) => row !== index))} aria-label={`删除 ${entry.modelId}`} title="删除"><Icon name="trash" size={14} /></IconButton>
						</div>
					</div>)}
					{adding === family.id ? (
						<form className="family-add-row" onSubmit={(event) => addManual(family.id, event)}>
							<Input aria-label={`${FAMILY_LABELS[family.id] ?? family.id} 新模型 ID`} placeholder="模型 ID，如 deepseek-v4-pro" value={addingId} onChange={(event) => setAddingId(event.target.value)} disabled={pending} />
							<Button type="submit" size="compact" disabled={pending || !addingId.trim()}>添加</Button>
							<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => { setAdding(undefined); setAddingId(""); }}>取消</Button>
						</form>
					) : (
						<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => { setAdding(family.id); setAddingId(""); }}>添加模型</Button>
					)}
				</section>)}
				{(error || updateNotice && !updateNotice.ok) && <p className="form-error" role="alert">{error || updateNotice?.text}</p>}
				<div className="dialog-actions"><Button variant="ghost" type="button" onClick={closeDraft} disabled={pending}>返回</Button></div>
			</div>
		) : (
			<>
				<div className="dialog-heading"><h2 id="models-title">模型</h2><Button type="button" variant="ghost" size="compact" onClick={startEdit}>编辑家族模型</Button></div>
				<p className="muted">每个家族展示最新的两个模型；价格与供应商配置在「路线」中编辑。</p>
				<div className="family-model-tabs" role="tablist" aria-label="模型家族">
					{rows.map(({ family }) => <button type="button" className={`family-model-tab${selectedFamily === family.id ? " is-active" : ""}`} role="tab" aria-selected={selectedFamily === family.id} key={family.id} onClick={() => setSelectedFamily(family.id)}>{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}<span>{FAMILY_LABELS[family.id] ?? family.displayName}</span></button>)}
				</div>
				{rows.filter(({ family }) => family.id === selectedFamily).map(({ family, entries }) => <section className="family-card" key={family.id}>
					<div className="family-card-head">
						<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}<IconButton type="button" className="model-mapping-trigger" onClick={() => setMappingOpen((current) => current === family.id ? undefined : family.id)} aria-label={`${mappingOpen === family.id ? "收起" : "查看"} ${FAMILY_LABELS[family.id] ?? family.displayName} 的实际线路映射`} aria-expanded={mappingOpen === family.id} title="查看家族实际线路映射"><Icon name={mappingOpen === family.id ? "eye-off" : "eye"} size={14} /></IconButton></span>
						<Button type="button" variant="ghost" size="compact" disabled={updating.has(family.id)} title="从官方页面与模型目录更新这两个模型" onClick={() => void refreshFamily(family.id)}>{updating.has(family.id) ? "更新中…" : "联网更新"}</Button>
					</div>
					{mappingOpen === family.id && modelMappingPanel(entries.map((entry) => ({ modelId: entry.modelId, mappings: routeMappingsFor(family, relays, entry.modelId, catalog) })))}
					{entries.length === 0
						? <p className="family-empty">未配置模型，<button type="button" className="link-button" onClick={() => onOpenRoutes(family.id)}>去路线页添加</button>。</p>
						: entries.map((entry) => {
							const count = availableRoutes(family, relays, entry.modelId, catalog);
							const alias = aliasFor(family, entry.modelId, catalog);
							return <div className="provider-row model-family-row" key={entry.modelId}>
								<div className="provider-row-main">
									<div className="provider-row-title"><strong>{alias || entry.modelId}</strong>{alias && <small>{entry.modelId}</small>}{entry.origin === "manual" && <span className="provider-tag">手动</span>}</div>
									<small className="model-family-meta"><span>{count > 0 ? `${count} 条路线可用` : <button type="button" className="link-button" onClick={() => onOpenRoutes(family.id)}>未接路线，去配置</button>}</span></small>
								</div>
								{modelTestStatus(family, entry.modelId)}
								<div className="provider-row-actions">{modelTestAction(family, entry.modelId)}</div>
							</div>;
						})}
				</section>)}
				{autoFamily && <section className="family-card">
					<div className="family-card-head">
						<span className="family-card-title">Auto<IconButton type="button" className="model-mapping-trigger" onClick={() => setMappingOpen((current) => current === "auto" ? undefined : "auto")} aria-label={`${mappingOpen === "auto" ? "收起" : "查看"} Auto 的实际线路映射`} aria-expanded={mappingOpen === "auto"} title="查看 Auto 实际线路映射"><Icon name={mappingOpen === "auto" ? "eye-off" : "eye"} size={14} /></IconButton></span>
					</div>
					{mappingOpen === "auto" && modelMappingPanel([{ modelId: "Auto（自动选择）", mappings: routeMappingsForAuto(autoFamily, relays) }])}
					<div className="provider-row">
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>Auto</strong><small>自动选择</small></div>
							<small>{autoRoutes > 0 ? `${autoRoutes} 条路线可用` : <button type="button" className="link-button" onClick={() => onOpenRoutes("auto")}>未接路线，去配置</button>}</small>
						</div>
					</div>
				</section>}
				{updateNotice && updateNotice.ok && <p className="family-added-hint" role="status">{updateNotice.text}</p>}
				{configError && <p className="form-error" role="alert">{configError}</p>}
			</>
		)}
	</div>;
});
