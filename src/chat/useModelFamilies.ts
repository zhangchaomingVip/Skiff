import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RuntimeOffer } from "./modelFamilies";
import type { Currency } from "./types";
import type { DiscoveredModel } from "../rpc/modelDiscovery";

const FAMILY_IDS = ["deepseek", "kimi", "glm", "auto"] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

/** pi's thinking levels, lowest first; `off` is always available and implicit. */
export const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Levels pi offers when a model declares nothing, so the UI matches it. */
export const DEFAULT_THINKING_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high"];

/** Keeps pi's order and drops duplicates or unknown values from stored data. */
export function normalizeThinkingLevels(levels: readonly string[] | undefined): ThinkingLevel[] {
	const accepted = new Set(levels ?? []);
	return THINKING_LEVELS.filter((level) => accepted.has(level));
}

/** What a model actually advertises: its own choice, else the route default. */
export function resolveThinkingLevels(levels: readonly string[] | undefined, routeLevels: readonly string[] | undefined): ThinkingLevel[] {
	return levels?.length ? normalizeThinkingLevels(levels) : normalizeThinkingLevels(routeLevels);
}

export interface ModelSpec {
	modelId: string;
	/** Undefined retains the legacy route default; a boolean overrides it. */
	vision?: boolean;
	/** Undefined inherits the route's levels; a list overrides them. */
	thinkingLevels?: ThinkingLevel[];
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
	if (!models.length) return "请至少添加一个模型，补全路线配置";
	const ids = new Set<string>();
	for (const model of models) {
		const id = model.modelId.trim();
		if (!id) return "模型 ID 不能为空";
		if (ids.has(id)) return "同一路线内模型 ID 不能重复";
		ids.add(id);
		if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0 || !Number.isSafeInteger(model.maxTokens) || model.maxTokens <= 0) return "上下文窗口和默认最大输出必须为正整数";
		if (model.maxTokens > model.contextWindow) return "默认最大输出不能超过上下文窗口";
		if (![model.inputCost, model.outputCost].every((cost) => Number.isFinite(cost) && cost >= 0)) return "模型单价必须为非负数";
		if (model.alias.length > 64 || [...model.alias].some((char) => /[\u0000-\u001f\u007f]/.test(char))) return "模型别名不能超过 64 个字符或包含控制字符";
		if (![model.cacheReadCost, model.cacheWriteCost].every((cost) => Number.isFinite(cost) && cost >= 0)) return "缓存单价必须为非负数";
	}
	return undefined;
}

/** Wire protocols Skiff can speak to a provider; each maps to pi's own API. */
export const RELAY_PROTOCOLS = [
	{ id: "kimi", label: "Kimi", hint: "Kimi / Moonshot 官方接口", api: "openai-completions" },
	{ id: "openai", label: "OpenAI", hint: "OpenAI Chat Completions 兼容接口", api: "openai-completions" },
	{ id: "openai-responses", label: "OpenAI Responses", hint: "OpenAI Responses 接口", api: "openai-responses" },
	{ id: "anthropic", label: "Anthropic", hint: "Anthropic Messages 接口", api: "anthropic-messages" },
	{ id: "google-genai", label: "Google GenAI", hint: "Google Gemini 生成式接口", api: "google-generative-ai" },
	{ id: "vertex", label: "Vertex AI", hint: "Google Vertex AI 接口", api: "google-vertex" },
] as const;

export type RelayProtocol = (typeof RELAY_PROTOCOLS)[number]["id"];

export const DEFAULT_RELAY_PROTOCOL: RelayProtocol = "openai";

/** A relay is one access point: a base URL plus one API key, shared by routes. */
export interface RelaySpec {
	id: string;
	name: string;
	baseUrl: string;
	apiKey: string;
	/** Wire protocol; absent means the legacy OpenAI-compatible default. */
	protocol?: RelayProtocol;
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
	/** Default thinking levels for every model on this route. */
	thinkingLevels?: ThinkingLevel[];
}

export interface ModelFamily {
	id: string;
	displayName: string;
	routes: RouteSpec[];
	defaultRouteId: string | null;
}

export interface RelayRouteSpec {
	familyId: string;
	route: RouteSpec;
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

export const FAMILY_LABELS: Record<string, string> = { deepseek: "DeepSeek", kimi: "Kimi", glm: "GLM", auto: "Auto" };

export function blankRelay(): RelaySpec {
	return { id: "", name: "", baseUrl: "", apiKey: "", protocol: DEFAULT_RELAY_PROTOCOL, timeoutSeconds: 60, enabled: true, billingAccountId: "", excludedModelIds: [] };
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
		saveRelay: async (relay: RelaySpec, routes: RelayRouteSpec[] = []) => {
			setError(undefined);
			try {
				const next = await invoke<FamiliesConfig>("save_relay", { relay, routes });
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
		test: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number, requestId?: string, protocol?: RelayProtocol) =>
			invoke<TestResult>("test_provider_connection", { baseUrl, apiKey, modelId, protocol, timeoutSeconds, requestId }),
		cancelTest: (requestId: string) => invoke("cancel_provider_test", { requestId }),
		discover: (baseUrl: string, apiKey: string, protocol?: RelayProtocol) => invoke<DiscoveredModel[]>("discover_relay_models", { baseUrl, apiKey, protocol }),
	};
}

