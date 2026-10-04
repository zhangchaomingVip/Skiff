import { invoke } from "@tauri-apps/api/core";
import type { FetchedPage } from "../chat/pricingPage";

export function fetchPricingPage(url: string): Promise<FetchedPage> {
	return invoke<FetchedPage>("fetch_pricing_page", { url });
}
