import { invoke } from "@tauri-apps/api/core";

export function discoverModels(baseUrl: string, apiKey: string): Promise<string[]> {
	return invoke<string[]>("discover_relay_models", { baseUrl, apiKey });
}
