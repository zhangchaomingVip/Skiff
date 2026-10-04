import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RuntimeOffer } from "./modelFamilies";
import type { Currency } from "./types";

const FAMILY_IDS = ["deepseek", "kimi", "glm"] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];

/** A provider channel: one endpoint, key, model and price inside a family. */
export interface ProviderSpec {
	id: string;
	displayName: string;
	baseUrl: string;
	apiKey: string;
	modelId: string;
	inputCost: number;
	outputCost: number;
	currency: Currency;
	maxTokens: number | null;
	legacyProvider?: string | null;
	streaming: boolean;
	tools: boolean;
	vision: boolean;
	reasoning: boolean;
	timeoutSeconds: number;
	enabled: boolean;
}

export interface ModelFamily {
	id: string;
	displayName: string;
	providers: ProviderSpec[];
	defaultProviderId: string | null;
}

export interface FamiliesConfig {
	version: number;
	families: ModelFamily[];
	autoFailover: boolean;
}

export interface TestResult {
	ok: boolean;
	latencyMs: number;
	status: number | null;
	error: string | null;
}

export const FAMILY_LABELS: Record<string, string> = { deepseek: "DeepSeek", kimi: "Kimi", glm: "GLM" };

export function blankProvider(): ProviderSpec {
	return {
		id: "", displayName: "", baseUrl: "", apiKey: "", modelId: "",
		inputCost: 0, outputCost: 0, currency: "CNY", maxTokens: null, streaming: true, tools: true, vision: false, reasoning: false,
		timeoutSeconds: 60, enabled: true,
	};
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
 * Owns the family configuration. The first load also runs the one-time
 * migration from pi's provider list; afterwards the picker and settings page
 * share this state so both stay in sync without extra invokes.
 */
export function useModelFamilies() {
	const [config, setConfig] = useState<FamiliesConfig>();
	const [offers, setOffers] = useState<RuntimeOffer[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	const refresh = useCallback(async () => {
		setLoading(true); setError(undefined);
		try {
			await invoke<boolean>("migrate_provider_config");
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
	const families = FAMILY_IDS.map((id) => config?.families?.find((family) => family.id === id) ?? { id, displayName: FAMILY_LABELS[id], providers: [], defaultProviderId: null });
	const complete = FAMILY_IDS.every((id) => hasFamily(config, id));

	return {
		config, families, offers, loading, error, complete,
		fallback: !loading && (!!error || !complete),
		refresh,
		clearError: () => setError(undefined),
		save: (familyId: string, provider: ProviderSpec) => run("save_family_provider", { familyId, provider }),
		remove: (familyId: string, providerId: string) => run("delete_family_provider", { familyId, providerId }),
		reorder: (familyId: string, providerIds: string[]) => run("reorder_family_providers", { familyId, providerIds }),
		setEnabled: (familyId: string, providerId: string, enabled: boolean) => run("set_family_provider_enabled", { familyId, providerId, enabled }),
		setDefault: (familyId: string, providerId: string | null) => run("set_family_default_provider", { familyId, providerId }),
		setAutoFailover: (autoFailover: boolean) => run("set_family_auto_failover", { autoFailover }),
		test: (baseUrl: string, apiKey: string, modelId: string, timeoutSeconds: number) =>
			invoke<TestResult>("test_provider_connection", { baseUrl, apiKey, modelId, timeoutSeconds }),
	};
}
