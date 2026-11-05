import type { VoyageTimeline } from "./voyageTimeline";
import type { ChatMessage } from "./types";
import { averageOutputSpeed, turnOutput, visibleReplyUnits } from "./sailing";
import { summarizeUsage } from "./usage";

/** Never divide reasoning or tool-call tokens by the visible reply's decode clock. */
export function decodeReading(messages: ChatMessage[], running: boolean, decodeMs?: number): { averageSpeed?: number; averageEstimated: boolean } {
	const output = turnOutput(messages, running);
	const reasoning = summarizeUsage(messages).reasoning;
	const averageEstimated = output.estimated || messages.some((message) => message.blocks.some((block) => block.kind === "tool" || block.kind === "thinking" && reasoning === undefined));
	const replyOutput = averageEstimated ? Math.ceil(visibleReplyUnits(messages)) : Math.max(0, (output.output ?? 0) - (reasoning ?? 0));
	return { averageSpeed: averageOutputSpeed(output.output === undefined ? undefined : replyOutput, decodeMs), averageEstimated };
}

/** Decode time excludes the initial wait, reasoning and tool execution. */
export function decodeTiming(timeline?: VoyageTimeline): { ttftMs?: number; decodeMs?: number } {
	if (!timeline || timeline.outputStartedAt === undefined) return {};
	const first = timeline.outputStartedAt;
	const end = timeline.endedAt ?? timeline.at;
	const decodeMs = timeline.segments.filter((segment) => segment.phase === "response").reduce((sum, segment) =>
		sum + Math.max(0, Math.min(end, segment.endedAt ?? end) - Math.max(first, segment.startedAt)), 0);
	return { ttftMs: Math.max(0, first - timeline.startedAt), decodeMs: decodeMs > 0 ? decodeMs : undefined };
}

export function formatLatency(ms?: number): string {
	if (ms === undefined) return "—";
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** A short weighted filter softens sampling jitter before bounded quadratic curves. */
export function smoothTokenPath(trail: readonly number[]): { line: string; area: string } {
	const values = trail.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0);
	const softened = values.map((value, index) => index === 0 || index === values.length - 1 ? value : (values[index - 1] + value * 2 + values[index + 1]) / 4);
	const peak = Math.max(0, ...softened);
	if (!peak || values.length < 2) return { line: "", area: "" };
	const points = softened.map((value, index) => ({ x: index / (values.length - 1) * 100, y: 29 - value / peak * 26 }));
	let line = `M${points[0].x},${points[0].y}`;
	for (let index = 1; index < points.length; index++) {
		const previous = points[index - 1];
		const point = points[index];
		line += ` Q${previous.x},${previous.y} ${(previous.x + point.x) / 2},${(previous.y + point.y) / 2}`;
	}
	const last = points[points.length - 1];
	line += ` T${last.x},${last.y}`;
	return { line, area: `${line} L100,32 L0,32 Z` };
}
