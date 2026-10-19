import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { latestSettingsTest, settingsTestSummary, sortSettingsProviders, providerBatchImpact, type ProviderSort, type BatchOperation, type RelayBatchPreview } from "../chat/settingsManagement";
import { useSettingsMetadata } from "../chat/useSettingsMetadata";
import { ProviderBatchDialog } from "./ProviderBatchDialog";
import type { DiscoveredModel } from "../rpc/modelDiscovery";
import { catalogEntryToPriced } from "../chat/pricingPage";
import { catalogVision } from "../chat/modelVision";
import { slowOrFailedModels, testModelsConcurrently } from "../chat/providerConnection";
import { filterPresets, hostOf, matchPreset, PRESET_KINDS, type ProviderPreset } from "../chat/providerPresets";
import { discoveredFamily, routesFromProviderModels } from "../chat/providerRoutes";
import { modelIdMatchesCatalog } from "../chat/latestModels";
import { useModelCatalog } from "../chat/useModelCatalog";
import { blankModel, blankRelay, FAMILY_LABELS, maskBaseUrl, maskKey, RELAY_PROTOCOLS, validateModels, type ModelFamily, type ModelSpec, type RelayProtocol, type RelayRouteSpec, type RelaySpec, type TestResult } from "../chat/useModelFamilies";
import { filterSettingsProviders, providerSourceLabel } from "../chat/settingsModels";
import type { SettingsLocation } from "./settingsNavigation";
import { DisclosureLabel } from "./Disclosure";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { ProviderIcon } from "./ProviderIcon";
import { useSettingsListFocus, useSettingsEditor, type SettingsEditorHandle } from "./settingsEditor";
import { Button, IconButton, Input, Select, Tooltip } from "./ui";

const openLink = (url: string) => void invoke("open_url", { url }).catch((error) => console.error(String(error)));

/** Saved-key fingerprint, shown only inside the advanced editor options. */
const keyHint = (key: string) => (key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : maskKey(key));

type Draft =
	| { kind: "pick" }
	| { kind: "relay"; relay: RelaySpec; isNew: boolean; preset?: ProviderPreset };

type ProviderModelDraft = { familyId?: string; model: ModelSpec };

/**
 * Providers alone: one access point per row (endpoint plus one API key, reused
 * by every route on it). Adding starts from a vendor directory (search + kind
 * sections); the editor asks for the key over the preset's endpoint and
 * requires one live connection test before a new provider can be saved. Model
 * edits in this form are projected back onto their family routes when saved.
 */
export type ProvidersSettingsProps = {
	relays: RelaySpec[];
	families: ModelFamily[];
	usdCnyRate: number;
	configError?: string;
	onSaveRelay: (relay: RelaySpec, routes?: RelayRouteSpec[], testRequestIds?: string[]) => Promise<RelaySpec | undefined>;
	onPreviewBatch: (ids: string[]) => Promise<RelayBatchPreview>;
	onBatch: (ids: string[], operation: BatchOperation, token: string) => Promise<boolean>;
	onDeleteRelay: (relayId: string) => Promise<boolean>;
	onSetRelayEnabled: (relayId: string, enabled: boolean) => Promise<boolean>;
	onTest: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string, protocol?: RelayProtocol, relay?: RelaySpec, draft?: boolean) => Promise<TestResult>;
	onCancelTest: (requestId: string) => Promise<unknown>;
	onDiscover: (baseUrl: string, apiKey: string, protocol?: RelayProtocol) => Promise<DiscoveredModel[]>;
	onOpenRoutes: (location?: SettingsLocation) => void;
	onLockChange: (locked: boolean, pending: boolean) => void;
};

