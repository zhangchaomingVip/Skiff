import type { ChatMessage } from "./types";

const count = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

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
