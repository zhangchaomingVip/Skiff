import { forwardRef, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DiscoveredModel } from "../rpc/modelDiscovery";
import { catalogEntryToPriced } from "../chat/pricingPage";
import { catalogVision } from "../chat/modelVision";
import { slowOrFailedModels, testModelsConcurrently } from "../chat/providerConnection";
import { filterPresets, hostOf, matchPreset, PRESET_KINDS, type ProviderPreset } from "../chat/providerPresets";
import { buildDiscoveredRoutes, discoveredFamily } from "../chat/providerRoutes";
import { useModelCatalog } from "../chat/useModelCatalog";
import { blankModel, blankRelay, FAMILY_LABELS, maskBaseUrl, maskKey, type ModelFamily, type ModelSpec, type RelayRouteSpec, type RelaySpec, type TestResult } from "../chat/useModelFamilies";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ProviderIcon } from "./ProviderIcon";
import { useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Button, IconButton, Input, Select, Tooltip } from "./ui";

const openLink = (url: string) => void invoke("open_url", { url }).catch((error) => console.error(String(error)));

/** Key fingerprint: first 4 + last 4 (sk-1…8961), shown on the right of a row. */
const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : maskKey(key));

type Draft =
	| { kind: "pick" }
	| { kind: "relay"; relay: RelaySpec; isNew: boolean; preset?: ProviderPreset };

/**
 * Providers alone: one access point per row (endpoint plus one API key, reused
 * by every route on it). Adding starts from a vendor directory (search + kind
 * sections); the editor asks for the key over the preset's endpoint and
 * requires one live connection test before a new provider can be saved. A save
 * that discovers supported models also creates their routes, so the page links
 * across to the route settings.
 */
export type ProvidersSettingsProps = {
	relays: RelaySpec[];
	families: ModelFamily[];
	usdCnyRate: number;
	configError?: string;
	onSaveRelay: (relay: RelaySpec, routes?: RelayRouteSpec[]) => Promise<RelaySpec | undefined>;
	onDeleteRelay: (relayId: string) => Promise<boolean>;
	onSetRelayEnabled: (relayId: string, enabled: boolean) => Promise<boolean>;
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string) => Promise<TestResult>;
	onCancelTest: (requestId: string) => Promise<unknown>;
	onDiscover: (baseUrl: string, apiKey: string) => Promise<DiscoveredModel[]>;
	onOpenRoutes: () => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

