import { forwardRef, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FAMILY_LABELS, type ModelFamily, type RelaySpec, type RelayProtocol, type TestResult } from "../chat/useModelFamilies";
import { matchesSettingsModel as matchesModel, settingsModelCandidates, settingsTestTarget as routeForModelTest, type CatalogIdentity } from "../chat/settingsModels";
import { useFamilyModels } from "../chat/useFamilyModels";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { Icon } from "./Icon";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Button, IconButton, Input } from "./ui";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const EDITABLE = [...BRANDABLE] as const;
const brand = (familyId: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

type Draft = { kind: "family-models" };

/** A result retains the actual request target, including alias resolution. */
type ModelTest = { state: "running" | "done"; relayName: string; modelId: string; result?: TestResult };
const testKeyOf = (familyId: string, modelId: string) => `${familyId}\u0000${modelId}`;
const testTextOf = (test: ModelTest) => `${test.relayName} · ${test.state === "running" ? "正在测试…" : test.result?.ok ? `成功 · ${test.result.latencyMs} ms` : `失败 · ${test.result?.latencyMs} ms${test.result?.status ? ` · HTTP ${test.result.status}` : ""}${test.result?.error ? ` · ${test.result.error}` : ""}`} · ${test.modelId}`;
const aliasFor = (family: ModelFamily, modelId: string, catalog: readonly CatalogIdentity[]) => family.routes.flatMap((route) => route.models).find((model) => matchesModel(model.modelId, modelId, catalog) && model.alias.trim())?.alias;

function modelMappingPanel(family: ModelFamily, relays: RelaySpec[], groups: { modelId: string; targetId?: string }[], catalog: readonly CatalogIdentity[]) {
	return <div className="model-mapping-panel" aria-label="实际线路映射">
		<p className="model-mapping-help">★ 家族默认路线；「优先」按各模型的可用候选计算。已有会话仍使用固定路线。以下为真实调用 ID。</p>
		<div className="model-mapping-table-wrap" tabIndex={0} aria-label="实际调用 ID 映射表，可左右滚动"><table className="model-mapping-table"><thead><tr><th scope="col">供应商 / 路线</th>{groups.map((group) => <th scope="col" key={group.modelId}>{group.modelId}</th>)}</tr></thead><tbody>{family.routes.map((route) => {
			const relay = relays.find((item) => item.id === route.relayId);
			return <tr key={route.id}><th scope="row">{relay?.name ?? route.relayId}{family.defaultRouteId === route.id && <span aria-label="家族默认路线"> ★ 默认</span>}</th>{groups.map((group) => {
				const matched = route.models.filter((model) => !group.targetId || matchesModel(model.modelId, group.targetId, catalog));
				const target = routeForModelTest(family, relays, group.targetId, catalog);
				return <td key={group.modelId}>{matched.length ? <span className="model-mapping-ids">{target?.route.id === route.id && <span className="provider-tag">优先</span>}{matched.map((model) => {
					const reason = !relay ? "供应商不存在" : !relay.enabled ? "供应商已停用" : !route.enabled ? "路线已停用" : relay.excludedModelIds?.includes(model.modelId) ? "模型已剔除" : undefined;
					return <span className="model-mapping-id" key={model.modelId}><i className={`model-route-status ${reason ? "is-disabled" : "is-active"}`} aria-label={reason ?? "可用"} /><code className={reason ? "is-excluded" : undefined}>{model.modelId}</code>{reason && <small>{reason}</small>}</span>;
				})}</span> : <span className="model-mapping-missing">未配置此模型</span>}</td>;
			})}</tr>;
		})}</tbody></table></div>
	</div>;
}

/**
 * Model families: automatically updated and manually added display models, from the
 * user-editable family-models config (seeded offline, refreshable online).
 * Provider wiring and prices live in `RoutesSettings`.
 */
export type ModelsSettingsProps = {
	families: ModelFamily[];
	relays: RelaySpec[];
	configError?: string;
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string, protocol?: RelayProtocol) => Promise<TestResult>;
	onCancelTest: (requestId: string) => Promise<unknown>;
	onOpenRoutes: (familyId?: string) => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

export const ModelsSettingsContent = forwardRef<SettingsEditorHandle, ModelsSettingsProps>(function ModelsSettingsContent({ families, relays, configError, onTest, onCancelTest, onOpenRoutes, onLockChange }, ref) {
	const { config, catalog, setFamilyModels, refreshFamily, updating, updateNotice, clearUpdateNotice } = useFamilyModels();
	const { draft, setDraft, pending, error, setError, contentRef, closeDraft, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange });
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
	const autoRoutes = autoFamily ? settingsModelCandidates(autoFamily, relays).length : 0;

	const startEdit = () => { rememberEditorTrigger(); setError(undefined); clearUpdateNotice(); setDraft({ kind: "family-models" }); };
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
	const testConfig = JSON.stringify([families, relays, catalog, config]);
	const currentConfig = useRef(testConfig);
	currentConfig.current = testConfig;
	useEffect(() => {
		setModelTests({});
		return () => {
			for (const requestId of modelTestRequests.current.values()) void onCancelTest(requestId).catch(() => {});
			modelTestRequests.current.clear();
		};
	}, [testConfig]);
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
		const startedConfig = testConfig;
		modelTestRequests.current.set(key, requestId);
		recordModelTest(key, requestId, { state: "running", relayName: target.relay.name, modelId: target.model.modelId });
		const started = Date.now();
		try {
			const result = await onTest(target.relay.baseUrl, target.relay.apiKey, target.model.modelId, target.relay.timeoutSeconds, requestId, target.relay.protocol);
			if (currentConfig.current === startedConfig) recordModelTest(key, requestId, { state: "done", relayName: target.relay.name, modelId: target.model.modelId, result });
		} catch (cause) {
			if (currentConfig.current === startedConfig) recordModelTest(key, requestId, { state: "done", relayName: target.relay.name, modelId: target.model.modelId, result: { ok: false, latencyMs: Date.now() - started, status: null, error: String(cause) } });
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
		return <Button type="button" variant="ghost" size="compact" disabled={pending || !target} title={target ? `通过 ${target.relay.name} 测试 ${target.model.modelId}` : "该模型还没有可用路线，请先在路线页接上供应商"} onClick={() => void runModelTest(family, modelId)}>测试</Button>;
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
				<p className="muted">自动模型最多两个，手动模型继续展示；价格与能力在「路线」中编辑。</p>
				<div className="family-model-tabs" role="tablist" aria-label="模型家族">
					{rows.map(({ family }) => <button type="button" className={`family-model-tab${selectedFamily === family.id ? " is-active" : ""}`} role="tab" aria-selected={selectedFamily === family.id} key={family.id} onClick={() => setSelectedFamily(family.id)}>{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}<span>{FAMILY_LABELS[family.id] ?? family.displayName}</span></button>)}
				</div>
				{rows.filter(({ family }) => family.id === selectedFamily).map(({ family, entries }) => <section className="family-card" key={family.id}>
					<div className="family-card-head">
						<span className="family-card-title">{brand(family.id) && <BrandIcon name={brand(family.id)!} size={15} />}{FAMILY_LABELS[family.id] ?? family.displayName}<IconButton type="button" className="model-mapping-trigger" onClick={() => setMappingOpen((current) => current === family.id ? undefined : family.id)} aria-label={`${mappingOpen === family.id ? "收起" : "查看"} ${FAMILY_LABELS[family.id] ?? family.displayName} 的实际线路映射`} aria-expanded={mappingOpen === family.id} title="查看家族实际线路映射"><Icon name={mappingOpen === family.id ? "eye-off" : "eye"} size={14} /></IconButton></span>
						<Button type="button" variant="ghost" size="compact" disabled={updating.has(family.id)} title="从官方页面与模型目录更新这两个模型" onClick={() => void refreshFamily(family.id)}>{updating.has(family.id) ? "更新中…" : "联网更新"}</Button>
					</div>
					{mappingOpen === family.id && modelMappingPanel(family, relays, entries.map((entry) => ({ modelId: entry.modelId, targetId: entry.modelId })), catalog)}
					{entries.length === 0
						? <p className="family-empty">未配置模型，<button type="button" className="link-button" onClick={() => onOpenRoutes(family.id)}>去路线页添加</button>。</p>
						: entries.map((entry) => {
							const count = settingsModelCandidates(family, relays, entry.modelId, catalog).length;
							const alias = aliasFor(family, entry.modelId, catalog);
							const preferred = routeForModelTest(family, relays, entry.modelId, catalog);
							return <div className="provider-row model-family-row" key={entry.modelId}>
								<div className="provider-row-main">
									<div className="provider-row-title"><strong>{alias || entry.modelId}</strong>{alias && <small>{entry.modelId}</small>}<span className="provider-tag">{entry.origin === "manual" ? "手动" : "自动"}</span></div>
									<small className="model-family-meta"><span>{count > 0 ? `${count} 条路线可用` : <button type="button" className="link-button" onClick={() => onOpenRoutes(family.id)}>未接路线，去配置</button>}</span>{preferred && <span>未指定路线时优先：{preferred.relay.name}</span>}</small>
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
					{mappingOpen === "auto" && modelMappingPanel(autoFamily, relays, [{ modelId: "Auto（自动选择）" }], catalog)}
					<div className="provider-row">
						<div className="provider-row-main">
							<div className="provider-row-title"><strong>Auto</strong><small>自动选择</small></div>
							<small>{autoRoutes > 0 ? `${autoRoutes} 条路线可用` : <button type="button" className="link-button" onClick={() => onOpenRoutes("auto")}>未接路线，去配置</button>}</small>
							{routeForModelTest(autoFamily, relays) && <small>未指定路线时优先：{routeForModelTest(autoFamily, relays)!.relay.name}</small>}
						</div>
					</div>
				</section>}
				{updateNotice && updateNotice.ok && <p className="family-added-hint" role="status">{updateNotice.text}</p>}
				{configError && <p className="form-error" role="alert">{configError}</p>}
			</>
		)}
	</div>;
});
