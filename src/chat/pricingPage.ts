import type { Currency } from "./types";

/** A page fetched by the Rust side: final URL after redirects plus the raw body. */
export interface FetchedPage {
	url: string;
	contentType: string;
	body: string;
}

/** One model parsed out of a pricing source, normalised to per-1M-token costs. */
export interface PricedModel {
	modelId: string;
	inputCost: number;
	outputCost: number;
	currency: Currency;
	contextWindow: number | null;
	maxTokens: number | null;
	streaming: boolean;
	tools: boolean;
	vision: boolean;
	reasoning: boolean;
	note: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const ID_KEYS = ["id", "modelId", "model_id", "model", "slug", "name"];
const INPUT_KEYS = ["inputPrice", "inputCost", "input", "input_cost", "inputPricePerMillion", "promptPrice", "prompt_price", "prompt", "inPrice"];
const OUTPUT_KEYS = ["outputPrice", "outputCost", "output", "output_cost", "outputPricePerMillion", "completionPrice", "completion_price", "completion", "outPrice"];
const NESTED_PRICE_KEYS = ["pricing", "prices", "price", "cost", "costs"];
const CURRENCY_KEYS = ["currency", "currencyCode", "unitCurrency"];
const BILLING_UNIT_KEYS = ["billingUnit", "unitTokens", "tokensPerUnit"];
const CONTEXT_KEYS = ["contextWindow", "contextLength", "context_length", "maxContext", "context"];
const MAX_TOKENS_KEYS = ["maxOutputTokens", "max_output_tokens", "max_tokens", "maxCompletionTokens", "maxTokens", "maxOutput"];
const WRAP_KEYS = ["data", "models", "list", "items", "results", "records", "rows", "result"];
const NON_CHAT_TYPE = /embed|video|audio|image-gen|image_gen|tts|rerank|moderation|moderate|moderations/;

const STATUS_NOTES: Record<string, string> = {
	testing: "测试中",
	beta: "内测",
	alpha: "内测",
	preview: "预览",
	deprecated: "已弃用",
	retired: "已下线",
	maintenance: "维护中",
};

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
	}
	return undefined;
}

/** Loose number parser for price fields: "8.00000000", "¥8/百万", "0.000008". */
function looseNumber(text: string): number | undefined {
	const cleaned = text.replace(/[^0-9.+-]/g, " ").trim();
	if (!cleaned) return undefined;
	const match = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
	if (!match) return undefined;
	const value = Number(match[0]);
	return Number.isFinite(value) ? value : undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string") {
			const parsed = looseNumber(value);
			if (parsed !== undefined) return parsed;
		}
	}
	return undefined;
}

/** Count parser that understands K/M suffixes: "200K" → 200000, "1.5M" → 1500000. */
function countNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
		if (typeof value === "string") {
			const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kKmM])?/);
			if (match) {
				const base = Number(match[1]);
				const scale = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
				const scaled = Math.round(base * scale);
				if (scaled > 0) return scaled;
			}
		}
	}
	return undefined;
}

function normalizeCurrency(text: string | undefined): Currency | undefined {
	if (!text) return undefined;
	if (/cny|rmb|¥|￥|元|人民币/i.test(text)) return "CNY";
	if (/usd|us\$|\$|美元|美金/i.test(text)) return "USD";
	return undefined;
}

function capability(entry: Record<string, unknown>, names: string[], fallback: boolean): boolean {
	const caps = entry["capabilities"];
	const source = isRecord(caps) ? caps : entry;
	for (const name of names) {
		const value = source[name];
		if (typeof value === "boolean") return value;
		if (typeof value === "string") return !/^(false|0|no|off)$/i.test(value.trim());
	}
	return fallback;
}

function hasNestedPricing(entry: Record<string, unknown>): boolean {
	return NESTED_PRICE_KEYS.some((key) => isRecord(entry[key]) && (firstNumber(entry[key], INPUT_KEYS) !== undefined || firstNumber(entry[key], OUTPUT_KEYS) !== undefined));
}

