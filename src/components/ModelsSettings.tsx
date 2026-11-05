import { forwardRef, useEffect, useRef, useState } from "react";
import { useFamilyModels } from "../chat/useFamilyModels";
import { matchesSettingsModel, settingsProviderEndpointLabel, settingsProviderEndpointTitle } from "../chat/settingsModels";
import { LATEST_FAMILIES } from "../chat/latestModels";
import { latestSettingsTest, settingsTestSummary } from "../chat/settingsManagement";
import { useSettingsMetadata } from "../chat/useSettingsMetadata";
import type { ModelFamily, RelaySpec, RelayProtocol, TestResult } from "../chat/useModelFamilies";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Icon } from "./Icon";
import { Button, IconButton, Input, Select } from "./ui";

type TestStatus = { tone: "running" | "success" | "error" | "warning"; label: string; title?: string };
const failedTest = (error: string, status?: number | null): TestStatus => ({ tone: "error", label: /timeout|timed\s*out|超时/i.test(error) || status === 408 || status === 504 ? "连接超时" : "连接失败", title: error });

export type ModelsSettingsProps = {
	families: ModelFamily[];
	relays: RelaySpec[];
	configError?: string;
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string, protocol?: RelayProtocol, relay?: RelaySpec, draft?: boolean) => Promise<TestResult>;
	onCancelTest: (requestId: string) => Promise<unknown>;
	onOpenProvider: (relayId: string, modelId: string) => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

