import { Dialog, Input, IconButton, Button, Select } from "./ui";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TestResult } from "../chat/useModelFamilies";
import { slowOrFailedModels, testModelsConcurrently } from "../chat/providerConnection";
import { FAMILY_LABELS, blankRelay, blankRoute, blankModel, validateModels, maskBaseUrl, maskKey, type ModelFamily, type ModelSpec, type RelaySpec, type RouteSpec } from "../chat/useModelFamilies";
import { filterPresets, hostOf, matchPreset, PRESET_KINDS, type ProviderPreset } from "../chat/providerPresets";
import type { PricedModel } from "../chat/pricingPage";
import { catalogEntryToPriced } from "../chat/pricingPage";
import { catalogVision } from "../chat/modelVision";
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
export function FamiliesSettings({ families, relays, autoFailover, usdCnyRate, onSaveRate, onClose, onSaveRelay, onDeleteRelay, onSetRelayEnabled, onSaveRoute, onDeleteRoute, onReorderRoutes, onSetDefaultRoute, onAutoFailover, onTest, onCancelTest, onDiscover, configError }: {
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
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string) => Promise<TestResult>;
	onCancelTest: (requestId: string) => Promise<unknown>;
	onDiscover: (baseUrl: string, apiKey: string) => Promise<string[]>;
}) {
	const [tab, setTab] = useState<"relays" | "families">(relays.length ? "families" : "relays");
	// 模型选择 tab 内的家族筛选：undefined 表示「全部线路」。
	const [selectedFamily, setSelectedFamily] = useState<string>();
	const [draft, setDraft] = useState<Draft>();
	const [query, setQuery] = useState("");
	const [added, setAdded] = useState<{ relayId: string; relayName: string; familyId: string }>();
	const [removing, setRemoving] = useState<{ title: string; description: string; action: () => Promise<boolean> }>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const [reveal, setReveal] = useState(false);
	const [testing, setTesting] = useState(false);
	const [testResults, setTestResults] = useState<(TestResult & { modelId: string })[]>([]);
	const [testModels, setTestModels] = useState<string[]>([]);
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
	const excludedTestModels = draft?.kind === "relay" ? draft.relay.excludedModelIds ?? [] : [];
	const result = testResults.find((item) => item.modelId === testModel);
	const connectionPassed = testResults.some((item) => item.ok && !excludedTestModels.includes(item.modelId));
	const selectableTestModels = testModels.filter((model) => !excludedTestModels.includes(model) && !testResults.some((item) => item.modelId === model && !item.ok));
	const allTestModelsSelected = selectableTestModels.length > 0 && selectableTestModels.length === selectedTestModels.length && selectableTestModels.every((model) => selectedTestModels.includes(model));
	const filteredTestModels = testModels.filter((model) => model.toLowerCase().includes(testModelQuery.trim().toLowerCase())).sort((a, b) => {
		const latency = (model: string) => { const tested = testResults.find((item) => item.modelId === model); return tested?.ok ? tested.latencyMs : Number.POSITIVE_INFINITY; };
		return (testSort === "latency" ? latency(a) - latency(b) : 0) || a.localeCompare(b);
	});
	const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
	const [catalogStale, setCatalogStale] = useState(false);
	const [catalogFetchedAt, setCatalogFetchedAt] = useState(0);
	const cancelActiveTest = () => {
		for (const requestId of activeTests.current.keys()) void onCancelTest(requestId).catch(() => {});
		activeTests.current.clear();
	};

	// 官方牌价目录：失败静默（导入面板的牌价区会显示加载中/不可用）。
	useEffect(() => {
		let alive = true;
		void fetchPublicCatalog().then((response) => {
			if (!alive) return;
			setCatalog(response.models);
			setCatalogStale(response.stale);
			setCatalogFetchedAt(response.fetchedAt);
		}).catch(() => {});
		return () => { alive = false; testRequest.current += 1; cancelActiveTest(); };
	}, []);


	const resetConnectionTest = () => {
		testRequest.current += 1;
		cancelActiveTest();
		setTesting(false); setTestResults([]); setTestModels([]); setTestModel(undefined);
		setShowTestModels(false); setSelectedTestModels([]); setTestModelQuery(""); setTestBatch([]);
		setCompletedTestModels([]); setTestStopped(false);
		setRunningTestModels([]); setStoppedTestModels([]);
	};
	const closeDraft = () => { resetConnectionTest(); setDraft(undefined); };
	const stopConnectionTest = () => {
		testRequest.current += 1;
		setStoppedTestModels([...activeTests.current.values()]);
		cancelActiveTest();
		setRunningTestModels([]);
		setTesting(false); setTestStopped(true);
	};
	const setModelExclusions = (models: string[], excluded: boolean) => {
		setDraft((current) => {
			if (!current || current.kind !== "relay") return current;
			const previous = current.relay.excludedModelIds ?? [];
			const excludedModelIds = excluded ? [...new Set([...previous, ...models])].sort() : previous.filter((model) => !models.includes(model));
			return { ...current, relay: { ...current.relay, excludedModelIds } };
		});
	};

	const openPick = () => {
		resetConnectionTest();
		setError(undefined); setReveal(false); setQuery("");
		setDraft({ kind: "pick" });
	};
	const openRelay = (relay?: RelaySpec, preset?: ProviderPreset) => {
		resetConnectionTest();
		setError(undefined); setReveal(false);
		if (relay) {
			setDraft({ kind: "relay", relay: { ...relay }, isNew: false, preset: preset ?? matchPreset(relay.baseUrl) });
		} else if (preset) {
			setDraft({ kind: "relay", relay: { ...blankRelay(), name: preset.name, baseUrl: preset.baseUrl }, isNew: true, preset });
		} else {
			setDraft({ kind: "relay", relay: blankRelay(), isNew: true });
		}
	};
	const openRoute = (familyId: string, route?: RouteSpec, preferredRelayId?: string) => {
		resetConnectionTest();
		setError(undefined); setReveal(false);
		const fallbackRelay = preferredRelayId ?? relays[0]?.id ?? "";
		setDraft({ kind: "route", familyId, route: route ? { ...route, models: route.models.length ? route.models.map((model) => ({ ...model, vision: model.vision ?? catalogVision(model.modelId, catalog) })) : [blankModel()] } : blankRoute(fallbackRelay), isNew: !route });
	};

	const patchRelay = (value: Partial<RelaySpec>) => {
		resetConnectionTest();
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

	// A new relay must pass one live connection test (max_tokens=1) before it
	// can be saved. After failure, the user chooses which models to test next.
	const testRelay = async (selected?: string[], all = false) => {
		if (!draft || draft.kind !== "relay" || testing) return;
		const relay = draft.relay;
		const request = ++testRequest.current;
		setTesting(true); setTestStopped(false); setError(undefined); setCompletedTestModels([]);
		setRunningTestModels([]); setStoppedTestModels([]);
		if (all) setShowTestModels(true);
		try {
			const models = testModels.length && !all ? testModels : await onDiscover(relay.baseUrl, relay.apiKey);
			if (request !== testRequest.current) return;
			if (!models.length) { setError("接口未返回模型，无法测试连接"); return; }
			setTestModels(models);
			const batch = all ? models : selected ? models.filter((model) => selected.includes(model)) : [testModel ?? models.find((model) => !excludedTestModels.includes(model)) ?? models[0]];
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
			if (await onSaveRoute(draft.familyId, route)) { setSelectedFamily(draft.familyId); setDraft(undefined); }
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
					if (!model.modelId.trim() || relay.excludedModelIds?.includes(model.modelId)) continue;
					picks.push({ key: `${relay.id} ${model.modelId}`, relayName: relay.name, baseUrl: relay.baseUrl, apiKey: relay.apiKey, modelId: model.modelId.trim(), inputCost: model.inputCost, outputCost: model.outputCost, currency: model.currency, vision: model.vision ?? route.vision });
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
				const excluded = relays.find((relay) => relay.id === route.relayId)?.excludedModelIds ?? [];
				for (const model of route.models) if (model.modelId.trim() && !excluded.includes(model.modelId)) bucket.add(model.modelId.trim());
			}
		}
		return (relayId: string) => counts.get(relayId)?.size ?? 0;
	}, [families, relays]);
	const reorder = (routes: RouteSpec[], index: number, offset: number) => {
		const ids = routes.map((route) => route.id);
		const target = index + offset;
		if (target < 0 || target >= ids.length) return ids;
		[ids[index], ids[target]] = [ids[target], ids[index]];
		return ids;
	};

	return <Dialog onClose={onClose} pending={pending} onEscape={() => { if (draft) closeDraft(); else onClose(); }}  className={`project-dialog provider-dialog family-dialog ${draft ? "" : "family-dialog-overview"}`} aria-labelledby="families-title" >
		{draft?.kind === "pick" ? (
			<div className="provider-sheet">
				<div className="dialog-heading provider-sheet-head">
					<h2 id="families-title">{relays.length ? "添加供应商" : "添加第一个供应商"}</h2>
					<span className="provider-sheet-search"><Icon name="search" size={15} /><Input appearance="plain" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索供应商…" aria-label="搜索供应商" autoFocus /></span>
					<IconButton type="button"  onClick={() => setDraft(undefined)} aria-label="返回列表"><Icon name="close" /></IconButton>
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
						<IconButton type="button"  onClick={closeDraft} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton>
					</div>
					{draft.isNew && preset && <p className="muted">地址已按预设填好，粘贴密钥并通过连接测试即可；保存后到「模型选择」为它配置线路。</p>}
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
								<Button type="button" variant="ghost" size="compact" onClick={() => setReveal((value) => !value)} disabled={pending}>{reveal ? "隐藏" : "显示"}</Button>
								{preset?.keysUrl && <Button type="button" variant="ghost" size="compact" onClick={() => openLink(preset.keysUrl)}>获取密钥 ↗</Button>}
							</span>
							<small>密钥在本机加密保存，列表仅显示后 4 位。</small>
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-base">端点</label>
						<div className="editor-control">
							<span className="editor-endpoint">
								<span className="editor-protocol" title="OpenAI 兼容接口">OpenAI</span>
								<Input id="relay-base" required placeholder="https://api.example.com/v1" value={relay.baseUrl} onChange={(event) => patchRelay({ baseUrl: event.target.value })} disabled={pending} />
							</span>
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
						{!draft.isNew && <Button type="button" variant="danger" onClick={() => setRemoving({ title: "删除供应商", description: `将删除供应商「${relay.name}」，其全部线路与密钥会一并删除。`, action: async () => { const ok = await onDeleteRelay(relay.id); if (ok) setDraft(undefined); return ok; } })} disabled={pending}>删除</Button>}
						<span className="grow" />
						<Button type="button" variant="ghost" onClick={closeDraft} disabled={pending}>取消</Button>
						<Button type="submit" variant="primary" size="primary" disabled={pending || testing || (draft.isNew && !connectionPassed)}>{pending ? "保存中…" : draft.isNew ? "添加" : "保存"}</Button>
					</div>
				</form>;
			})()
		) : draft?.kind === "route" ? (
			<form onSubmit={(event) => void submitRoute(event)}>
				<div className="dialog-heading"><h2 id="families-title">{draft.isNew ? "添加线路" : "编辑线路"} · {FAMILY_LABELS[draft.familyId] ?? draft.familyId}</h2><IconButton type="button"  onClick={() => setDraft(undefined)} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton></div>
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
							<ModelIdField baseUrl={relays.find((relay) => relay.id === draft.route.relayId)?.baseUrl ?? ""} apiKey={relays.find((relay) => relay.id === draft.route.relayId)?.apiKey ?? ""} familyId={draft.familyId} value={model.modelId} onChange={(modelId) => patchModel(index, { modelId, vision: catalogVision(modelId, catalog) })} addedIds={draft.route.models.map((item) => item.modelId.trim())} excludedIds={relays.find((relay) => relay.id === draft.route.relayId)?.excludedModelIds} onAdd={(ids) => addModels(index, ids)} disabled={pending} />
							<div className="provider-model-actions">
								<IconButton type="button"  disabled={pending || index === 0} onClick={() => moveModel(index, -1)} aria-label={`上移模型 ${index + 1}`} title="上移模型"><Icon name="arrow" size={14} /></IconButton>
								<IconButton type="button" className="flip" disabled={pending || index === draft.route.models.length - 1} onClick={() => moveModel(index, 1)} aria-label={`下移模型 ${index + 1}`} title="下移模型"><Icon name="arrow" size={14} /></IconButton>
								<IconButton type="button"  disabled={pending || draft.route.models.length <= 1} onClick={() => patchRoute({ models: draft.route.models.filter((_, row) => row !== index) })} aria-label={`删除模型 ${index + 1}`} title="删除模型，至少保留一行"><Icon name="trash" size={14} /></IconButton>
							</div>
						</div>
						<label className="provider-model-alias">模型别名<Input maxLength={64} placeholder="可选，仅改变显示名称" value={model.alias} onChange={(event) => patchModel(index, { alias: event.target.value })} disabled={pending} /></label>
						{relays.find((relay) => relay.id === draft.route.relayId)?.excludedModelIds?.includes(model.modelId) && <small className="muted">此模型已在供应商中剔除，不会出现在模型选择列表。可在供应商详情中恢复。</small>}
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
					</div>)}
					<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => patchRoute({ models: [...draft.route.models, blankModel()] })}>添加模型</Button>
				</div>
				<div className="provider-capabilities"><label><input type="checkbox" checked={draft.route.streaming} onChange={(event) => patchRoute({ streaming: event.target.checked })} disabled={pending} />流式输出</label><label><input type="checkbox" checked={draft.route.tools} onChange={(event) => patchRoute({ tools: event.target.checked })} disabled={pending} />工具调用</label><label><input type="checkbox" checked={draft.route.vision} onChange={(event) => patchRoute({ vision: event.target.checked })} disabled={pending} />默认支持图片</label><label><input type="checkbox" checked={draft.route.reasoning} onChange={(event) => patchRoute({ reasoning: event.target.checked })} disabled={pending} />推理输出</label></div>
				{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				<div className="dialog-actions"><Button type="button" variant="ghost" onClick={() => setDraft(undefined)} disabled={pending}>返回</Button><Button type="submit" variant="primary" size="primary" disabled={pending}>{pending ? "保存中…" : "保存"}</Button></div>
			</form>
		) : (
			<>
				<div className="dialog-heading"><h2 id="families-title">模型配置</h2><IconButton type="button"  onClick={onClose} aria-label="关闭设置"><Icon name="close" /></IconButton></div>
				<p className="muted">先从供应商目录添加地址与密钥，再在家族卡片里为它配置线路；共 {`${total}`} 条线路。</p>
				<div className="dialog-tabs" role="tablist" aria-label="模型配置分类">
					<button type="button" role="tab" id="families-tab-relays" aria-selected={tab === "relays"} aria-controls="families-panel-relays" className={`dialog-tab ${tab === "relays" ? "active" : ""}`} onClick={() => setTab("relays")}>供应商<small>{relays.length} 个</small></button>
					<button type="button" role="tab" id="families-tab-models" aria-selected={tab === "families"} aria-controls="families-panel-models" className={`dialog-tab ${tab === "families" ? "active" : ""}`} onClick={() => setTab("families")}>模型选择<small>{total} 条线路</small></button>
				</div>
				<div className="family-tab-content">
					{tab === "relays" ? (
						<>
						<section className="family-card" id="families-panel-relays" role="tabpanel" aria-labelledby="families-tab-relays">
							{relays.length === 0 && <p className="family-empty">还没添加供应商，从下面的目录挑一个，或用自定义地址。</p>}
							{relays.map((relay) => {
								const preset = matchPreset(relay.baseUrl);
								return <div className={`provider-row ${relay.enabled ? "" : "disabled"}`} key={relay.id}>
									<Button type="button" className="provider-relay-btn" onClick={() => openRelay(relay, preset)} disabled={pending} aria-label={`编辑 ${relay.name}`}>
										<ProviderIcon id={preset?.id ?? ""} name={relay.name} size={22} />
										<span className="provider-row-text">
											<span className="provider-row-title"><strong>{relay.name}</strong>{!relay.enabled && <span className="provider-tag muted-tag">已停用</span>}</span>
											<small>{maskBaseUrl(relay.baseUrl)} · {relayModelCount(relay.id) ? `${relayModelCount(relay.id)} 个模型` : "未配置模型"}</small>
										</span>
									</Button>
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
							{added && <p className="family-added-hint" role="status">已添加「{added.relayName}」，去 {FAMILY_LABELS[added.familyId]} 家族配置模型线路：<Button type="button" variant="ghost" size="compact" disabled={pending || !relays.some((relay) => relay.id === added.relayId)} onClick={() => { setSelectedFamily(added.familyId); openRoute(added.familyId, undefined, added.relayId); setAdded(undefined); }}>添加线路</Button></p>}
							{relays.length === 0 && <section className="family-card">
								<div className="family-card-head">
									<span className="family-card-title">还没有供应商</span>
									<Button type="button" variant="ghost" size="compact" onClick={() => setTab("relays")}>去添加供应商</Button>
								</div>
								<p className="family-empty">线路依附于供应商：先到「供应商」添加地址与密钥，再回来为各家族配置线路。</p>
							</section>}
							{relays.length > 0 && <div className="family-layout">
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
							</div>}
						</div>
					)}
					{(configError || error) && <p className="form-error" role="alert">{configError || error}</p>}
				</div>
				<div className="dialog-actions"><Button type="button" variant="primary" size="primary" onClick={onClose} disabled={pending}>完成</Button></div>
			</>
		)}
		{removing && <ConfirmDialog title={removing.title} description={removing.description} onConfirm={() => void mutate(removing.action)} onClose={() => setRemoving(undefined)} />}
	</Dialog>;
}