function entryToModel(entry: Record<string, unknown>): PricedModel | undefined {
	const modelId = firstString(entry, ID_KEYS);
	if (!modelId || modelId.length > 120 || /\s/.test(modelId)) return undefined;
	const type = firstString(entry, ["type", "kind", "modelType"])?.toLowerCase() ?? "";
	if (NON_CHAT_TYPE.test(type)) return undefined;
	const modalities = entry["modalities"];
	if (Array.isArray(modalities) && !modalities.some((item) => String(item).toLowerCase() === "text")) return undefined;

	let input = firstNumber(entry, INPUT_KEYS);
	let output = firstNumber(entry, OUTPUT_KEYS);
	let currency: Currency | undefined;
	for (const key of NESTED_PRICE_KEYS) {
		if (input !== undefined && output !== undefined && currency !== undefined) break;
		const nested = entry[key];
		if (!isRecord(nested)) continue;
		input ??= firstNumber(nested, INPUT_KEYS);
		output ??= firstNumber(nested, OUTPUT_KEYS);
		currency ??= normalizeCurrency(firstString(nested, CURRENCY_KEYS));
	}
	currency ??= normalizeCurrency(firstString(entry, CURRENCY_KEYS)) ?? "CNY";

	if (input === undefined && output === undefined) return undefined;
	// Normalise to per-1M-token costs. Explicit billingUnit wins (tokenrhythm
	// reports per billingUnit tokens); otherwise per-token prices (OpenRouter
	// style, e.g. 0.000008) get scaled up.
	const unit = firstNumber(entry, BILLING_UNIT_KEYS);
	const scale = (value: number) => (unit && unit > 0 ? (value / unit) * 1_000_000 : value);
	let inputCost = input === undefined ? 0 : scale(input);
	let outputCost = output === undefined ? 0 : scale(output);
	if (!(unit && unit > 0)) {
		const present = [inputCost, outputCost].filter((value) => value > 0);
		if (present.length && present.every((value) => value < 0.01)) {
			inputCost *= 1_000_000;
			outputCost *= 1_000_000;
		}
	}
	inputCost = Math.max(0, Number(inputCost.toFixed(6)));
	outputCost = Math.max(0, Number(outputCost.toFixed(6)));

	const status = firstString(entry, ["status", "state"])?.toLowerCase() ?? "";
	const note = status && !/online|active|stable|live/.test(status) ? STATUS_NOTES[status] ?? status : null;
	return {
		modelId,
		inputCost,
		outputCost,
		currency,
		contextWindow: countNumber(entry, CONTEXT_KEYS) ?? null,
		maxTokens: countNumber(entry, MAX_TOKENS_KEYS) ?? null,
		streaming: capability(entry, ["streaming", "stream", "supportsStream"], true),
		tools: capability(entry, ["tools", "functionCall", "supportsTools"], true),
		vision: capability(entry, ["vision", "image", "supportsVision", "multimodal"], false),
		reasoning: capability(entry, ["reasoning", "think", "supportsReasoning"], false),
		note,
	};
}

function dedupe(models: PricedModel[]): PricedModel[] {
	const seen = new Set<string>();
	return models.filter((model) => {
		const id = model.modelId.toLowerCase();
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

/** Scores candidate arrays by how many entries carry both prices; best wins. */
function parseModelArray(candidates: unknown[][]): PricedModel[] {
	let best: PricedModel[] = [];
	let bestScore = -1;
	for (const candidate of candidates) {
		const models = dedupe(candidate.filter(isRecord).map(entryToModel).filter((model): model is PricedModel => !!model));
		if (!models.length) continue;
		const score = models.filter((model) => model.inputCost > 0 && model.outputCost > 0).length;
		if (score > bestScore) {
			best = models;
			bestScore = score;
		}
	}
	return best;
}

function findModelArrays(value: unknown, depth: number, found: unknown[][]): void {
	if (depth > 5) return;
	if (Array.isArray(value)) {
		const records = value.filter(isRecord).length;
		if (value.length && value.length <= 5000 && records / value.length > 0.8 && value.some((item) => isRecord(item) && firstString(item, ID_KEYS) !== undefined && (firstNumber(item, INPUT_KEYS) !== undefined || hasNestedPricing(item)))) {
			found.push(value);
			return;
		}
		for (const item of value) if (isRecord(item)) findModelArrays(item, depth + 1, found);
		return;
	}
	if (isRecord(value)) {
		for (const key of WRAP_KEYS) {
			if (Array.isArray(value[key])) findModelArrays(value[key], depth + 1, found);
		}
		if (!found.length) {
			for (const child of Object.values(value)) if (isRecord(child) || Array.isArray(child)) findModelArrays(child, depth + 1, found);
		}
	}
}

/** Parses any JSON body into priced models; empty array when nothing matches. */
export function parseJsonModels(text: string): PricedModel[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return [];
	}
	const found: unknown[][] = [];
	findModelArrays(value, 0, found);
	return parseModelArray(found);
}

const TABLE_ID_LIKE = /^[a-zA-Z][a-zA-Z0-9]*[-_.:/][a-zA-Z0-9._:/-]+$/;
const QUOT = String.fromCodePoint(34);
const APOS = String.fromCodePoint(39);

function decodeEntities(text: string): string {
	const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: QUOT, apos: APOS, nbsp: " " };
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, entity: string) => {
		if (entity[0] === "#") {
			const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : all;
		}
		return named[entity] ?? all;
	});
}

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function priceFromCell(text: string): { cost: number; currency: Currency } | undefined {
	const cost = looseNumber(text.replace(/[,，]/g, ""));
	if (cost === undefined) return undefined;
	const currency = /usd|\$|美元|美金/i.test(text) && !/cny|¥|￥|元/i.test(text) ? "USD" : "CNY";
	return { cost, currency };
}