/** Families curate display names only. Every editable model belongs to a provider. */
export const ModelsSettingsContent = forwardRef<SettingsEditorHandle, ModelsSettingsProps>(function ModelsSettingsContent({ families, relays, configError, onTest, onCancelTest, onOpenProvider, onLockChange }, ref) {
	const { config, catalog, setFamilyModels, refreshFamilies, updating, updateNotice } = useFamilyModels();
	const { contentRef } = useSettingsEditor<never>({ ref, onLockChange });
	const metadata = useSettingsMetadata(relays);
	const [familyId, setFamilyId] = useState("all");
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const [addingFamilyId, setAddingFamilyId] = useState("deepseek");
	const [addingId, setAddingId] = useState("");
	const [tests, setTests] = useState<Record<string, TestStatus>>({});
	const activeTests = useRef(new Map<string, string>());
	const cancelTest = useRef(onCancelTest); cancelTest.current = onCancelTest;
	useEffect(() => () => { for (const requestId of activeTests.current.values()) void cancelTest.current(requestId).catch(() => {}); activeTests.current.clear(); }, []);
	const normalizedQuery = query.trim().toLowerCase();
	const cards = families.flatMap((family) => {
		const entries = config[family.id] ?? [];
		const configured = relays.flatMap((relay) => (relay.models ?? []).filter((model) => model.familyId === family.id).map((model) => ({ relay, model })));
		const ids = [...new Set([...entries.map((entry) => entry.modelId), ...configured.map(({ model }) => model.modelId)])];
		return ids.flatMap((id) => {
			const modelMatches = id.toLowerCase().includes(normalizedQuery);
			const providers = configured.filter(({ model, relay }) => matchesSettingsModel(model.modelId, id, catalog) && (modelMatches || [model.alias, model.modelId, relay.name, settingsProviderEndpointTitle(relay.baseUrl)].some((value) => value.toLowerCase().includes(normalizedQuery))));
			return modelMatches || providers.length ? [{ id, family, providers, listed: entries.some((entry) => entry.modelId === id) }] : [];
		});
	});
	const shownCards = cards.filter((card) => familyId === "all" || card.family.id === familyId);
	const refreshIds = LATEST_FAMILIES.filter((id) => families.some((family) => family.id === id) && (familyId === "all" || id === familyId));
	const targetFamilyId = familyId === "all" ? addingFamilyId : familyId;
	const entries = config[targetFamilyId] ?? [];
	const test = async (relay: RelaySpec, modelId: string) => {
		const key = `${relay.id}/${modelId}`;
		const running = activeTests.current.get(key);
		if (running) {
			activeTests.current.delete(key);
			setTests((previous) => ({ ...previous, [key]: { tone: "warning", label: "待测试", title: "测试已取消" } }));
			await onCancelTest(running).catch(() => {});
			return;
		}
		const requestId = crypto.randomUUID();
		activeTests.current.set(key, requestId);
		setTests((previous) => ({ ...previous, [key]: { tone: "running", label: "测试中…" } }));
		try {
			const result = await onTest(relay.baseUrl, relay.apiKey, modelId, relay.timeoutSeconds, requestId, relay.protocol, relay);
			if (activeTests.current.get(key) !== requestId) return;
			setTests((previous) => ({ ...previous, [key]: result.ok ? { tone: "success", label: `${result.latencyMs} ms`, title: "连接成功" } : failedTest(result.error ?? "连接失败", result.status) }));
		} catch (error) { if (activeTests.current.get(key) === requestId) setTests((previous) => ({ ...previous, [key]: failedTest(String(error)) })); }
		finally { if (activeTests.current.get(key) === requestId) activeTests.current.delete(key); }
	};
	return <div className="settings-editor models-settings" ref={contentRef}>
		<h2 id="models-title">模型</h2>
		<p className="muted">家族用于展示分组。每次聊天选择具体供应商和模型；能力、推理等级和价格在供应商的模型详情中编辑。</p>
		<div className="settings-toolbar providers-toolbar models-toolbar" role="group" aria-label="模型筛选">
			<div className="providers-toolbar-filters">
				<div className="provider-search">
					<Icon name="search" size={14} />
					<Input ref={searchRef} className="provider-search-input" aria-label="搜索模型名称或提供商" placeholder="搜索模型名称或提供商..." value={query} onChange={(event) => setQuery(event.target.value)} aria-controls="settings-model-list" />
					{query && <IconButton className="provider-search-clear" variant="ghost" size="compact" aria-label="清空模型搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><Icon name="close" size={12} /></IconButton>}
				</div>
				<Select className="provider-source-select" aria-label="模型家族" aria-controls="settings-model-list" value={familyId} onChange={(event) => setFamilyId(event.target.value)}>
					<option value="all">全部家族 ({cards.length})</option>
					{families.map((family) => <option key={family.id} value={family.id}>{family.displayName} ({cards.filter((card) => card.family.id === family.id).length})</option>)}
				</Select>
			</div>
			<div className="settings-toolbar-extras"><Button variant="secondary" disabled={!!updating.size || !refreshIds.length} title={!refreshIds.length ? "此家族暂无在线目录，可手动添加展示模型" : familyId === "all" ? "刷新全部家族的展示目录" : "刷新当前家族的展示目录"} onClick={() => void refreshFamilies(refreshIds)}><span className={`provider-test-icon ${updating.size ? "is-spinning" : ""}`}><Icon name="refresh" size={14} /></span>{updating.size ? "刷新中…" : "刷新目录"}</Button></div>
		</div>
		{updateNotice && <p className={updateNotice.ok ? "muted" : "form-error"} role="status">{updateNotice.text}</p>}
		<section className="model-card-list" id="settings-model-list" aria-label="模型列表">
			{shownCards.map(({ id, family, providers, listed }) => <article className="model-settings-card" key={`${family.id}/${id}`} aria-label={`${family.displayName} ${id}`}>
				<header className="model-settings-card-head"><div className="model-settings-card-title"><h3>{id}</h3>{familyId === "all" && <span className="provider-tag muted-tag">{family.displayName}</span>}</div>{listed && <Button variant="ghost" size="compact" aria-label={`移出展示清单 ${id}`} onClick={() => setFamilyModels(family.id, (config[family.id] ?? []).filter((entry) => entry.modelId !== id))}>移出展示清单</Button>}</header>
				{!providers.length && <p className="model-settings-empty">暂无供应商，在供应商设置中添加此模型后即可使用。</p>}
				{providers.map(({ relay, model }) => {
					const key = `${relay.id}/${model.modelId}`;
					const lastTest = latestSettingsTest(metadata.tests, relay.id, [model.modelId]);
					const running = tests[key]?.tone === "running";
					const disabled = !relay.enabled || !model.enabled;
					const status = running ? tests[key] : disabled ? { tone: "disabled", label: "停用", title: !relay.enabled ? "供应商已停用" : "模型已停用" } : tests[key] ?? (lastTest && !lastTest.configChanged ? lastTest.ok ? { tone: "success", label: `${lastTest.latencyMs} ms`, title: settingsTestSummary(lastTest) } : failedTest(lastTest.errorCategory ?? "连接失败", lastTest.status) : { tone: "warning", label: "待测试", title: settingsTestSummary(lastTest) });
					return <div className="model-provider-row" key={key}>
						<div className="model-provider-main"><strong>{relay.name}</strong><small title={settingsProviderEndpointTitle(relay.baseUrl)}>{settingsProviderEndpointLabel(relay.baseUrl)}</small>{model.modelId !== id && <small className="model-provider-id" title="供应商模型 ID">{model.modelId}</small>}</div>
						<span className={`provider-row-test-status is-${status.tone}`} role="status" title={status.title}><span className="provider-test-dot" aria-hidden="true" />{status.label}</span>
						<div className="provider-row-actions">
							<IconButton variant="ghost" size="compact" className="provider-test-button" aria-label={`${running ? "取消测试" : "测试连接"} ${relay.name} ${model.modelId}`} aria-busy={running || undefined} title={running ? "取消测试" : disabled ? "请先启用供应商和模型" : "测试模型请求响应耗时；可能产生少量 token"} disabled={!running && (disabled || !relay.baseUrl.trim())} onClick={() => void test(relay, model.modelId)}><span className={`provider-test-icon ${running ? "is-spinning" : ""}`}><Icon name={running ? "clock" : "gauge"} size={16} /></span></IconButton>
							<IconButton variant="ghost" size="compact" aria-label={`编辑模型 ${relay.name} ${model.modelId}`} title="编辑模型" onClick={() => onOpenProvider(relay.id, model.modelId)}><Icon name="edit" size={15} /></IconButton>
						</div>
					</div>;
				})}
			</article>)}
			{!shownCards.length && <p className="model-settings-empty">{normalizedQuery ? "没有匹配的模型，请调整搜索或家族筛选。" : "此家族暂无模型，可刷新目录或在供应商中添加模型。"}</p>}
		</section>
		<form className="model-display-add" aria-label="添加展示模型" onSubmit={(event) => { event.preventDefault(); const id = addingId.trim(); if (id && !entries.some((entry) => entry.modelId === id)) setFamilyModels(targetFamilyId, [...entries, { modelId: id, origin: "manual" }]); setAddingId(""); }}>
			{familyId === "all" && <Select aria-label="添加到模型家族" value={addingFamilyId} onChange={(event) => setAddingFamilyId(event.target.value)}>{families.map((family) => <option key={family.id} value={family.id}>{family.displayName}</option>)}</Select>}
			<Input aria-label="展示模型 ID" value={addingId} onChange={(event) => setAddingId(event.target.value)} placeholder="添加到家族展示清单" /><Button type="submit" disabled={!addingId.trim()}>添加</Button>
		</form>
		{configError && <p className="form-error" role="alert">{configError}</p>}
	</div>;
});
