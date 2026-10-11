import type { ChatMessage, ModelInfo, SessionState } from "./types";
import { summarizeUsage } from "./usage";
import { summarizeCosts, type CostSummary } from "./cost";

/** Live text is only a token estimate; pi reports exact output usage after a message ends. */
export function estimateOutputTokens(messages: ChatMessage[]): number {
	return Math.ceil(visibleOutputUnits(messages));
}

/** Fractional units let even a single Latin character restart sailing. */
export function visibleOutputUnits(messages: ChatMessage[]): number {
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
	return units;
}

/** Speed accepts assistant reply text only. Keep turnOutput's existing estimate
 * (including reasoning) for average/usage compatibility. */
export function visibleReplyUnits(messages: ChatMessage[]): number {
	return visibleOutputUnits(messages.map((message) => message.role === "assistant" ? { ...message, blocks: message.blocks.filter((block) => block.kind === "text") } : message));
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

export type VoyageActivity = "sailing" | "fishing" | "moored";
export type VoyagePhase = "thinking" | "tool" | "response";

export function voyageStatus(activity: VoyageActivity, phase: VoyagePhase): string {
	if (activity === "moored") return "已停泊";
	if (phase === "thinking") return "思考中";
	if (phase === "tool") return "工具执行中";
	return activity === "sailing" ? "航行中" : "等待响应";
}

export function currentTurnMessages(messages: ChatMessage[], run?: SessionState["activeRun"]): ChatMessage[] {
	let userIndex = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "user") { userIndex = index; break; }
	}
	const turnId = `turn:${messages[userIndex >= 0 ? userIndex : 0]?.id}`;
	if (run && run.turnId !== turnId) return [];
	return messages.slice(userIndex + 1).filter((message) => message.role === "assistant");
}

export function voyagePhase(messages: ChatMessage[]): VoyagePhase {
	const results = new Set(messages.flatMap((message) => message.blocks.flatMap((block) => block.kind === "toolResult" && block.id ? [block.id] : [])));
	if (messages.some((message) => message.blocks.some((block) => block.kind === "tool" && !results.has(block.id)))) return "tool";
	const last = messages[messages.length - 1];
	const block = last?.blocks[last.blocks.length - 1];
	return last?.streaming && block?.kind === "thinking" ? "thinking" : "response";
}

/** The latest unresolved tool call owns the visible tool timer. */
export function pendingToolCallId(messages: ChatMessage[]): string | undefined {
	const results = new Set(messages.flatMap((message) => message.blocks.flatMap((block) => block.kind === "toolResult" && block.id ? [block.id] : [])));
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
		const blocks = messages[messageIndex].blocks;
		for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex--) {
			const block = blocks[blockIndex];
			if (block.kind === "tool" && !results.has(block.id)) return block.id;
		}
	}
	return undefined;
}

export function averageOutputSpeed(output?: number, durationMs?: number): number | undefined {
	if (output === undefined || durationMs === undefined || !Number.isFinite(output) || output < 0 || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
	const speed = output * 1000 / durationMs;
	return Number.isFinite(speed) ? speed : undefined;
}

export function turnOutput(messages: ChatMessage[], running: boolean): { output?: number; estimated: boolean } {
	const complete = messages.length > 0 && messages.every((message) => !message.streaming && typeof message.usage?.output === "number" && Number.isFinite(message.usage.output) && message.usage.output >= 0);
	if (!running && complete) return { output: summarizeUsage(messages).output, estimated: false };
	const units = visibleOutputUnits(messages);
	return { output: running || units > 0 ? Math.ceil(units) : undefined, estimated: true };
}

export interface VoyageSample {
	key: string;
	startedAt?: number;
	at: number;
	tokens: number;
	samples: { at: number; tokens: number }[];
	lastOutputAt?: number;
	speed: number;
	peak?: number;
	durationMs?: number;
	activity: VoyageActivity;
}

export function startVoyage(key: string, now: number, startedAt?: number): VoyageSample {
	return { key, startedAt, at: now, tokens: 0, samples: [{ at: now, tokens: 0 }], speed: 0, activity: "fishing" };
}

/** Only visible text enters this sampler; usage correction cannot create a peak. */
export function sampleVoyage(previous: VoyageSample, tokens: number, now: number, running: boolean, outputPhase = true): VoyageSample {
	if (!running && previous.activity === "moored") return previous;
	now = Math.max(previous.at, Number.isFinite(now) ? now : previous.at);
	const lastOutputAt = outputPhase ? running && tokens > previous.tokens ? now : previous.lastOutputAt : undefined;
	const activity: VoyageActivity = !running ? "moored" : lastOutputAt !== undefined && now - lastOutputAt < 800 ? "sailing" : "fishing";
	const samples = !outputPhase || tokens < previous.tokens ? [{ at: now, tokens }] : [...previous.samples.filter((sample) => sample.at >= now - 600), { at: now, tokens }];
	const target = outputSpeed(samples, now);
	const speed = activity === "sailing" ? Math.max(0, previous.speed + (target - previous.speed) * Math.min(1, Math.max(0, now - previous.at) / 300)) : 0;
	return { ...previous, at: now, tokens, samples: running ? samples : [], lastOutputAt, activity, speed,
		peak: running ? Math.max(previous.peak ?? 0, speed) : previous.peak,
		durationMs: previous.startedAt !== undefined && Number.isFinite(previous.startedAt) ? Math.max(0, now - previous.startedAt) : undefined };
}

export function contextReminder(context?: number, limit?: number): string | undefined {
	if (context === undefined || limit === undefined || !Number.isFinite(context) || context < 0 || !Number.isFinite(limit) || limit <= 0) return undefined;
	const ratio = context / limit;
	if (ratio < .9) return undefined;
	if (ratio === 1) return "上下文已达到上限，建议新开会话。";
	if (ratio > 1) return `上下文已超出上限（${(ratio * 100).toFixed(1)}%），建议新开会话。`;
	return `上下文已使用 ${(ratio * 100).toFixed(1)}%，建议新开会话。`;
}

export function contextPressure(ratio: number): "normal" | "warning" | "critical" {
	return ratio > .95 ? "critical" : ratio >= .8 ? "warning" : "normal";
}

/** Usage belongs to the most recent user prompt, including any intermediate assistant steps. */
export function currentTurnStats(messages: ChatMessage[], models: ModelInfo[] = [], current?: ModelInfo): { durationMs?: number; output?: number; cost?: CostSummary } {
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
		cost: usage ? summarizeCosts(usageMessages, models, current) : undefined,
	};
}