export const ProvidersSettingsContent = forwardRef<SettingsEditorHandle, ProvidersSettingsProps>(function ProvidersSettingsContent({ relays, families, usdCnyRate, configError, onPreviewBatch, onBatch, onSaveRelay, onDeleteRelay, onSetRelayEnabled, onTest, onCancelTest, onDiscover, onOpenRoutes, onLockChange }, ref) {
	const { catalog } = useModelCatalog();
	const [query, setQuery] = useState("");
	const [listQuery, setListQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
	const [advanced, setAdvanced] = useState(false);
	const [savedLocation, setSavedLocation] = useState<{ relayId: string; familyIds: string[] }>();
	const metadata = useSettingsMetadata(relays);
	const [view, setView] = useState<{ sort: ProviderSort; grouped: boolean }>(() => {
		try { const saved = JSON.parse(localStorage.getItem("skiff.settings.providers-view.v1") ?? "null"); if (saved && ["config", "name", "recent", "status"].includes(saved.sort)) return { sort: saved.sort, grouped: saved.grouped === true }; } catch { /* Optional preference. */ }
		return { sort: "config", grouped: false };
	});
	useEffect(() => { try { localStorage.setItem("skiff.settings.providers-view.v1", JSON.stringify(view)); } catch { /* Optional preference. */ } }, [view]);
	const [batch, setBatch] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [batchAction, setBatchAction] = useState<BatchOperation>();
	useLayoutEffect(() => { setSelected([]); setBatchAction(undefined); }, [listQuery, statusFilter, view.grouped]);
	const completedTests = useRef(new Set<string>());
	const matchedRelays = filterSettingsProviders(relays, listQuery);
	const shownRelays = sortSettingsProviders(matchedRelays.filter((relay) => statusFilter === "all" || relay.enabled === (statusFilter === "enabled")), view.sort, metadata.usage, view.grouped);
	const [notice, setNotice] = useState<string>();
	const [reveal, setReveal] = useState(false);
	const [providerModels, setProviderModels] = useState<ProviderModelDraft[]>([]);
	const [discoveringModels, setDiscoveringModels] = useState(false);
	const [modelListNotice, setModelListNotice] = useState<string>();
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
	const modelDiscoveryRequest = useRef(0);
	const originalModelIds = useRef(new Set<string>());
	const activeTests = useRef(new Map<string, string>());
	const cancelActiveTest = () => {
		for (const requestId of activeTests.current.keys()) void onCancelTest(requestId).catch(() => {});
		activeTests.current.clear();
	};
	useEffect(() => () => { testRequest.current += 1; modelDiscoveryRequest.current += 1; cancelActiveTest(); }, []);
	const resetConnectionTest = () => {
		testRequest.current += 1;
		modelDiscoveryRequest.current += 1;
		cancelActiveTest();
		completedTests.current.clear();
		setTesting(false); setTestResults([]); setDiscoveredModels([]); setTestModel(undefined);
		setDiscoveringModels(false);
		setShowTestModels(false); setSelectedTestModels([]); setTestModelQuery(""); setTestBatch([]);
		setCompletedTestModels([]); setTestStopped(false);
		setRunningTestModels([]); setStoppedTestModels([]);
	};
	const { draft, setDraft, pending, setPending, error, setError, removing, setRemoving, contentRef, closeDraft, mutate, rememberEditorTrigger } = useSettingsEditor<Draft>({ ref, onLockChange, onClose: resetConnectionTest });
	useSettingsListFocus(contentRef, !!draft);

	const excludedTestModels = draft?.kind === "relay" ? draft.relay.excludedModelIds ?? [] : [];
	const result = testResults.find((item) => item.modelId === testModel);
	const connectionPassed = testResults.some((item) => item.ok && !excludedTestModels.includes(item.modelId) && providerModels.some((entry) => entry.model.modelId.trim() === item.modelId));
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
		if (excluded) setProviderModels((previous) => previous.filter((entry) => !models.includes(entry.model.modelId)));
		else restoreProviderModels(models);
	};
	const updateModelIdExclusions = (previousId: string, nextId: string) => setDraft((current) => {
		if (!current || current.kind !== "relay") return current;
		const excludedModelIds = new Set(current.relay.excludedModelIds ?? []);
		if (previousId && previousId !== nextId && originalModelIds.current.has(previousId)) excludedModelIds.add(previousId);
		if (nextId && nextId !== previousId) excludedModelIds.delete(nextId);
		return { ...current, relay: { ...current.relay, excludedModelIds: [...excludedModelIds].sort() } };
	});

	const openPick = () => {
		rememberEditorTrigger();
		resetConnectionTest();
		setProviderModels([]); originalModelIds.current = new Set(); setModelListNotice(undefined);
		setNotice(undefined);
		setError(undefined); setReveal(false); setQuery("");
		setDraft({ kind: "pick" });
	};
	// Toggling a row's switch is a list action: failures surface as `error`, and
	// the alert below is scrolled into view so the reason is actually seen.
	const toggleRelay = async (relayId: string, enabled: boolean) => {
		setNotice(undefined);
		setError(undefined);
		const ok = await onSetRelayEnabled(relayId, enabled);
		if (ok && statusFilter !== "all") requestAnimationFrame(() => contentRef.current?.querySelector<HTMLElement>(".settings-toolbar input")?.focus());
		if (!ok) contentRef.current?.querySelector<HTMLElement>(".provider-error")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		return ok;
	};
	const openRelay = (relay?: RelaySpec, preset?: ProviderPreset) => {
		rememberEditorTrigger();
		resetConnectionTest();
		setNotice(undefined);
		setError(undefined); setReveal(false); setAdvanced(false);
		if (relay) {
			const configured = families.flatMap((family) => family.routes.filter((route) => route.relayId === relay.id).flatMap((route) => route.models.map((model) => ({ familyId: family.id, model: { ...model } }))));
			const excluded = new Set(relay.excludedModelIds ?? []);
			setProviderModels(configured.filter((entry) => !excluded.has(entry.model.modelId)));
			originalModelIds.current = new Set(configured.map((entry) => entry.model.modelId));
			setDraft({ kind: "relay", relay: { ...relay }, isNew: false, preset: preset ?? matchPreset(relay.baseUrl) });
		} else if (preset) {
			setProviderModels([]); originalModelIds.current = new Set();
			setDraft({ kind: "relay", relay: { ...blankRelay(), name: preset.name, baseUrl: preset.baseUrl, protocol: preset.protocol ?? "openai" }, isNew: true, preset });
		} else {
			setProviderModels([]); originalModelIds.current = new Set();
			setDraft({ kind: "relay", relay: blankRelay(), isNew: true });
		}
		setModelListNotice(undefined);
	};
	const patchRelay = (value: Partial<RelaySpec>) => {
		if (value.baseUrl !== undefined || value.apiKey !== undefined || value.protocol !== undefined || value.timeoutSeconds !== undefined) resetConnectionTest();
		setDraft((current) => current && current.kind === "relay" ? { ...current, relay: { ...current.relay, ...value } } : current);
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

	const restoreProviderModels = (models: string[]) => {
		setProviderModels((previous) => {
			const restored = [...previous];
			for (const modelId of models) {
				if (restored.some((entry) => entry.model.modelId === modelId)) continue;
				const configured = families.flatMap((family) => family.routes.filter((route) => draft?.kind === "relay" && route.relayId === draft.relay.id).flatMap((route) => route.models.map((model) => ({ familyId: family.id, model })))).find((entry) => entry.model.modelId === modelId);
				const discovered = discoveredModels.some((model) => model.id === modelId);
				if (configured) restored.push({ ...configured, model: { ...configured.model } });
				else if (discovered) restored.push({ familyId: discoveredFamily(modelId) ?? (draft?.kind === "relay" ? draft.preset?.familyId : undefined), model: fillFromCatalog(modelId) });
			}
			return restored;
		});
	};

	const mergeDiscoveredModels = (models: DiscoveredModel[], relay: RelaySpec, preset?: ProviderPreset) => {
		const seen = new Set(providerModels.map((entry) => entry.model.modelId));
		const excluded = new Set(relay.excludedModelIds ?? []);
		const assignable = models.filter((model) => discoveredFamily(model.id) || preset?.familyId);
		const added = assignable.filter((model) => !seen.has(model.id.trim()) && !excluded.has(model.id.trim())).length;
		setProviderModels((previous) => {
			const merged = [...previous];
			const mergedIds = new Set(merged.map((entry) => entry.model.modelId));
			for (const discovered of assignable) {
				const modelId = discovered.id.trim();
				if (!modelId || mergedIds.has(modelId) || excluded.has(modelId)) continue;
				merged.push({ familyId: discoveredFamily(modelId) ?? preset?.familyId, model: fillFromCatalog(modelId) });
				mergedIds.add(modelId);
			}
			return merged;
		});
		const unsupported = models.length - assignable.length;
		setModelListNotice(`获取到 ${models.length} 个模型，新增 ${added} 个${unsupported ? `；${unsupported} 个暂不属于可用家族，未加入` : ""}。`);
	};

	const discoverProviderModels = async () => {
		if (draft?.kind !== "relay" || discoveringModels || pending) return;
		const current = draft;
		const request = ++modelDiscoveryRequest.current;
		setDiscoveringModels(true); setError(undefined); setModelListNotice(undefined);
		try {
			const models = await onDiscover(current.relay.baseUrl, current.relay.apiKey, current.relay.protocol);
			if (request !== modelDiscoveryRequest.current) return;
			if (!models.length) { setError("接口未返回模型"); return; }
			setDiscoveredModels(models);
			mergeDiscoveredModels(models, current.relay, current.preset);
		} catch (e) {
			if (request === modelDiscoveryRequest.current) setError(String(e));
		} finally {
			if (request === modelDiscoveryRequest.current) setDiscoveringModels(false);
		}
	};

	const patchProviderModel = (index: number, value: Partial<ModelSpec>) => {
		const current = providerModels[index];
		if (!current) return;
		if (value.modelId !== undefined) updateModelIdExclusions(current.model.modelId, value.modelId.trim());
		setProviderModels((previous) => previous.map((entry, row) => {
			if (row !== index) return entry;
			const model = { ...entry.model, ...value };
			if (value.contextWindow !== undefined && model.maxTokens > value.contextWindow) model.maxTokens = value.contextWindow;
			const familyId = value.modelId === undefined ? entry.familyId : discoveredFamily(value.modelId.trim()) ?? entry.familyId;
			return { familyId, model };
		}));
	};

	const removeProviderModel = (index: number) => {
		const modelId = providerModels[index]?.model.modelId;
		if (modelId && originalModelIds.current.has(modelId)) setModelExclusions([modelId], true);
		else setProviderModels((previous) => previous.filter((_, row) => row !== index));
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
			const models = discoveredModels.length && !all ? discoveredModels : await onDiscover(relay.baseUrl, relay.apiKey, relay.protocol);
			if (request !== testRequest.current) return;
			if (!models.length) { setError("接口未返回模型，无法测试连接"); return; }
			setDiscoveredModels(models);
			mergeDiscoveredModels(models, relay, draft.preset);
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
					try { const result = await onTest(relay.baseUrl, relay.apiKey, model, relay.timeoutSeconds, requestId, relay.protocol, relay, true); if (request === testRequest.current) completedTests.current.add(requestId); return result; }
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

	// One model of this relay, tested exactly like the batch run so its result
	// lands in the same list the speed panel reads.
	const testProviderModel = async (modelId: string) => {
		if (!draft || draft.kind !== "relay" || testing) return;
		const relay = draft.relay;
		const requestId = crypto.randomUUID();
		activeTests.current.set(requestId, modelId);
		setRunningTestModels((previous) => [...previous, modelId]);
		setTestModel(modelId);
		const started = Date.now();
		try {
			const result = await onTest(relay.baseUrl, relay.apiKey, modelId, relay.timeoutSeconds, requestId, relay.protocol, relay, true);
			if (activeTests.current.has(requestId)) { completedTests.current.add(requestId); setTestResults((previous) => [...previous.filter((item) => item.modelId !== modelId), { ...result, modelId }]); }
		} catch (cause) {
			if (activeTests.current.has(requestId)) setTestResults((previous) => [...previous.filter((item) => item.modelId !== modelId), { ok: false, latencyMs: Date.now() - started, status: null, error: String(cause), modelId }]);
		} finally {
			activeTests.current.delete(requestId);
			setRunningTestModels((previous) => previous.filter((item) => item !== modelId));
		}
	};
	const stopProviderModelTest = (modelId: string) => {
		for (const [requestId, model] of activeTests.current) if (model === modelId) {
			activeTests.current.delete(requestId);
			void onCancelTest(requestId).catch(() => {});
		}
		setRunningTestModels((previous) => previous.filter((item) => item !== modelId));
	};
	/** Status plus action for a model row; the cell always renders so rows keep their shape. */
	const providerModelTest = (entry: ProviderModelDraft, relay: RelaySpec, preset?: ProviderPreset) => {
		const modelId = entry.model.modelId.trim();
		const running = runningTestModels.includes(modelId) || testBatch.includes(modelId) && testing && !completedTestModels.includes(modelId);
		const tested = testResults.find((item) => item.modelId === modelId);
		const text = running ? "正在测试…" : tested ? `${tested.ok ? "成功" : "失败"} · ${tested.latencyMs} ms${!tested.ok && tested.status ? ` · HTTP ${tested.status}` : ""}${tested.error ? ` · ${tested.error}` : ""}` : "";
		return <div className="provider-model-test">
			{tested && <span className={`test-result ${running ? "muted" : tested.ok ? "ok" : "bad"}`} role="status" title={`${modelId} · ${text}`}>{text}</span>}
			{running
				? <Button type="button" variant="ghost" size="compact" onClick={() => stopProviderModelTest(modelId)}>停止</Button>
				: <Button type="button" variant="ghost" size="compact" disabled={pending || !modelId || !relay.baseUrl.trim() || (!relay.apiKey && !preset?.keyOptional)} onClick={() => void testProviderModel(modelId)}>测试</Button>}
		</div>;
	};

	const submitRelay = async (event: FormEvent) => {
		event.preventDefault();
		if (!draft || draft.kind !== "relay" || pending || testing) return;
		const relay = draft.relay;
		if (!relay.name.trim()) { setError("请填写名称"); return; }
		if (!/^https?:\/\//i.test(relay.baseUrl.trim())) { setError("接口地址必须以 http:// 或 https:// 开头"); return; }
		if (relays.some((item) => item.id !== relay.id && item.name.trim().toLowerCase() === relay.name.trim().toLowerCase())) { setError("名称不能重复"); return; }
		if (draft.isNew && !connectionPassed) { setError("请先通过连接测试再保存"); return; }
		if (draft.isNew && !providerModels.length) { setError("请至少添加一个模型"); return; }
		if (providerModels.some((entry) => !entry.model.modelId.trim())) { setError("模型 ID 不能为空"); return; }
		if (providerModels.some((entry) => !entry.familyId)) { setError("请为无法自动识别的模型选择所属家族"); return; }
		const modelIds = providerModels.map((entry) => entry.model.modelId.trim());
		if (new Set(modelIds).size !== modelIds.length) { setError("供应商内模型 ID 不能重复"); return; }
		for (const family of families) {
			const modelError = validateModels(providerModels.filter((entry) => entry.familyId === family.id).map((entry) => entry.model));
			if (modelError && providerModels.some((entry) => entry.familyId === family.id)) { setError(modelError); return; }
		}
		setPending(true); setError(undefined);
		try {
			const activeModels = providerModels.map((entry) => ({ familyId: entry.familyId!, model: entry.model }));
			const routes = routesFromProviderModels(relay, families, activeModels);
			const saved = await onSaveRelay(relay, routes, [...completedTests.current]);
			if (saved) {
				setNotice(`已保存「${saved.name}」，同步 ${providerModels.length} 个模型到 ${routes.length} 条路线。`);
				setSavedLocation({ relayId: saved.id, familyIds: routes.map((item) => item.familyId) });
				setDraft(undefined);
			} else {
				setError("保存失败，请检查填写内容");
			}
		} finally { setPending(false); }
	};

	// Count configured, included API IDs once per provider across all families.
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

	const batchImpact = providerBatchImpact(relays, families, selected);
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
						<small>任意 OpenAI / Anthropic / Google 兼容地址</small>
					</button>
				</div>
			</div>
		) : draft?.kind === "relay" ? (
			(() => {
				const relay = draft.relay;
				const preset = draft.preset;
				const site = preset?.website;
				return <form className="preset-editor" onInvalidCapture={(event) => {
					if ((event.target as HTMLElement).closest(".settings-advanced")) {
						setAdvanced(true);
						const field = event.target as HTMLElement;
						requestAnimationFrame(() => field.focus());
					}
				}} onSubmit={(event) => void submitRelay(event)}>
					<div className="editor-head">
						<ProviderIcon id={preset?.id ?? ""} name={relay.name} size={20} />
						<h2 id="providers-title">{draft.isNew ? (preset ? preset.name : "自定义供应商") : relay.name}</h2>
						{preset?.familyId && <span className="provider-tag">{FAMILY_LABELS[preset.familyId]} 家族</span>}
						<span className="grow" />
						{site && <button type="button" className="editor-site" onClick={() => openLink(site)} title={site}>{hostOf(site)} ↗</button>}
						<IconButton type="button"  onClick={closeDraft} disabled={pending} aria-label="返回列表"><Icon name="close" /></IconButton>
					</div>
					<p className="muted">{draft.isNew ? "新供应商需先通过连接测试。" : "模型列表会同步到现有家族路线。"}保存时保留各路线的能力与优先级设置。</p>
					<div className="editor-field">
						<label htmlFor="relay-name">名称</label>
						<div className="editor-control">
							<Input id="relay-name" required maxLength={32} placeholder="官方直连 / 硅基低价 / 中转站 A" value={relay.name} onChange={(event) => patchRelay({ name: event.target.value })} disabled={pending} />
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-protocol">API协议</label>
						<div className="editor-control">
							<Select id="relay-protocol" required value={relay.protocol ?? "openai"} onChange={(event) => patchRelay({ protocol: event.target.value as RelayProtocol })} disabled={pending}>
								{RELAY_PROTOCOLS.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.label}</option>)}
							</Select>
							<small>{RELAY_PROTOCOLS.find((protocol) => protocol.id === (relay.protocol ?? "openai"))?.hint}。须与端点实现一致，选择后模型列表与连接测试按该协议请求。</small>
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
							<small>密钥在本机加密保存；已保存密钥指纹可在高级选项中查看。</small>
							{preset?.keysUrl && <Button type="button" variant="ghost" size="compact" className="editor-key-link" onClick={() => openLink(preset.keysUrl)}>获取密钥 ↗</Button>}
						</div>
					</div>
					<div className="editor-field">
						<label htmlFor="relay-base">端点</label>
						<div className="editor-control">
							<Input id="relay-base" required placeholder={relay.protocol === "anthropic" ? "https://api.anthropic.com/v1" : relay.protocol === "google-genai" ? "https://generativelanguage.googleapis.com/v1beta" : relay.protocol === "vertex" ? "https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}" : relay.protocol === "openai-responses" ? "https://api.openai.com/v1" : "https://api.example.com/v1"} value={relay.baseUrl} onChange={(event) => patchRelay({ baseUrl: event.target.value })} disabled={pending} />
							<small>{relay.protocol === "anthropic" ? "Anthropic 兼容根地址（含或不含 /v1 均可），以 http:// 或 https:// 开头。" : relay.protocol === "google-genai" ? "Google 生成式接口根地址，通常以 /v1beta 结尾。" : relay.protocol === "vertex" ? "Vertex AI 接口根地址；连接测试与模型列表需要 API Key，也可使用含项目与区域的完整地址。" : "OpenAI 兼容根地址，以 http:// 或 https:// 开头，包含 /v1 等前缀。"}</small>
						</div>
					</div>
					<section className="provider-model-editor" aria-label="供应商模型配置">
						<div className="provider-model-editor-heading">
							<strong>模型</strong><small>{providerModels.length} 个模型</small>
							<Button type="button" variant="ghost" size="compact" disabled={pending || testing || discoveringModels || !relay.baseUrl || (!relay.apiKey && !preset?.keyOptional)} onClick={() => void discoverProviderModels()}><Icon name="refresh" size={14} />{discoveringModels ? "获取中…" : "获取模型列表"}</Button>
						</div>
						<div className="provider-model-editor-columns" aria-hidden="true"><span>模型 ID</span><span>上下文</span><span>显示名</span><span>测试</span><span /></div>
						{providerModels.map((entry, index) => <div className="provider-model-editor-row" key={index}>
							<div className="provider-model-id-cell">
								<Input aria-label={`模型 ID ${index + 1}`} value={entry.model.modelId} maxLength={256} placeholder="模型 ID" onChange={(event) => patchProviderModel(index, { modelId: event.target.value })} disabled={pending || testing} />
								{entry.familyId ? <small>{FAMILY_LABELS[entry.familyId] ?? entry.familyId}</small> : <small className="provider-model-family-needed">需选择所属家族</small>}
							</div>
							<Input aria-label={`模型 ${index + 1} 上下文窗口`} type="number" min={1} step={1} value={entry.model.contextWindow} onChange={(event) => patchProviderModel(index, { contextWindow: Number(event.target.value) })} disabled={pending || testing} />
							<Input aria-label={`模型 ${index + 1} 显示名`} value={entry.model.alias} maxLength={64} placeholder="可选" onChange={(event) => patchProviderModel(index, { alias: event.target.value })} disabled={pending || testing} />
							{providerModelTest(entry, relay, preset)}
							<IconButton type="button" variant="ghost" size="compact" aria-label={`删除模型 ${index + 1}`} title="从供应商模型列表中移除" onClick={() => removeProviderModel(index)} disabled={pending || testing}><Icon name="trash" size={14} /></IconButton>
							{!entry.familyId && <label className="provider-model-family-select">模型家族<Select aria-label={`模型 ${index + 1} 家族`} value="" onChange={(event) => setProviderModels((previous) => previous.map((item, row) => row === index ? { ...item, familyId: event.target.value } : item))} disabled={pending || testing}><option value="" disabled>选择家族…</option>{Object.entries(FAMILY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></label>}
						</div>)}
						{modelListNotice && <small className="provider-model-list-notice" role="status">{modelListNotice}</small>}
						<Button type="button" variant="ghost" size="compact" className="provider-model-add" disabled={pending || testing} onClick={() => setProviderModels((previous) => [...previous, { familyId: preset?.familyId, model: blankModel() }])}><Icon name="plus" size={14} />添加模型</Button>
					</section>
					<details className="settings-advanced" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
						<summary className="process-disclosure"><DisclosureLabel status={[relay.billingAccountId ? "已设置账户" : "", relay.timeoutSeconds !== 60 ? `超时 ${relay.timeoutSeconds} 秒` : ""].filter(Boolean).join(" · ")}>高级选项</DisclosureLabel></summary>
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
						{!draft.isNew && <p className="muted">已保存密钥指纹：{relays.find((item) => item.id === relay.id)?.apiKey ? keyHint(relays.find((item) => item.id === relay.id)!.apiKey) : "未设置密钥"}</p>}
					</details>
					<p className="muted">保存后可编辑路线</p>
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
				<p className="muted">供应商提供模型访问端点与密钥；模型列表在编辑供应商时配置。共 {relays.length} 个供应商。</p>
				{notice && <div className="family-added-hint" role="status">{notice}{savedLocation?.familyIds.map((familyId) => {
					const route = families.find((item) => item.id === familyId)?.routes.find((item) => item.relayId === savedLocation.relayId);
					return <Button key={familyId} type="button" variant="ghost" size="compact" onClick={() => onOpenRoutes({ familyId, relayId: savedLocation.relayId, routeId: route?.id })}>查看{FAMILY_LABELS[familyId] ?? familyId}路线</Button>;
				})}</div>}
				<div className="settings-toolbar" role="group" aria-label="供应商筛选">
					<Input aria-label="搜索已配置供应商" placeholder="搜索名称或端点…" value={listQuery} onChange={(event) => setListQuery(event.target.value)} />
					<div className="settings-filter-group">{([ ["all", "全部"], ["enabled", "启用"], ["disabled", "停用"] ] as const).map(([value, label]) => <Button key={value} size="compact" variant="ghost" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label} {matchedRelays.filter((relay) => value === "all" || relay.enabled === (value === "enabled")).length}</Button>)}</div>
					<Select aria-label="供应商显示排序" value={view.sort} disabled={pending} onChange={(event) => setView({ ...view, sort: event.target.value as ProviderSort })}><option value="config">配置原顺序</option><option value="name">按名称</option><option value="recent">最近使用</option><option value="status">按状态</option></Select>
					<label className="provider-toggle inline"><input type="checkbox" checked={view.grouped} disabled={pending} onChange={(event) => setView({ ...view, grouped: event.target.checked })} />按来源分组</label>
					<Button disabled={pending} aria-pressed={batch} onClick={() => { setBatch(!batch); setSelected([]); }}>{batch ? "退出批量管理" : "批量管理"}</Button>
					<Button onClick={openPick} disabled={pending || batch}><Icon name="plus" size={14} />添加供应商</Button>
				</div>
				{batch && <div className="settings-toolbar settings-batch-bar" role="group" aria-label="供应商批量操作">
					<label className="provider-toggle inline"><input type="checkbox" aria-label="全选当前结果" checked={!!shownRelays.length && shownRelays.every((relay) => selected.includes(relay.id))} disabled={pending || !shownRelays.length} onChange={(event) => setSelected(event.target.checked ? shownRelays.map((relay) => relay.id) : [])} />全选当前结果</label><span role="status">已选 {selected.length} 个</span>
					{([ ["enable", "批量启用"], ["disable", "批量停用"], ["delete", "批量删除"] ] as const).map(([action, label]) => <Button key={action} variant={action === "delete" ? "danger" : "secondary"} disabled={pending || !selected.length} onClick={() => setBatchAction(action)}>{label}</Button>)}
				</div>}
				<section className="family-card" aria-label="供应商列表">
					{relays.length === 0 && <p className="family-empty">还没添加供应商，点击「添加供应商」选择预设或填写自定义地址。</p>}
					{!shownRelays.length && relays.length > 0 && <p className="family-empty">没有匹配的供应商，请调整搜索或状态筛选。</p>}
					{shownRelays.map((relay, index) => {
						const preset = matchPreset(relay.baseUrl);
						const protocol = RELAY_PROTOCOLS.find((item) => item.id === (relay.protocol ?? "openai"));
						return <Fragment key={relay.id}>{view.grouped && (index === 0 || providerSourceLabel(shownRelays[index - 1].baseUrl) !== providerSourceLabel(relay.baseUrl)) && <h3 className="settings-source-heading">{providerSourceLabel(relay.baseUrl)}</h3>}<div className={`provider-row provider-relay-row ${batch ? "is-selecting" : ""} ${relay.enabled ? "" : "disabled"}`}>
							{batch && <input type="checkbox" aria-label={`选择 ${relay.name}`} checked={selected.includes(relay.id)} disabled={pending} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, relay.id] : ids.filter((id) => id !== relay.id))} />}
							<button type="button" className="provider-relay-btn" onClick={() => openRelay(relay, preset)} disabled={pending || batch} aria-label={`编辑 ${relay.name}`}>
								<ProviderIcon id={preset?.id ?? ""} name={relay.name} size={22} />
								<span className="provider-row-text">
									<span className="provider-row-title"><strong title={relay.name}>{relay.name}</strong><span className="provider-tag">{providerSourceLabel(relay.baseUrl)}</span></span>
									<small className="provider-row-meta"><span className="provider-row-endpoint" title={maskBaseUrl(relay.baseUrl)}>{maskBaseUrl(relay.baseUrl)}</span><span className="provider-row-count">· {protocol?.label ?? "OpenAI"} · {relayModelCount(relay.id) ? `${relayModelCount(relay.id)} 个模型` : "未配置模型"}</span></small>
									<small className="settings-test-history" title="连接测试请求耗时；历史结果不代表当前在线">{settingsTestSummary(latestSettingsTest(metadata.tests, relay.id))}</small>
								</span>
							</button>
							<div className="provider-row-side">
								<label className="switch" title={relay.enabled ? "停用" : "启用"}>
									<input type="checkbox" checked={relay.enabled} disabled={pending || batch} onChange={(event) => { const enabled = event.target.checked; void mutate(() => toggleRelay(relay.id, enabled)); }} aria-label={`${relay.enabled ? "停用" : "启用"} ${relay.name}`} />
									<span className="slider" />
								</label>
								<Icon name="chevron" size={14} />
							</div>
						</div></Fragment>;
					})}
					{(configError || error) && <p className="form-error provider-error" role="alert">{configError || error}</p>}
				</section>
			</>
		)}
		{batchAction && <ProviderBatchDialog operation={batchAction} ids={selected} initialImpact={batchImpact} onPreview={onPreviewBatch} onCommit={async (ids, operation, token) => {
			let success = false;
			await mutate(async () => { success = await onBatch(ids, operation, token); return success; });
			if (success) { setSelected([]); setBatchAction(undefined); setNotice("批量操作已完成"); }
			return success;
		}} pending={pending} error={configError || error} onClose={() => setBatchAction(undefined)} onOpenFamily={(familyId) => { setSelected([]); setBatchAction(undefined); onOpenRoutes({ familyId }); }} />}
		{removing && <ConfirmDialog title={removing.title} description={removing.description} onConfirm={() => void mutate(removing.action)} onClose={() => setRemoving(undefined)} />}
	</div>;
});
