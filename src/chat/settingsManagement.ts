import type { ModelFamily, RelaySpec } from "./useModelFamilies";
import { providerSourceLabel } from "./settingsModels";

export type SettingsTestRecord = {
	relayId: string; modelId: string; completedAt: number; configVersion: string;
	ok: boolean; latencyMs: number; status: number | null; errorCategory: string | null; configChanged: boolean;
};
export type SettingsUsage = { relayId: string; routeId: string; usedAt: number };
export type SettingsMetadata = { version: number; tests: SettingsTestRecord[]; usage: SettingsUsage[] };
export type RelayBatchPreview = { token: string; names: string[]; routeCount: number };
export type BatchOperation = "enable" | "disable" | "delete";
export type ProviderSort = "config" | "name" | "recent" | "status";
export const PROVIDER_GROUPS = ["官方直连", "中转", "本机", "自定义"] as const;

/** Sorting is a stable view; it never mutates the configuration arrays. */
export function sortSettingsProviders(relays: readonly RelaySpec[], sort: ProviderSort, usage: readonly SettingsUsage[], grouped = false): RelaySpec[] {
	const used = new Map<string, number>();
	for (const item of usage) used.set(item.relayId, Math.max(used.get(item.relayId) ?? 0, item.usedAt));
	return relays.map((relay, index) => ({ relay, index })).sort((a, b) => {
		const group = grouped ? PROVIDER_GROUPS.indexOf(providerSourceLabel(a.relay.baseUrl)) - PROVIDER_GROUPS.indexOf(providerSourceLabel(b.relay.baseUrl)) : 0;
		const value = sort === "name" ? a.relay.name.localeCompare(b.relay.name, "zh-CN") : sort === "recent" ? (used.get(b.relay.id) ?? 0) - (used.get(a.relay.id) ?? 0) : sort === "status" ? Number(b.relay.enabled) - Number(a.relay.enabled) : 0;
		return group || value || a.index - b.index;
	}).map(({ relay }) => relay);
}

export function latestSettingsTest(tests: readonly SettingsTestRecord[], relayId: string, modelIds?: readonly string[]) {
	return tests.filter((test) => test.relayId === relayId && (!modelIds || modelIds.includes(test.modelId))).reduce<SettingsTestRecord | undefined>((latest, test) => !latest || test.completedAt > latest.completedAt ? test : latest, undefined);
}
export function settingsTestSummary(test?: SettingsTestRecord, now = Date.now()) {
	if (!test) return "未测试";
	const stale = test.configChanged ? " · 配置已变化，建议复测" : now - test.completedAt > 7 * 24 * 60 * 60 * 1000 ? " · 记录已过期，建议复测" : "";
	return `最近测试：${test.ok ? "成功" : "失败"} · ${test.latencyMs} ms${test.status ? ` · HTTP ${test.status}` : test.errorCategory ? ` · ${test.errorCategory}` : ""} · ${test.modelId} · ${new Date(test.completedAt).toLocaleString()}${stale}`;
}
export function settingsTestDisplay(test?: SettingsTestRecord, now = Date.now()) {
	if (!test) return { label: "未测试", title: "暂无连接测试记录", tone: "muted" as const };
	const age = now - test.completedAt;
	const absoluteAge = Math.abs(age);
	const intervals: [number, number, string][] = [
		[60 * 60 * 1000, 60 * 1000, "分钟"],
		[24 * 60 * 60 * 1000, 60 * 60 * 1000, "小时"],
		[30 * 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, "天"],
		[365 * 24 * 60 * 60 * 1000, 30 * 24 * 60 * 60 * 1000, "个月"],
		[Infinity, 365 * 24 * 60 * 60 * 1000, "年"],
	];
	const [, duration, unit] = intervals.find(([limit]) => absoluteAge < limit)!;
	const relative = absoluteAge < 60 * 1000 ? "刚刚" : `${Math.round(absoluteAge / duration)} ${unit}${age >= 0 ? "前" : "后"}`;
	const stale = test.configChanged ? "配置已变化，建议复测" : age > 7 * 24 * 60 * 60 * 1000 ? "记录已过期，建议复测" : "";
	const detail = [
		`最近测试${test.ok ? "成功" : "失败"}`,
		`${test.latencyMs} ms`,
		test.status !== null ? `HTTP ${test.status}` : test.errorCategory,
		test.modelId,
		new Date(test.completedAt).toLocaleString(),
		stale,
	].filter(Boolean).join(" · ");
	if (test.configChanged) return { label: "需重新测试", title: detail, tone: "muted" as const };
	return { label: `${test.ok ? "✓" : "×"} ${test.latencyMs} ms · ${relative}`, title: detail, tone: test.ok ? "success" as const : "error" as const };
}
export function providerBatchImpact(relays: readonly RelaySpec[], families: readonly ModelFamily[], ids: readonly string[]) {
	return { names: relays.filter((relay) => ids.includes(relay.id)).map((relay) => relay.name), routeCount: families.flatMap((family) => family.routes).filter((route) => ids.includes(route.relayId)).length };
}
