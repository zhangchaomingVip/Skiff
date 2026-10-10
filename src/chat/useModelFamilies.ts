import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RuntimeOffer } from "./modelFamilies";
import type { Currency } from "./types";

const FAMILY_IDS = ["deepseek", "kimi", "glm"] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

export interface ModelSpec {
	modelId: string;
	/** Undefined retains the legacy route default; a boolean overrides it. */
	vision?: boolean;
	alias: string;
	inputCost: number;
	outputCost: number;
	cacheReadCost: number;
	cacheWriteCost: number;
	currency: Currency;
	maxTokens: number;
	contextWindow: number;
}

export const blankModel = (): ModelSpec => ({ modelId: "", alias: "", inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, currency: "CNY", maxTokens: 8192, contextWindow: 128000 });

export function validateModels(models: ModelSpec[]): string | undefined {
	if (!models.length) return "请至少添加一个模型，补全线路配置";
	const ids = new Set<string>();
	for (const model of models) {
		const id = model.modelId.trim();
		if (!id) return "模型 ID 不能为空";
		if (ids.has(id)) return "同一线路内模型 ID 不能重复";
		ids.add(id);
		if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0 || !Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0) return "上下文窗口和默认最大输出必须为正整数";
		if (model.maxTokens > model.contextWindow) return "默认最大输出不能超过上下文窗口";
		if (![model.inputCost, model.outputCost].every((cost) => Number.isFinite(cost) && cost >= 0)) return "模型单价必须为非负数";
		if (model.alias.length > 64 || [...model.alias].some((char) => /[\u0000-\u001f\u007f]/.test(char))) return "模型别名不能超过 64 个字符或包含控制字符";
		if (![model.cacheReadCost, model.cacheWriteCost].every((cost) => Number.isFinite(cost) && cost >= 0)) return "缓存单价必须为非负数";
	}
	return undefined;
}

/** A relay is one access point: a base URL plus one API key, shared by routes. */
export interface RelaySpec {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	timeoutSeconds: number;
	enabled: boolean;
	billingAccountId: string;
	excludedModelIds?: string[];
}

/** A route binds one relay to one family with its served models. */
export interface RouteSpec {
	id: string;
	relayId: string;
	enabled: boolean;
	models: ModelSpec[];
	streaming: boolean;
	tools: boolean;
	vision: boolean;
	reasoning: boolean;
}

export interface ModelFamily {
	id: string;
	displayName: string;
	routes: RouteSpec[];
	defaultRouteId: string | null;
}

export interface FamiliesConfig {
	version: number;
	relays: RelaySpec[];
	families: ModelFamily[];
	autoFailover: boolean;
	autoRetry: boolean;
	usdCnyRate: number;
}

export interface TestResult {
	ok: boolean;
	latencyMs: number;
	status: number | null;
	error: string | null;
}

export const FAMILY_LABELS: Record<string, string> = { deepseek: "DeepSeek", kimi: "Kimi", glm: "GLM" };

export function blankRelay(): RelaySpec {
	return { id: "", name: "", baseUrl: "", apiKey: "", timeoutSeconds: 60, enabled: true, billingAccountId: "", excludedModelIds: [] };
}

export function blankRoute(relayId = ""): RouteSpec {
	return { id: "", relayId, enabled: true, models: [blankModel()], streaming: true, tools: true, vision: false, reasoning: false };
}

/** Keeps the last four characters visible, the way API keys are shown elsewhere. */
export function maskKey(key: string): string {
	if (!key) return "";
	return key.length <= 4 ? "…" + key : "…" + key.slice(-4);
}

/** Hides the credential and the path shape in list rows. */
export function maskBaseUrl(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		const path = url.pathname.replace(/\/+$/, "");
		return url.host + (path && path !== "/v1" ? "/…" : path);
	} catch {
		return baseUrl;
	}
}

const hasFamily = (config: FamiliesConfig | undefined, id: string) => !!config?.families?.some((family) => family.id === id);

/**
 * Owns the relay and route configuration. The picker and settings page share
 * this state so both stay in sync without extra invokes.
 */
export function useModelFamilies() {
	const [config, setConfig] = useState<FamiliesConfig>();
	const [offers, setOffers] = useState<RuntimeOffer[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	const refresh = useCallback(async () => {
		setLoading(true); setError(undefined);
		try {
			const [next, runtime] = await Promise.all([
				invoke<FamiliesConfig>("list_model_families"),
				invoke<RuntimeOffer[]>("list_model_runtime"),
			]);
			setConfig(next); setOffers(runtime);
		} catch (e) { setError(String(e)); }
		finally { setLoading(false); }
	}, []);

	useEffect(() => { void refresh(); }, [refresh]);

	const run = useCallback(async (command: string, args: Record<string, unknown>) => {
		setError(undefined);
		try {
			const next = await invoke<FamiliesConfig>(command, args);
			// Provider keys come from Rust's sanitiser, so re-read the runtime view
			// instead of rebuilding it here.
			const runtime = await invoke<RuntimeOffer[]>("list_model_runtime");
			setConfig(next); setOffers(runtime);
			return true;
		} catch (e) { setError(String(e)); return false; }
	}, []);

	// A missing or malformed payload falls back to pi's own model list rather
	// than blanking the composer.
	const families = useMemo(() => FAMILY_IDS.map((id) => config?.families?.find((family) => family.id === id) ?? { id, displayName: FAMILY_LABELS[id], routes: [], defaultRouteId: null }), [config]);
	const complete = FAMILY_IDS.every((id) => hasFamily(config, id));

	return {
		config, families, relays: config?.relays ?? [], offers, loading, error, complete,
		fallback: !loading && (!!error || !complete),
		usdCnyRate: config?.usdCnyRate ?? 7.2,
		refresh,
		clearError: () => setError(undefined),
		// Resolves to the saved relay (its id is minted server-side) so the
		// settings page can point follow-up route editing at it.
		saveRelay: async (relay: RelaySpec) => {
			setError(undefined);
			try {
				const next = await invoke<FamiliesConfig>("save_relay", { relay });
				const runtime = await invoke<RuntimeOffer[]>("list_model_runtime");
				setConfig(next); setOffers(runtime);
				return next.relays.find((item) => item.name.trim().toLowerCase() === relay.name.trim().toLowerCase());
			} catch (e) { setError(String(e)); return undefined; }
		},
		deleteRelay: (relayId: string) => run("delete_relay", { relayId }),
		setRelayEnabled: (relayId: string, enabled: boolean) => run("set_relay_enabled", { relayId, enabled }),
		saveRoute: (familyId: string, route: RouteSpec) => run("save_route", { familyId, route }),
		deleteRoute: (familyId: string, relayId: string) => run("delete_route", { familyId, relayId }),
		reorderRoutes: (familyId: string, relayIds: string[]) => run("reorder_routes", { familyId, relayIds }),
		setDefaultRoute: (familyId: string, relayId: string | null) => run("set_default_route", { familyId, relayId }),
		setAutoFailover: (autoFailover: boolean) => run("set_family_auto_failover", { autoFailover }),
		setAutoRetry: (autoRetry: boolean) => run("set_family_auto_retry", { autoRetry }),
		setUsdCnyRate: (rate: number) => run("set_usd_cny_rate", { rate }),
		test: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string) =>
			invoke<TestResult>("test_provider_connection", { baseUrl, apiKey, modelId, timeoutSeconds, requestId }),
		cancelTest: (requestId: string) => invoke("cancel_provider_test", { requestId }),
		discover: (baseUrl: string, apiKey: string) => invoke<string[]>("discover_relay_models", { baseUrl, apiKey }),
	};
}

