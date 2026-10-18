import { invoke } from "@tauri-apps/api/core";

/** One official docs page body, cached Rust-side for 6h. */
export interface OfficialPage {
	familyId: string;
	url: string;
	body: string;
	fetchedAt: number;
}

export interface OfficialPagesResponse {
	pages: OfficialPage[];
	/** True when at least one family fell back to an expired cache entry. */
	stale: boolean;
}

/** Official per-family model pages (fresh source); models.dev remains the fallback. */
export function fetchOfficialPages(refresh = false): Promise<OfficialPagesResponse> {
	return invoke<OfficialPagesResponse>("fetch_official_pages", { refresh });
}
