import { invoke } from "@tauri-apps/api/core";
import { summarizeCosts, formatCosts } from "./cost";
import type { RuntimeOffer } from "./modelFamilies";
import { snapshotForOffer } from "./routeSnapshot";
import type { Currency, RouteSnapshot } from "./types";
import { projectPathKey, type Conversation, type Project } from "./workspace";

type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };
type RequestRow = {
	id?: string | null; entryTimestamp?: string | null; assistantIndex?: number | null;
	provider?: string | null; model?: string | null; stopReason?: string | null;
	usage?: Partial<Record<keyof Tokens, number | null>> | null; timestamp?: number | string | null;
};
type MediaJob = {
	id: string; serviceId: string; serviceName: string; modelId: string;
	projectRoot?: string | null; createdAt: number; completedAt?: number | null;
};
export type StatisticsProjection = {
	sessions: { chatId: string; forked: boolean; startedAt?: string | null; requests: RequestRow[] }[];
	images: MediaJob[]; videos: MediaJob[]; skippedSessions: number; skippedMedia: number;
};
export type StatisticsTarget = { chatId: string; sessionFile: string; cwd: string };

export function statisticsTargets(chats: readonly Conversation[], projects: readonly Project[]): StatisticsTarget[] {
	const paths = new Map(projects.map(({ id, path }) => [id, path]));
	return chats.flatMap(({ id, sessionFile, projectId }) => {
		const cwd = paths.get(projectId);
		return sessionFile && cwd ? [{ chatId: id, sessionFile, cwd }] : [];
	});
}
export const readSessionStatistics = (targets: StatisticsTarget[]) => invoke<StatisticsProjection>("read_session_statistics", { targets });

export type Dimension = { key: string; label: string };
export type RecordKind = "request" | "image" | "video";
export type UsageRecord = {
	id: string; kind: RecordKind; at?: number; project: Dimension; provider: Dimension; model: Dimension;
	chatTitle?: string; status?: string; tokens?: Tokens; cost?: Partial<Record<Currency, number>>; estimated?: boolean;
};
export const kindLabels: Record<RecordKind, string> = { request: "会话请求", image: "图片", video: "视频" };
const unknownProject = { key: "unassigned", label: "未归属项目" };
const tokenCount = (value?: number | null) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const timestamp = (value?: number | string | null) => {
	const time = typeof value === "string" ? Date.parse(value) : value;
	return typeof time === "number" && time >= 0 && Number.isFinite(new Date(time).getTime()) ? time : undefined;
};
const modelIdentity = (kind: RecordKind, model?: string | null) => ({ key: `${kind}:${model ?? ""}`, label: model || "未知模型" });
const projectIdentity = (project?: Project) => project ? { key: `project:${project.id}`, label: project.name } : unknownProject;