export const ProvidersSettingsContent = forwardRef<SettingsEditorHandle, ProvidersSettingsProps>(function ProvidersSettingsContent({ relays, families, usdCnyRate, configError, onSaveRelay, onDeleteRelay, onSetRelayEnabled, onTest, onCancelTest, onDiscover, onOpenRoutes, onLockChange }, ref) {
	const { catalog, latest } = useModelCatalog();
	const [query, setQuery] = useState("");
	const [notice, setNotice] = useState<string>();
	const [reveal, setReveal] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResults, setTestResults] = useState<(TestResult & { modelId: string })[]>([]);
	const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
	const testModels = useMemo(() => discoveredModels.map((model) => model.id), [discoveredModels]);
	const [testModel, setTestModel] = useState<string>();
	const [showTestModels, setShowTestModels] = useState(false);
	const [selectedTestModels, setSelectedTestModels] = useState<string[]>([]);
	const [testModelQuery, setTestModelQuery] = useState("");
	const [testBatch, setTestBatch] = useState<string[]>([]);
	const [completedTestModels, setCompletedTestModels] = useState<string[]>([]);
	const [testStopped, setTestStopped] = useState(false);
	const [runningTestModels, setRunningTestModels] = useState<string[]>([]);
	const [stoppedTestModels, setStoppedTestModels] = useState<string[]>([]);
	const [slowThreshold, setSlowThreshold] = useState(10);
	const [testSort, setTestSort] = useState<"latency" | "name">("latency");
	const testRequest = useRef(0);
	const activeTests = useRef(new Map<string, string>());
	const cancelActiveTest = () => {
		for (const requestId of activeTests.current.keys()) void onCancelTest(requestId).catch(() => {});
		activeTests.current.clear();
	};
	useEffect(() => () => { testRequest.current += 1; cancelActiveTest(); }, []);
	const resetConnectionTest = () => {
		testRequest.current += 1;
		cancelActiveTest();
		setTesting(false); setTestResults([]); setDiscoveredModels([]); setTestModel(undefined);
		setShowTestModels(false); setSelectedTestModels([]); setTestModelQuery(""); setTestBatch([]);
		setCompletedTestModels([]); setTestStopped(false);
		setRunningTestModels([]); setStoppedTestModels([]);
	};
	const { draft, setDraft, pending, setPending, error, setError, removing, setRemoving, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange, onClose: resetConnectionTest });

	const excludedTestModels = draft?.kind === "relay" ? draft.relay.excludedModelIds ?? [] : [];
	const result = testResults.find((item) => item.modelId === testModel);
	const connectionPassed = testResults.some((item) => item.ok && !excludedTestModels.includes(item.modelId));
	const selectableTestModels = testModels.filter((model) => !excludedTestModels.includes(model) && !testResults.some((item) => item.modelId === model && !item.ok));
	const allTestModelsSelected = selectableTestModels.length > 0 && selectableTestModels.length === selectedTestModels.length && selectableTestModels.every((model) => selectedTestModels.includes(model));
	const filteredTestModels = testModels.filter((model) => model.toLowerCase().includes(testModelQuery.trim().toLowerCase())).sort((a, b) => {
		const latency = (model: string) => { const tested = testResults.find((item) => item.modelId === model); return tested?.ok ? tested.latencyMs : Number.POSITIVE_INFINITY; };
		return (testSort === "latency" ? latency(a) - latency(b) : 0) || a.localeCompare(b);
	});

	const setModelExclusions = (models: string[], excluded: boolean) => {
		setDraft((current) => {
			if (!current || current.kind !== "relay") return current;
			const previous = current.relay.excludedModelIds ?? [];
			const excludedModelIds = excluded ? [...new Set([...previous, ...models])].sort() : previous.filter((model) => !models.includes(model));
			return { ...current, relay: { ...current.relay, excludedModelIds } };
		});
	};

	const openPick = () => {
		rememberEditorTrigger();
		resetConnectionTest();
		setNotice(undefined);
		setError(undefined); setReveal(false); setQuery("");
		setDraft({ kind: "pick" });
	};
	const openRelay = (relay?: RelaySpec, preset?: ProviderPreset) => {
		rememberEditorTrigger();
		resetConnectionTest();
		setNotice(undefined);
		setError(undefined); setReveal(false);
		if (relay) {
			setDraft({ kind: "relay", relay: { ...relay }, isNew: false, preset: preset ?? matchPreset(relay.baseUrl) });
		} else if (preset) {
			setDraft({ kind: "relay", relay: { ...blankRelay(), name: preset.name, baseUrl: preset.baseUrl }, isNew: true, preset });
		} else {
			setDraft({ kind: "relay", relay: blankRelay(), isNew: true });
		}
	};
	const patchRelay = (value: Partial<RelaySpec>) => {
		resetConnectionTest();
		setDraft((current) => current && current.kind === "relay" ? { ...current, relay: { ...current.relay, ...value } } : current);
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

	// A new provider must pass one live connection test (max_tokens=1) before it
	// can be saved. After failure, the user chooses which models to test next.
	const stopConnectionTest = () => {
		testRequest.current += 1;
		setStoppedTestModels([...activeTests.current.values()]);
		cancelActiveTest();
		setRunningTestModels([]);
		setTesting(false); setTestStopped(true);
	};
	const testRelay = async (selected?: string[], all = false) => {
		if (!draft || draft.kind !== "relay" || testing) return;
		const relay = draft.relay;
		const request = ++testRequest.current;
		setTesting(true); setTestStopped(false); setError(undefined); setCompletedTestModels([]);
		setRunningTestModels([]); setStoppedTestModels([]);
		if (all) setShowTestModels(true);
		try {
			const models = discoveredModels.length && !all ? discoveredModels : await onDiscover(relay.baseUrl, relay.apiKey);
			if (request !== testRequest.current) return;
			if (!models.length) { setError("接口未返回模型，无法测试连接"); return; }
			setDiscoveredModels(models);
			const available = models.filter((model) => !excludedTestModels.includes(model.id));
			const preferred = testModel && available.some((m) => m.id === testModel) ? testModel : (available.find((m) => discoveredFamily(m.id))?.id ?? available[0]?.id);
			const batch = all ? available.map((m) => m.id) : selected ? available.filter((m) => selected.includes(m.id)).map((m) => m.id) : [preferred].filter((id): id is string => !!id);
			if (!batch.length) { setError("请至少选择一个模型"); return; }
			setTestBatch(batch);
			await testModelsConcurrently(batch, {
				concurrency: 5,
				isCancelled: () => request !== testRequest.current,
				onStart: (model, requestId) => {
					activeTests.current.set(requestId, model);
					setTestModel(model);
					setRunningTestModels((previous) => [...previous, model]);
				},
				test: async (model, requestId) => {
					try { return await onTest(relay.baseUrl, relay.apiKey, model, relay.timeoutSeconds, requestId); }
					finally {
						activeTests.current.delete(requestId);
						if (request === testRequest.current) setRunningTestModels((previous) => previous.filter((item) => item !== model));
					}
				},
				onResult: (model, tested) => {
					setTestModel(model);
					setTestResults((previous) => [...previous.filter((item) => item.modelId !== model), { ...tested, modelId: model }]);
					setCompletedTestModels((previous) => [...previous, model]);
					if (!tested.ok) setShowTestModels(true);
				},
			});
		} catch (e) {
			if (request === testRequest.current) setError(String(e));
		} finally {
			if (request === testRequest.current) setTesting(false);
		}
	};

	const submitRelay = async (event: FormEvent) => {
		event.preventDefault();
		if (!draft || draft.kind !== "relay" || pending || testing) return;
		const relay = draft.relay;
		if (!relay.name.trim()) { setError("请填写名称"); return; }
		if (!/^https?:\/\//i.test(relay.baseUrl.trim())) { setError("接口地址必须以 http:// 或 https:// 开头"); return; }
		if (relays.some((item) => item.id !== relay.id && item.name.trim().toLowerCase() === relay.name.trim().toLowerCase())) { setError("名称不能重复"); return; }
		if (draft.isNew && !connectionPassed) { setError("请先通过连接测试再保存"); return; }
		setPending(true); setError(undefined);
		try {
			const failedModels = testResults.filter((item) => !item.ok).map((item) => item.modelId);
			const routes = buildDiscoveredRoutes(connectionPassed ? discoveredModels.filter((m) => !failedModels.includes(m.id)) : [], relay, families, fillFromCatalog, latest.size ? latest : undefined);
			const saved = await onSaveRelay(relay, routes);
			if (saved) {
				if (routes.length) setNotice(`已为「${saved.name}」自动添加 ${routes.length} 条路线，包含 ${routes.reduce((sum, item) => sum + item.route.models.length, 0)} 个模型。`);
				else if (draft.preset?.familyId) setNotice(`已保存「${saved.name}」，去「路线」为 ${FAMILY_LABELS[draft.preset.familyId]} 家族配置模型。`);
				else if (testModels.length && !testModels.some((id) => discoveredFamily(id))) setNotice(`已保存「${saved.name}」，未发现支持的 DeepSeek、Kimi、GLM 或 Auto 模型，请手动配置路线。`);
				else setNotice(`已保存「${saved.name}」。`);
				setDraft(undefined);
			} else {
				setError("保存失败，请检查填写内容");
			}
		} finally { setPending(false); }
	};

	// A provider row counts the models its routes serve, deduplicated per family.
	const relayModelCount = useMemo(() => {
		const counts = new Map<string, Set<string>>();
		for (const family of families) {
			for (const route of family.routes) {
				let bucket = counts.get(route.relayId);
				if (!bucket) counts.set(route.relayId, bucket = new Set());
				const excluded = relays.find((relay) => relay.id === route.relayId)?.excludedModelIds ?? [];
				for (const model of route.models) if (model.modelId.trim() && !excluded.includes(model.modelId)) bucket.add(model.modelId.trim());
			}
		}
		return (relayId: string) => counts.get(relayId)?.size ?? 0;
	}, [families, relays]);

	return <div ref={contentRef} className={`settings-editor ${draft ? "is-editing" : ""}`}>
		{draft?.kind === "pick" ? (
			<div className="provider-sheet">
				<div className="dialog-heading provider-sheet-head">
					<h2 id="providers-title">{relays.length ? "添加供应商" : "添加第一个供应商"}</h2>
					<span className="provider-sheet-search"><Icon name="search" size={15} /><Input appearance="plain" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索供应商…" aria-label="搜索供应商" autoFocus /></span>
					<IconButton type="button"  onClick={closeDraft} aria-label="返回列表"><Icon name="close" /></IconButton>
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
						<h2 id="providers-title">{draft.isNew ? (preset ? preset.name : "自定义供应商") : relay.name}</h2>
						{preset?.familyId && <span className="provider-tag">{FAMILY_LABELS[preset.familyId]} 家族</span>}
						<span className="grow" />
						{site && <button type="button" className="editor-site" onClick={() => openLink(site)} title={site}>{hostOf(site)} ↗</button>}
						<IconButton type="button"  onClick={closeDraft} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton>
					</div>
					<p className="muted">{draft.isNew && preset ? "地址已按预设填好，粘贴密钥并通过连接测试即可。" : "通过连接测试后保存可补齐缺失路线。"}保存时自动为发现的 DeepSeek、Kimi 和 GLM 模型添加路线，已有路线保留。</p>
					<div className="editor-field">
						<label htmlFor="relay-name">名称</label>
						<div className="editor-control">
							<Input id="relay-name" required maxLength={32} placeholder="官方直连 / 硅基低价 / 中转站 A" value={relay.name} onChange={(event) => patchRelay({ name: event.target.value })} disabled={pending} />
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-key">API 密钥</label>
						<div className="editor-control">
							<span className="editor-key-row">
								<Input id="relay-key" type={reveal ? "text" : "password"} autoComplete="off" placeholder={draft.isNew ? (preset?.keyOptional ? "可选，本地服务可留空" : "粘贴 API 密钥") : "留空则保留原密钥"} value={relay.apiKey} onChange={(event) => patchRelay({ apiKey: event.target.value })} disabled={pending} />
								<Tooltip text={reveal ? "隐藏密钥" : "显示密钥"}>
									<IconButton type="button" variant="ghost" size="compact" aria-label={reveal ? "隐藏密钥" : "显示密钥"} aria-controls="relay-key" aria-pressed={reveal} onClick={() => setReveal((value) => !value)} disabled={pending}><Icon name={reveal ? "eye-off" : "eye"} /></IconButton>
								</Tooltip>
							</span>
							<small>密钥在本机加密保存，列表仅显示后 4 位。</small>
							{preset?.keysUrl && <Button type="button" variant="ghost" size="compact" className="editor-key-link" onClick={() => openLink(preset.keysUrl)}>获取密钥 ↗</Button>}
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-base">端点</label>
						<div className="editor-control">
							<Input id="relay-base" required placeholder="https://api.example.com/v1" value={relay.baseUrl} onChange={(event) => patchRelay({ baseUrl: event.target.value })} disabled={pending} />
							<small>OpenAI 兼容根地址，以 http:// 或 https:// 开头，包含 /v1 等前缀。</small>
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-account">扣费账户</label>
						<div className="editor-control">
							<Input id="relay-account" maxLength={128} placeholder="wallet-a（同一账户使用同一标识）" value={relay.billingAccountId} onChange={(event) => patchRelay({ billingAccountId: event.target.value })} disabled={pending} />
							<small>留空按未知账户处理；自动切换到不同或未知账户时需确认。</small>
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-timeout">超时</label>
						<div className="editor-control">
							<Input id="relay-timeout" type="number" min={5} max={600} value={relay.timeoutSeconds} onChange={(event) => patchRelay({ timeoutSeconds: Number(event.target.value) })} disabled={pending} />
							<small>超过此时间会终止请求并提示超时。</small>
						</div>
					</div>
					<div className="test-row">
						<Button type="button" variant="ghost" onClick={() => void testRelay()} disabled={pending || testing || !relay.baseUrl || (!relay.apiKey && !preset?.keyOptional)}>{testing ? "正在测试…" : "测试连接"}</Button>
						<Button type="button" variant="ghost" onClick={() => void testRelay(undefined, true)} disabled={pending || testing || !relay.baseUrl || (!relay.apiKey && !preset?.keyOptional)}>测试所有模型（5 并发）</Button>
						{testing && <Button type="button" variant="ghost" onClick={stopConnectionTest}>停止测试</Button>}
						{testStopped && <span className="test-result" role="status">已停止测试，已完成的结果已保留。</span>}
						{testing && <span className="test-result" role="status">{runningTestModels.length ? `正在测试 ${runningTestModels.length} 个模型 · 已完成 ${completedTestModels.length}/${testBatch.length}` : "正在获取模型列表…"}</span>}
						{result && !testing && !testStopped && <span className={`test-result ${result.ok ? "ok" : "bad"}`} role="status">{result.ok ? `连接成功 · ${testModel} · ${result.latencyMs} ms` : `连接失败 · 模型 ${testModel} · ${result.latencyMs} ms${result.status ? ` · HTTP ${result.status}` : ""}${result.error ? ` · ${result.error}` : ""}`}</span>}
						<small>{draft.isNew ? "新中转需至少一个未剔除的模型测试成功才能保存。" : "测试耗时为一次短回复的完整请求时间，最多同时测试 5 个模型。"}</small>
					</div>
					{!!relay.excludedModelIds?.length && <div className="connection-exclusions"><span>已剔除 {relay.excludedModelIds.length} 个模型（保存后生效）</span><Button type="button" variant="ghost" size="compact" disabled={pending || testing} onClick={() => setModelExclusions(relay.excludedModelIds ?? [], false)}>恢复全部</Button><details><summary>查看剔除名单</summary>{relay.excludedModelIds.map((model) => <div key={model}><span>{model}</span><Button type="button" variant="ghost" size="compact" disabled={pending || testing} onClick={() => setModelExclusions([model], false)}>恢复</Button></div>)}</details></div>}
					{showTestModels && <section className="connection-models" aria-label="选择测试模型">
						<div className="connection-models-heading">
							<strong>模型连接测速</strong>
							<span className="muted">已选 {selectedTestModels.length} / {testModels.length}</span>
						<Button type="button" variant="ghost" size="compact" disabled={pending || testing || !selectableTestModels.length} onClick={() => setSelectedTestModels(allTestModelsSelected ? [] : [...selectableTestModels])}>{allTestModelsSelected ? "取消全选" : "全选"}</Button>
						</div>
						<div className="connection-models-actions connection-speed-controls">
							<label>慢响应阈值（秒）<Input type="number" min={1} max={600} value={slowThreshold} onChange={(event) => setSlowThreshold(Math.max(1, Math.min(600, Number(event.target.value) || 1)))} /></label>
							<Button type="button" variant="ghost" size="compact" disabled={pending || testing || !slowOrFailedModels(testResults, slowThreshold * 1000).some((model) => !excludedTestModels.includes(model))} onClick={() => setModelExclusions(slowOrFailedModels(testResults, slowThreshold * 1000), true)}>剔除慢/失败模型</Button>
							<Select aria-label="测速结果排序" value={testSort} onChange={(event) => setTestSort(event.target.value as "latency" | "name")}><option value="latency">耗时从快到慢</option><option value="name">按模型名称排序</option></Select>
						</div>
						{testModels.length > 10 && <Input type="search" aria-label="搜索测试模型" placeholder="搜索模型…" value={testModelQuery} onChange={(event) => setTestModelQuery(event.target.value)} />}
						<div className="connection-models-list">
							{filteredTestModels.map((model) => {
								const tested = testResults.find((item) => item.modelId === model);
								const waiting = testing && testBatch.includes(model) && !completedTestModels.includes(model);
								const stopped = stoppedTestModels.includes(model);
								const status = waiting ? runningTestModels.includes(model) ? "正在测试…" : "等待测试" : stopped ? "已停止" : tested ? `${tested.ok ? "成功" : "失败"} · ${tested.latencyMs} ms${!tested.ok && tested.status ? ` · HTTP ${tested.status}` : ""}${tested.error ? ` · ${tested.error}` : ""}` : "未测试";
								return <div className="connection-model" key={model}>
									<label><input type="checkbox" checked={selectedTestModels.includes(model)} disabled={pending || testing} onChange={(event) => setSelectedTestModels((previous) => event.target.checked ? [...previous, model] : previous.filter((item) => item !== model))} /><span>{model}{excludedTestModels.includes(model) ? "（已剔除）" : ""}</span></label>
									<span className={`test-result ${waiting || stopped ? "muted" : tested ? tested.ok ? "ok" : "bad" : "muted"}`}>{status}</span>
									<Button type="button" variant="ghost" size="compact" disabled={pending || testing} onClick={() => setModelExclusions([model], !excludedTestModels.includes(model))}>{excludedTestModels.includes(model) ? "恢复" : "剔除"}</Button>
								</div>;
							})}
							{!filteredTestModels.length && <p className="muted">没有匹配的模型</p>}
						</div>
						<div className="connection-models-actions">
							<Button type="button" variant="ghost" disabled={pending || testing || !selectedTestModels.length} onClick={() => void testRelay(selectedTestModels)}>测试选中的 {selectedTestModels.length} 个模型</Button>
							<Button type="button" variant="ghost" disabled={pending || testing || !selectedTestModels.some((model) => !excludedTestModels.includes(model))} onClick={() => setModelExclusions(selectedTestModels, true)}>剔除选中的模型</Button>
							{testing && <Button type="button" variant="ghost" onClick={stopConnectionTest}>停止测试</Button>}
							{testBatch.length > 1 && <span className="muted" role="status">本轮已完成 {completedTestModels.length} / {testBatch.length}，成功 {testResults.filter((item) => completedTestModels.includes(item.modelId) && item.ok).length} 个</span>}
						</div>
						<small className="muted">全选会跳过已失败的模型；可手动勾选重试。每个模型测试可能产生少量 token 费用。</small>
					</section>}
					{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
					<div className="dialog-actions editor-actions">
						{!draft.isNew && <Button type="button" variant="danger" onClick={() => setRemoving({ title: "删除供应商", description: `将删除供应商「${relay.name}」，其全部路线与密钥会一并删除。`, action: async () => { const ok = await onDeleteRelay(relay.id); if (ok) setDraft(undefined); return ok; } })} disabled={pending}>删除</Button>}
						<span className="grow" />
						<Button type="button" variant="secondary" onClick={closeDraft} disabled={pending}>取消</Button>
						<Button type="submit" variant="primary" size="primary" disabled={pending || testing || (draft.isNew && !connectionPassed)}>{pending ? "保存中…" : draft.isNew ? "添加" : "保存"}</Button>
					</div>
				</form>;
			})()
		) : (
			<>
				<h2 id="providers-title">供应商</h2>
				<p className="muted">一条供应商是一个访问通道：端点加密钥，可被多条路线复用。保存时自动为发现的模型生成路线；共 {relays.length} 个供应商。</p>
				{notice && <p className="family-added-hint" role="status">{notice}<Button type="button" variant="ghost" size="compact" onClick={onOpenRoutes}>查看路线</Button></p>}
				<section className="family-card" aria-label="供应商列表">
					{relays.length === 0 && <p className="family-empty">还没添加供应商，从下面的目录挑一个，或用自定义地址。</p>}
					{relays.map((relay) => {
						const preset = matchPreset(relay.baseUrl);
						return <div className={`provider-row provider-relay-row ${relay.enabled ? "" : "disabled"}`} key={relay.id}>
							<button type="button" className="provider-relay-btn" onClick={() => openRelay(relay, preset)} disabled={pending} aria-label={`编辑 ${relay.name}`}>
								<ProviderIcon id={preset?.id ?? ""} name={relay.name} size={22} />
								<span className="provider-row-text">
									<span className="provider-row-title"><strong title={relay.name}>{relay.name}</strong>{!relay.enabled && <span className="provider-tag muted-tag">已停用</span>}</span>
									<small className="provider-row-meta"><span className="provider-row-endpoint" title={maskBaseUrl(relay.baseUrl)}>{maskBaseUrl(relay.baseUrl)}</span><span className="provider-row-count">· {relayModelCount(relay.id) ? `${relayModelCount(relay.id)} 个模型` : "未配置模型"}</span></small>
								</span>
							</button>
							<div className="provider-row-side">
								<span className="provider-key" title={relay.apiKey ? "密钥已保存" : undefined}>{relay.apiKey && <><span className="dot ok" />{keyHint(relay.apiKey)}</>}</span>
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
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
			</>
		)}
		{removing && <ConfirmDialog title={removing.title} description={removing.description} onConfirm={() => void mutate(removing.action)} onClose={() => setRemoving(undefined)} />}
	</div>;
});