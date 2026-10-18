import type { CatalogEntry } from "../rpc/pricingPage";
import type { OfficialPage } from "../rpc/officialPages";

/** Structured latest-model info for one family, merged from both sources. */
export interface FamilyLatest {
	familyId: string;
	/** Every on-sale model ID seen across both sources, lowercase. */
	modelIds: string[];
	/** The newest version group's model IDs, best variant first (flagship, flash, …). */
	latestGroup: string[];
	/** Base version of the latest group, e.g. "glm-5.4"; undefined when unknown. */
	latestVersion?: string;
	/** Freshness per model ID, when a source reports it. */
	updated: ReadonlyMap<string, string>;
}

export const LATEST_FAMILIES = ["deepseek", "kimi", "glm"] as const;
export type LatestFamilyId = (typeof LATEST_FAMILIES)[number];

/** Strips a known variant suffix so `glm-5.3-flash` and `glm-5.3` share a group. */
const VARIANT_SUFFIX = /-(?:flashx?|turbo|vision|airx?|long|thinking|highspeed)$/i;

/** Base version key of a model ID: the basename without vendor prefixes and variant suffixes. */
export function baseVersion(modelId: string): string {
	const name = modelId.trim().split("/").pop() ?? "";
	let base = name.toLowerCase();
	// Repeat: `glm-4.1v-thinking-flash` collapses through two suffixes.
	for (let previous = ""; previous !== base;) {
		previous = base;
		base = base.replace(VARIANT_SUFFIX, "");
	}
	return base || name.toLowerCase();
}

/** True when the model is marked retired by either source. */
function isRetired(status: string | null | undefined, officialRetired = false): boolean {
	if (officialRetired) return true;
	return /deprecated|retired|已下线|停售|弃用|退役/i.test(status ?? "");
}

const NAME_KEYS = ["模型", "模型名称", "模型ID", "模型 ID", "model", "modelId", "model_id", "id", "name"];
const STATUS_KEYS = ["状态", "status"];
const RETIRED_HINT = /已下线|停售|弃用|退役|deprecated|retired/i;

function cellText(cell: unknown): string {
	if (typeof cell === "string") return cell;
	if (typeof cell === "number") return String(cell);
	return "";
}