export function collectStatistics(data: StatisticsProjection, chats: readonly Conversation[], projects: readonly Project[], offers: readonly RuntimeOffer[]): UsageRecord[] {
	const byChat = new Map(chats.map((chat) => [chat.id, chat]));
	const byProject = new Map(projects.map((project) => [project.id, project]));
	const byPath = new Map(projects.map((project) => [projectPathKey(project.path), project]));
	const routes = new Map<string, RuntimeOffer[]>();
	const routeKey = (provider: string, model: string) => JSON.stringify([provider, model]);
	for (const offer of offers) {
		for (const key of new Set([offer.providerKey, ...(offer.legacyProviderKeys ?? [])])) {
			const match = routeKey(key, offer.modelId);
			const candidates = routes.get(match) ?? [];
			candidates.push(offer); routes.set(match, candidates);
		}
	}
	const result: UsageRecord[] = [];
	const seen = new Set<string>();
	// Forks copy the original pi entries verbatim, including their IDs and timestamps.
	// Attribute shared requests to the original/oldest retained session, not every copy.
	const sessions = [...data.sessions].sort((a, b) => Number(a.forked) - Number(b.forked)
		|| (timestamp(a.startedAt) ?? Infinity) - (timestamp(b.startedAt) ?? Infinity));
	for (const session of sessions) {
		const chat = byChat.get(session.chatId);
		if (!chat) continue;
		const project = projectIdentity(byProject.get(chat.projectId));
		for (const [index, row] of session.requests.entries()) {
			if (!row.provider && !row.model && !row.usage) continue;
			const dedupe = row.id && row.entryTimestamp && JSON.stringify([row.id, row.entryTimestamp, row.provider, row.model]);
			if (dedupe && seen.has(dedupe)) continue;
			if (dedupe) seen.add(dedupe);
			const candidates = row.provider && row.model ? routes.get(routeKey(row.provider, row.model)) ?? [] : [];
			const exact = candidates.filter((offer) => offer.providerKey === row.provider);
			const matching = exact.length ? exact : candidates;
			const configuredRelay = matching.length && matching.every((offer) => offer.relayId === matching[0].relayId) ? matching[0] : undefined;
			const saved = row.assistantIndex != null ? chat.routeSnapshots?.[row.assistantIndex] : undefined;
			const snapshot = saved && saved.providerKey === row.provider && saved.modelId === row.model ? saved : undefined;
			const relay = snapshot ?? configuredRelay;
			const provider = relay ? { key: `relay:${relay.relayId}`, label: relay.relayName } : { key: `pi:${row.provider ?? ""}`, label: row.provider || "未知提供商" };
			const tokens = row.usage && Object.values(row.usage).some((count) => typeof count === "number") ? {
				input: tokenCount(row.usage.input), output: tokenCount(row.usage.output), cacheRead: tokenCount(row.usage.cacheRead), cacheWrite: tokenCount(row.usage.cacheWrite),
			} : undefined;
			const estimated = !snapshot && matching.length === 1;
			const price: RouteSnapshot | undefined = snapshot ?? (estimated ? snapshotForOffer(matching[0]) : undefined);
			const hasBillableUsage = tokens && (totalTokens(tokens) > 0 || (row.stopReason !== "error" && row.stopReason !== "aborted"));
			const cost = price && hasBillableUsage
				? summarizeCosts([{ id: "", role: "assistant", blocks: [], usage: { ...tokens, totalTokens: totalTokens(tokens) }, routeSnapshot: price }], []) : undefined;
			result.push({ id: `request:${chat.id}:${index}`, kind: "request", at: timestamp(row.timestamp), project, provider,
				model: modelIdentity("request", row.model), chatTitle: chat.title, status: row.stopReason ?? undefined, tokens,
				cost: cost && !cost.unconfigured ? cost.totals : undefined, estimated });
		}
	}
	for (const [kind, jobs] of [["image", data.images], ["video", data.videos]] as const) {
		for (const job of jobs) {
			const id = `${kind}:${job.id}`;
			if (seen.has(id)) continue;
			seen.add(id);
			const project = projectIdentity(job.projectRoot ? byPath.get(projectPathKey(job.projectRoot)) : undefined);
			result.push({ id, kind, at: timestamp(job.completedAt ?? job.createdAt), project,
				provider: { key: `${kind}:${job.serviceId}`, label: job.serviceName || job.serviceId || "未知提供商" }, model: modelIdentity(kind, job.modelId) });
		}
	}
	return result.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
}

const blankTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export const totalTokens = (tokens: Tokens) => tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output;
export const cacheHitRate = (tokens: Tokens) => {
	const inputTotal = tokens.input + tokens.cacheRead + tokens.cacheWrite;
	return inputTotal ? tokens.cacheRead / inputTotal : undefined;
};
export const showCost = (cost: Partial<Record<Currency, number>> = {}) => formatCosts({ totals: cost, unconfigured: false });
export type Totals = {
	request: number; image: number; video: number; usageRows: number; unpriced: number; estimates: number;
	tokens: Tokens; cost: Partial<Record<Currency, number>>;
};
const emptyTotals = (): Totals => ({ request: 0, image: 0, video: 0, usageRows: 0, unpriced: 0, estimates: 0, tokens: blankTokens(), cost: {} });
function add(totals: Totals, row: UsageRecord) {
	totals[row.kind] += 1;
	if (row.kind !== "request") return;
	if (row.tokens) {
		totals.usageRows++;
		for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) totals.tokens[key] += row.tokens[key];
	}
	if (!row.cost) totals.unpriced++;
	else {
		if (row.estimated) totals.estimates++;
		for (const currency of ["CNY", "USD"] as const) {
			const amount = row.cost[currency];
			if (amount !== undefined) totals.cost[currency] = (totals.cost[currency] ?? 0) + amount;
		}
	}
}
export function summarizeStatistics(rows: readonly UsageRecord[]) {
	const totals = emptyTotals();
	for (const row of rows) add(totals, row);
	return totals;
}
export type GroupBy = "project" | "provider" | "model";
export const visibleDimension = (group: GroupBy, value: Dimension) => group !== "project" && (value.key.startsWith("image:") || value.key.startsWith("video:"))
	? `${value.label} · ${value.key.startsWith("image:") ? "图片" : "视频"}` : value.label;
