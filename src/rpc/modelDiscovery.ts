import { invoke } from "@tauri-apps/api/core";
import type { RelayProtocol, TestResult } from "../chat/useModelFamilies";

export function probeRelayEndpoint(baseUrl: string, apiKey: string, protocol?: RelayProtocol): Promise<TestResult> {
	return invoke<TestResult>("probe_relay_endpoint", { baseUrl, apiKey, protocol });
}

/** A model reported by an OpenAI-compatible `/models` endpoint, with the
 * capability flags Skiff can act on. */
export interface DiscoveredModel {
	id: string;
	reasoning: boolean;
	vision: boolean;
	tools: boolean;
}

export function discoverModels(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
	return invoke<DiscoveredModel[]>("discover_relay_models", { baseUrl, apiKey });
}