function stripTags(html: string): string {
	return html.replace(/<[^>]*>/g, " ").replace(/&[a-zA-Z#0-9]+;/g, " ");
}

/** Model IDs extracted from one official page body (HTML tables or embedded JSON rows). */
export function parseOfficialPage(page: OfficialPage): Map<string, { retired: boolean; updated?: string }> {
	const found = new Map<string, { retired: boolean; updated?: string }>();
	const remember = (rawId: string, retired = false, updated?: string) => {
		const id = rawId.trim().toLowerCase();
		if (!id || id.length > 120 || /\s/.test(id)) return;
		// Headings, nav links and prose IDs like `glm-5.3-` never match an API id shape.
		if (!/^[a-z][a-z0-9._/-]*$/.test(id)) return;
		const existing = found.get(id);
		if (existing) {
			found.set(id, { retired: retired || existing.retired, updated: updated ?? existing.updated });
			return;
		}
		found.set(id, { retired, updated });
	};

	// Kimi (Mintlify) embeds the price table as JS data: rows:[[`kimi-k3`, ...]].
	for (const match of page.body.matchAll(/rows:\s*(\[\[[\s\S]*?\]\])/g)) {
		try {
			const rows = JSON.parse(match[1].replace(/`/g, "\""));
			for (const row of rows) if (Array.isArray(row)) remember(cellText(row[0]));
		} catch { /* Continue with other extraction paths. */ }
	}

	// HTML tables: either the first column lists model names (GLM) or the header row does (DeepSeek).
	for (const table of page.body.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
		const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
		const matrix = rows.map((row) => (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) => stripTags(cell).trim()));
		if (!matrix.length) continue;
		const header = matrix[0];
		const nameIndex = header.findIndex((cell) => NAME_KEYS.some((key) => cell.toLowerCase() === key.toLowerCase()));
		if (nameIndex >= 0) {
			const statusIndex = header.findIndex((cell) => STATUS_KEYS.some((key) => cell.toLowerCase() === key.toLowerCase()));
			for (const row of matrix.slice(1)) {
				const name = row[nameIndex];
				if (name) remember(name, statusIndex >= 0 && RETIRED_HINT.test(row[statusIndex] ?? ""));
			}
			continue;
		}
		// DeepSeek layout: model IDs live in the header row, one column each.
		for (const cell of header) if (/^[a-z][a-z0-9._/-]*$/i.test(cell.trim())) remember(cell, false);
	}

	// Fallback: bare ID-shaped tokens anywhere in the page (nav links included but shape-filtered).
	if (!found.size) for (const match of page.body.matchAll(/[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+/gi)) remember(match[0]);
	return found;
}

/** Non-chat products (OCR, TTS, …) never belong in a version group. */
const NON_CHAT_ID = /(?:^|[-_.])(?:ocr|embedding|embed|rerank|realtime|tts|asr|voice|image|video|cogview|cogvideo)(?:$|[-_.])/i;

/**
 * Merges official pages (fresh, authoritative) with the models.dev catalog
 * (structured fallback) into per-family latest info. models.dev supplies
 * `last_updated` and deprecated flags; official pages win on retirement.
 */
export function familyLatest(pages: OfficialPage[], catalog: CatalogEntry[]): Map<string, FamilyLatest> {
	const result = new Map<string, FamilyLatest>();
	for (const familyId of LATEST_FAMILIES) {
		const page = pages.find((item) => item.familyId === familyId);
		const official = page ? parseOfficialPage(page) : new Map<string, { retired: boolean; updated?: string }>();
		const entries = catalog.filter((entry) => entry.provider === familyId || (familyId === "kimi" && entry.provider === "moonshotai"));
		const modelIds = new Set<string>([...official.keys(), ...entries.map((entry) => entry.modelId.toLowerCase())]);
		const entryOf = (id: string) => entries.find((entry) => entry.modelId.toLowerCase() === id);
		// Score every version group by its newest on-sale member.
		const groups = new Map<string, { ids: string[]; updated: string }>();
		const updated = new Map<string, string>();
		for (const id of modelIds) {
			if (NON_CHAT_ID.test(id)) continue;
			const retired = official.get(id)?.retired || isRetired(entryOf(id)?.status, false);
			if (retired) continue;
			const date = official.get(id)?.updated ?? entryOf(id)?.updated ?? undefined;
			if (date) updated.set(id, date);
			const base = baseVersion(id);
			const group = groups.get(base);
			if (!group) groups.set(base, { ids: [id], updated: date ?? "" });
			else {
				group.ids.push(id);
				if (date && date > group.updated) group.updated = date;
			}
		}
		const latest = [...groups.entries()].filter(([, group]) => group.ids.length).sort((a, b) => b[1].updated.localeCompare(a[1].updated))[0];
		result.set(familyId, {
			familyId,
			modelIds: [...modelIds],
			latestGroup: latest ? latest[1].ids : [],
			latestVersion: latest?.[0],
			updated,
		});
	}
	return result;
}

export interface FamilyUpdate {
	familyId: string;
	/** Model IDs from the latest version group the user has not configured. */
	newIds: string[];
	latestVersion?: string;
}

/**
 * "New model available" = every member of the latest version group is
 * unconfigured, and none of them shares a version group with a configured ID
 * (configuring `glm-5.3-flash` already covers `glm-5.3`).
 */
export function familyUpdates(latest: Map<string, FamilyLatest>, configuredIds: ReadonlyMap<string, ReadonlySet<string>>): FamilyUpdate[] {
	const updates: FamilyUpdate[] = [];
	for (const familyId of LATEST_FAMILIES) {
		const info = latest.get(familyId);
		if (!info?.latestGroup.length) continue;
		const configured = configuredIds.get(familyId);
		const covered = (id: string) => !!configured && [...configured].some((item) => baseVersion(item) === baseVersion(id));
		const newIds = info.latestGroup.filter((id) => !covered(id));
		if (newIds.length === info.latestGroup.length) updates.push({ familyId, newIds, latestVersion: info.latestVersion });
	}
	return updates;
}

export type RecommendationReason = "latest" | "fallback-available" | "offline";

export interface Recommendation {
	recommended: string[];
	reason: RecommendationReason;
}

/** Flagship (exact version) first, then flash; flashx and others come last. */
const VARIANT_RANK = (id: string) => baseVersion(id) === id ? 0 : /-flash$/i.test(id) ? 1 : 2;

/**
 * Picks at most two models to preselect for a fresh route: the flagship and
 * the flash variant of the latest version group the relay actually serves.
 * When the catalog is offline or the relay predates the latest group, falls
 * back to the two newest IDs the relay serves (catalog freshness); with no
 * usable data at all it returns an empty set and the UI keeps its current
 * behaviour.
 */
export function pickRecommendedIds(discovered: readonly string[], latest: ReadonlyMap<string, FamilyLatest> | undefined, familyId: string): Recommendation {
	const available = [...new Set(discovered.map((id) => id.trim()).filter(Boolean))];
	if (!available.length) return { recommended: [], reason: "offline" };
	const info = latest?.get(familyId);
	if (info?.latestGroup.length) {
		const lower = new Set(available.map((id) => id.toLowerCase()));
		const served = info.latestGroup.filter((id) => lower.has(id));
		if (served.length) return { recommended: served.sort((a, b) => VARIANT_RANK(a) - VARIANT_RANK(b)).slice(0, 2), reason: "latest" };
	}
	// Catalog present but the relay serves nothing from the latest group: rank
	// the relay's own models by catalog freshness.
	const ranks = info ? new Map(info.updated) : undefined;
	const dated = available.map((id) => ({ id, updated: ranks?.get(id.toLowerCase()) ?? "" }));
	const anyDates = dated.some((item) => item.updated);
	if (!anyDates) return { recommended: [], reason: "offline" };
	return { recommended: dated.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 2).map((item) => item.id), reason: "fallback-available" };
}