export function groupStatistics(rows: readonly UsageRecord[], by: GroupBy) {
	const groups = new Map<string, Dimension & { totals: Totals }>();
	for (const row of rows) {
		const value = row[by];
		let group = groups.get(value.key);
		if (!group) { group = { key: value.key, label: visibleDimension(by, value), totals: emptyTotals() }; groups.set(value.key, group); }
		add(group.totals, row);
	}
	return [...groups.values()].sort((a, b) => b.totals.request - a.totals.request || b.totals.image + b.totals.video - a.totals.image - a.totals.video || a.label.localeCompare(b.label, "zh-CN"));
}

export type StatisticsRange = "7" | "30" | "90" | "all";
const dayStart = (at: number) => { const date = new Date(at); date.setHours(0, 0, 0, 0); return date; };
const dayKey = (date: Date) => `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
const monthKey = (date: Date) => `${date.getFullYear()}/${date.getMonth() + 1}`;
export function rangeStart(range: StatisticsRange, now: number) {
	if (range === "all") return undefined;
	const start = dayStart(now); start.setDate(start.getDate() - Number(range) + 1);
	return start.getTime();
}
export type StatisticsMetric = "tokens" | "request" | "image" | "video";
const heatLevels = 4;
/** Bucket a day against the busiest day; zero stays on the empty placeholder. */
export const heatLevel = (value: number, maximum: number) => !value || !maximum ? 0
	: Math.min(heatLevels, Math.max(1, Math.ceil((heatLevels * value) / maximum)));
/** A calendar is always a GitHub-style year view: 53 Monday-aligned weeks ending today. */
export const calendarWeeks = 53;
export type CalendarDay = { key: string; at: number; totals: Totals; value: number; week: number; weekday: number };
export function statisticsCalendar(rows: readonly UsageRecord[], now: number, metric: StatisticsMetric) {
	const today = dayStart(now);
	const start = new Date(today);
	start.setDate(start.getDate() - ((today.getDay() + 6) % 7) - (calendarWeeks - 1) * 7);
	const first = start.getTime();
	const buckets = new Map<number, UsageRecord[]>();
	for (const row of rows) {
		if (row.at === undefined) continue;
		const at = dayStart(row.at).getTime();
		if (at < first || at > today.getTime()) continue;
		const bucket = buckets.get(at);
		if (bucket) bucket.push(row); else buckets.set(at, [row]);
	}
	const days: CalendarDay[] = [];
	let week = 0, weekday = 0;
	for (const date = new Date(start); date <= today; date.setDate(date.getDate() + 1)) {
		const at = dayStart(date.getTime()).getTime();
		const totals = summarizeStatistics(buckets.get(at) ?? []);
		days.push({ key: dayKey(date), at, totals, value: metric === "tokens" ? totalTokens(totals.tokens) : totals[metric], week, weekday });
		if (weekday === 6) { week += 1; weekday = 0; } else weekday += 1;
	}
	return { days, weeks: calendarWeeks, maximum: days.reduce((maximum, day) => Math.max(maximum, day.value), 0) };
}

export function statisticsTrend(rows: readonly UsageRecord[], range: StatisticsRange, now: number) {
	const today = dayStart(now);
	const earliest = rows.reduce((value, row) => Math.min(value, row.at ?? Infinity), Infinity);
	const start = dayStart(rangeStart(range, now) ?? (earliest < now ? earliest : now));
	const threshold = new Date(today); threshold.setDate(today.getDate() - 89);
	const monthly = start < threshold;
	if (monthly) start.setDate(1);
	const dateKey = monthly ? monthKey : dayKey;
	const points = new Map<string, { key: string; label: string; totals: Totals }>();
	const label = new Intl.DateTimeFormat("zh-CN", { ...(monthly ? { year: "numeric" } : { day: "numeric" }), month: "numeric" });
	for (const date = new Date(start); date <= today;) {
		const key = dateKey(date);
		points.set(key, { key, label: label.format(date), totals: emptyTotals() });
		if (monthly) date.setMonth(date.getMonth() + 1); else date.setDate(date.getDate() + 1);
	}
	for (const row of rows) {
		const point = row.at === undefined ? undefined : points.get(dateKey(new Date(row.at)));
		if (point) add(point.totals, row);
	}
	return { monthly, points: [...points.values()] };
}
