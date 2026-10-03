import type { ChatMessage } from "./types";
import { summarizeUsage } from "./usage";

/** Live text is only a token estimate; pi reports exact output usage after a message ends. */
export function estimateOutputTokens(messages: ChatMessage[]): number {
	let units = 0;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role === "user") break;
		for (const block of message.blocks) {
			if (block.kind !== "text" && block.kind !== "thinking") continue;
			for (const char of block.text) {
				units += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.25;
			}
		}
	}
	return Math.ceil(units);
}

export function outputSpeed(samples: { at: number; tokens: number }[], now: number, windowMs = 500): number {
	const recent = samples.filter((sample) => sample.at >= now - windowMs);
	if (recent.length < 2) return 0;
	const first = recent[0];
	const last = recent[recent.length - 1];
	return Math.max(0, (last.tokens - first.tokens) * 1000 / Math.max(250, now - first.at));
}

export function gaugePosition(speed: number): number {
	return Math.min(1, Math.max(0, speed) / 300);
}

export function voyageStatus(ratio: number, streaming: boolean): string {
	return ratio >= 1 ? "已到港，建议新开会话" : streaming ? "航行中 running" : "已停泊 ready";
}

export function contextPressure(ratio: number): "normal" | "warning" | "critical" {
	return ratio > .95 ? "critical" : ratio >= .8 ? "warning" : "normal";
}

/** Usage belongs to the most recent user prompt, including any intermediate assistant steps. */
export function currentTurnStats(messages: ChatMessage[]): { durationMs?: number; output?: number; cost?: number } {
	let userIndex = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "user") { userIndex = index; break; }
	}
	if (userIndex < 0) return {};
	const assistants = messages.slice(userIndex + 1).filter((message) => message.role === "assistant");
	if (!assistants.length) return {};
	const measured = [...assistants].reverse().find((message) => typeof message.durationMs === "number")?.durationMs;
	const finished = [...assistants].reverse().find((message) => typeof message.timestamp === "number")?.timestamp;
	const started = messages[userIndex].timestamp;
	const usageMessages = assistants.filter((message) => message.usage && !message.streaming);
	const usage = usageMessages.length ? summarizeUsage(usageMessages) : undefined;
	return {
		durationMs: measured ?? (started !== undefined && finished !== undefined ? Math.max(0, finished - started) : undefined),
		output: usage?.output,
		cost: usage?.cost,
	};
}
