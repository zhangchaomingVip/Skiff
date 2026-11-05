import type { ChatMessage } from "./types";

/** Small, Skiff-owned receipt. No transcript text or provider credentials are persisted here. */
export interface TurnPerformance {
	fingerprint: string;
	ttftMs: number;
	decodeMs?: number;
	averageSpeed?: number;
	averageEstimated: boolean;
}

/** pi restores different message IDs. Bind the receipt to the actual turn content instead. */
export function performanceFingerprint(messages: readonly ChatMessage[], end: number): string {
	let start = end;
	while (start > 0 && messages[start].role !== "user") start--;
	const text = JSON.stringify(messages.slice(start, end + 1).map((message) => [message.role, message.provider, message.model,
		message.blocks.filter((block) => block.kind !== "toolResult"),
		message.usage && [message.usage.input, message.usage.cacheRead, message.usage.cacheWrite, message.usage.output, message.usage.reasoning],
	]));
	let first = 2166136261;
	let second = 5381;
	for (let index = 0; index < text.length; index++) {
		first = Math.imul(first ^ text.charCodeAt(index), 16777619);
		second = Math.imul(second, 33) ^ text.charCodeAt(index);
	}
	return `${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}:${text.length}`;
}

export function normalizeTurnPerformances(value: unknown): Array<TurnPerformance | null> | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.map((item) => {
		if (!item || typeof item !== "object" || typeof item.fingerprint !== "string" || !/^[\da-f]+:[\da-f]+:\d+$/.test(item.fingerprint) || typeof item.ttftMs !== "number" || !Number.isFinite(item.ttftMs) || item.ttftMs < 0 || typeof item.averageEstimated !== "boolean") return null;
		const positive = (number: unknown): number | undefined => typeof number === "number" && Number.isFinite(number) && number > 0 ? number : undefined;
		return { fingerprint: item.fingerprint, ttftMs: item.ttftMs, decodeMs: positive(item.decodeMs), averageSpeed: item.averageSpeed === 0 ? 0 : positive(item.averageSpeed), averageEstimated: item.averageEstimated };
	});
}

export function performancesForMessages(messages: readonly ChatMessage[]): Array<TurnPerformance | null> {
	return messages.filter((message) => message.role === "assistant").map((message) => message.performance ?? null);
}

/** A changed branch or reply cannot inherit a receipt solely by its array position. */
export function attachHistoricalPerformances(messages: ChatMessage[], receipts: readonly (TurnPerformance | null)[] | undefined): ChatMessage[] {
	if (!receipts?.length) return messages;
	let assistant = 0;
	return messages.map((message, index) => {
		if (message.role !== "assistant") return message;
		const receipt = receipts[assistant++];
		return receipt && receipt.fingerprint === performanceFingerprint(messages, index) ? { ...message, performance: receipt } : message;
	});
}
