import type { ChatMessage } from "./types";

const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

export function formatTokens(value?: number): string {
	if (value === undefined) return "未提供";
	if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
	if (value >= 1_000) return `${Number((value / 1_000).toFixed(2))}k`;
	return value.toLocaleString("zh-CN");
}

export function summarizeUsage(messages: ChatMessage[]) {
	const usages = messages.filter((m) => m.role === "assistant" && m.usage).map((m) => m.usage!);
	const input = usages.reduce((sum, u) => sum + count(u.input), 0);
	const cacheRead = usages.reduce((sum, u) => sum + count(u.cacheRead), 0);
	const cacheWrite = usages.reduce((sum, u) => sum + count(u.cacheWrite), 0);
	const output = usages.reduce((sum, u) => sum + count(u.output), 0);
	const inputTotal = input + cacheRead + cacheWrite;
	const reasoning = usages.length && usages.every((u) => typeof u.reasoning === "number") ? usages.reduce((sum, u) => sum + Math.min(count(u.reasoning), count(u.output)), 0) : undefined;
	return {
		input, inputTotal, cacheRead, cacheWrite, output, reasoning,
		answer: reasoning === undefined ? undefined : output - reasoning,
		total: inputTotal + output,
		hitRate: inputTotal ? cacheRead / inputTotal : 0,
		cost: usages.length && usages.every((u) => typeof u.cost?.total === "number") ? usages.reduce((sum, u) => sum + count(u.cost?.total), 0) : undefined,
	};
}

export function formatDuration(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / 1000);
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}

/** Full Chinese elapsed time for reply headers; omit units whose value is zero. */
export function formatElapsedSeconds(seconds: number): string {
	let remaining = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
	const units = [[86400, "天"], [3600, "小时"], [60, "分钟"], [1, "秒"]] as const;
	const parts: string[] = [];
	for (const [size, label] of units) {
		const value = Math.floor(remaining / size);
		if (value > 0) parts.push(`${value}${label}`);
		remaining %= size;
	}
	return parts.join(" ") || "0秒";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Compact turn completion clock; the full local date lives in the tooltip. */
export function formatCompletedAt(value: number): string {
	const date = new Date(value);
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${hours}:${minutes}`;
}

export function completedAtTooltip(value: number): string {
	const date = new Date(value);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day} ${WEEKDAYS[date.getDay()]} ${formatCompletedAt(value)}`;
}