/** Fallback for static pricing sites: scans HTML tables for an id column plus price columns. */
export function parseHtmlTables(html: string): PricedModel[] {
	const models: PricedModel[] = [];
	const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) ?? [];
	for (const table of tables) {
		const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
		const matrix = rows.map((row) => (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((cell) => stripTags(cell)));
		if (matrix.length < 2) continue;
		const header = matrix[0].map((cell) => cell.toLowerCase());
		const idIdx = header.findIndex((cell) => /模型|model|^id$|名称/.test(cell));
		const inIdx = header.findIndex((cell) => /输入|input|prompt/.test(cell));
		const outIdx = header.findIndex((cell) => /输出|output|completion/.test(cell));
		const hasHeader = idIdx >= 0 && (inIdx >= 0 || outIdx >= 0);
		const dataRows = hasHeader ? matrix.slice(1) : matrix;
		const guess = !hasHeader;
		for (const cells of dataRows) {
			const modelId = cells[guess ? 0 : idIdx];
			if (!modelId || !TABLE_ID_LIKE.test(modelId)) continue;
			const inCell = cells[guess ? 1 : inIdx];
			const outCell = cells[guess ? 2 : outIdx];
			const input = inCell ? priceFromCell(inCell) : undefined;
			const output = outCell ? priceFromCell(outCell) : undefined;
			if (!input && !output) continue;
			models.push({
				modelId,
				inputCost: input?.cost ?? output?.cost ?? 0,
				outputCost: output?.cost ?? input?.cost ?? 0,
				currency: input?.currency ?? output?.currency ?? "CNY",
				contextWindow: null,
				maxTokens: null,
				streaming: true,
				tools: true,
				vision: false,
				reasoning: false,
				note: null,
			});
		}
	}
	return dedupe(models);
}

function extractNextData(html: string): PricedModel[] {
	const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
	return match ? parseJsonModels(match[1]) : [];
}

function parseFetchedPage(page: FetchedPage): PricedModel[] {
	if (page.contentType.includes("json")) return parseJsonModels(page.body);
	const fromJson = parseJsonModels(page.body);
	if (fromJson.length) return fromJson;
	const fromNext = extractNextData(page.body);
	if (fromNext.length) return fromNext;
	return parseHtmlTables(page.body);
}

/** Derives likely JSON endpoints from a human-facing page URL (`/models` → `/api/models`). */
export function candidateApiUrls(raw: string): string[] {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return [];
	}
	const path = url.pathname.replace(/\/+$/, "");
	if (!/^\/[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(path)) return [];
	const candidates: string[] = [];
	if (!path.toLowerCase().endsWith(".json")) candidates.push(`${url.origin}${path}.json`);
	if (!path.startsWith("/api")) {
		candidates.push(`${url.origin}/api${path}`);
		candidates.push(`${url.origin}/api/v1${path}`);
	}
	return [...new Set(candidates)].filter((candidate) => candidate !== `${url.origin}${url.pathname}`);
}

/**
 * Imports priced models from a user-supplied page: parse the page itself, then
 * probe a few derived JSON endpoints. Throws when nothing parses.
 */
export async function importPricedModels(pageUrl: string, fetchPage: (url: string) => Promise<FetchedPage>): Promise<PricedModel[]> {
	let first: FetchedPage;
	try {
		first = await fetchPage(pageUrl);
	} catch (error) {
		throw new Error(String(error).replace(/^Error: /, ""));
	}
	const direct = parseFetchedPage(first);
	if (direct.length) return direct;
	for (const candidate of candidateApiUrls(first.url)) {
		try {
			const page = await fetchPage(candidate);
			const models = parseJsonModels(page.body);
			if (models.length) return models;
		} catch {
			// Try the next candidate endpoint.
		}
	}
	throw new Error("未能从该页面识别出模型与价格，请换个地址试试，或手动填写");
}
