import { invoke } from "@tauri-apps/api/core";
import type { FetchedPage } from "../chat/pricingPage";

export function fetchPricingPage(url: string): Promise<FetchedPage> {
	return invoke<FetchedPage>("fetch_pricing_page", { url });
}

export interface ExtractPricingInput {
	baseUrl: string;
	apiKey: string;
	modelId: string;
	instruction: string;
	images: string[];
}

export interface ExtractPricingResult {
	text: string;
	promptTokens: number | null;
	completionTokens: number | null;
}

/** One-shot vision extraction against the user's own relay; spend is consented in the UI before calling. */
export function extractPricingTable(input: ExtractPricingInput): Promise<ExtractPricingResult> {
	return invoke<ExtractPricingResult>("extract_pricing_table", { ...input });
}

export interface CatalogEntry {
	provider: string;
	modelId: string;
	name: string;
	inputCost: number;
	outputCost: number;
	contextWindow: number;
	maxTokens: number;
	vision: boolean;
	tools: boolean;
	reasoning: boolean;
	status: string | null;
	updated: string | null;
}

export interface CatalogResponse {
	models: CatalogEntry[];
	stale: boolean;
	fetchedAt: number;
}

/** Official catalog (models.dev) pruned to the supported families, 24h disk cache. */
export function fetchPublicCatalog(): Promise<CatalogResponse> {
	return invoke<CatalogResponse>("fetch_public_catalog");
}
