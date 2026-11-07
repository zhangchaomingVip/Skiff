import type { VoyageTimeline } from "./voyageTimeline";
import type { ChatMessage } from "./types";
import { averageOutputSpeed, currentTurnStats, estimateContextTokens, turnOutput, visibleReplyUnits } from "./sailing";
import { summarizeUsage } from "./usage";

export function voyageProcessStats(messages: ChatMessage[], timeline?: VoyageTimeline) {
	const turns: ChatMessage[][] = [];
	for (const message of messages) {
		if (message.role === "user" || !turns.length) turns.push([]);
		turns[turns.length - 1].push(message);
	}
	let steps = 0, reportedSteps = 0, calls = 0, succeeded = 0, failed = 0, unresolved = 0;
	let durationMs = 0, timedTurns = 0, ttftMs = 0, latencyTurns = 0, decodeMs = 0, decodedTokens = 0, speedTurns = 0;
	for (const [index, turn] of turns.entries()) {
		const assistants = turn.filter((message) => message.role === "assistant");
		steps += assistants.filter((message) => message.usage || message.streaming || message.blocks.some((block) => block.kind === "text" || block.kind === "thinking" || block.kind === "tool")).length;
		reportedSteps += assistants.filter((message) => message.usage && !message.streaming).length;
		const tools = new Map<string, "success" | "failed" | "unresolved">();
		for (const message of assistants) for (const [blockIndex, block] of message.blocks.entries()) {
			if (block.kind === "tool") tools.set(block.id || `${message.id}:${blockIndex}`, tools.get(block.id) ?? "unresolved");
			if (block.kind === "toolResult" && block.id) tools.set(block.id, block.isError ? "failed" : "success");
		}
		const live = index === turns.length - 1 ? timeline : undefined;
		for (const tool of live?.tools ?? []) tools.set(tool.callId ?? tool.sourceKey, tool.status === "completed" ? "success" : tool.status === "failed" || tool.status === "timeout" ? "failed" : "unresolved");
		calls += tools.size;
		for (const status of tools.values()) {
			if (status === "success") succeeded++;
			else if (status === "failed") failed++;
			else unresolved++;
		}
		const duration = live?.durationMs ?? currentTurnStats(turn).durationMs;
		if (duration !== undefined) { durationMs += duration; timedTurns++; }
		const receipt = [...assistants].reverse().find((message) => message.performance)?.performance;
		const timing = receipt ?? decodeTiming(live);
		if (timing.ttftMs !== undefined) { ttftMs += timing.ttftMs; latencyTurns++; }
		const speed = receipt ?? decodeReading(assistants, assistants.some((message) => message.streaming), timing.decodeMs);
		if (timing.decodeMs && speed.averageSpeed !== undefined) {
			decodeMs += timing.decodeMs;
			decodedTokens += speed.averageSpeed * timing.decodeMs / 1000;
			speedTurns++;
		}
	}
	return { turns: turns.filter((turn) => turn.some((message) => message.role === "user")).length, steps, reportedSteps, calls, succeeded, failed, unresolved,
		durationMs: timedTurns ? durationMs : undefined, timedTurns, avgTtftMs: latencyTurns ? ttftMs / latencyTurns : undefined, latencyTurns,
		averageSpeed: decodeMs > 0 ? decodedTokens * 1000 / decodeMs : undefined, speedTurns };
}

/** Current-window estimates only: never split an unreported system/tool budget into invented constants. */
export function contextComposition(messages: ChatMessage[], context?: number) {
	if (context === undefined || !Number.isFinite(context) || context < 0) return undefined;
	const dialogue = estimateContextTokens(messages.map((message) => ({ ...message, blocks: message.blocks.filter((block) => block.kind !== "toolResult" && block.kind !== "tool") })));
	const results = estimateContextTokens(messages.map((message) => ({ ...message, blocks: message.blocks.filter((block) => block.kind === "toolResult" || block.kind === "tool") })));
	const visible = dialogue + results;
	// Compaction may make the visible transcript larger than the current window.
	const scale = visible > context && visible > 0 ? context / visible : 1;
	const conversation = Math.min(context, Math.round(dialogue * scale));
	const toolResults = Math.min(context - conversation, Math.round(results * scale));
	return { overhead: context - conversation - toolResults, conversation, toolResults, scaled: scale < 1 };
}

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

/** One reported non-cached input total per user turn, including cache writes. */
export function turnInputTrend(messages: ChatMessage[]): (number | undefined)[] {
	const values: (number | undefined)[] = [];
	for (const message of messages) {
		if (message.role === "user") values.push(undefined);
		else if (message.role === "assistant" && message.usage && values.length) {
			const usage = summarizeUsage([message]);
			const index = values.length - 1;
			values[index] = (values[index] ?? 0) + usage.input + usage.cacheWrite;
		}
	}
	return values;
}

/** Curves pass through actual turn values without smoothing away peaks or bridging missing rounds. */
export function turnInputPath(values: readonly (number | undefined)[]) {
	const valid = (value?: number): value is number => value !== undefined && Number.isFinite(value) && value >= 0;
	const peak = values.reduce<number>((max, value) => valid(value) ? Math.max(max, value) : max, 1);
	const points = values.flatMap((value, index) => valid(value) ? [{ x: values.length === 1 ? 50 : 4 + index / (values.length - 1) * 92, y: values.length === 1 ? 16 : 29 - value / peak * 24, turn: index + 1, value }] : []);
	let line = "", area = "";
	let start = 0;
	while (start < points.length) {
		let end = start;
		let segment = `M${points[start].x},${points[start].y}`;
		while (end + 1 < points.length && points[end + 1].turn === points[end].turn + 1) {
			const previous = points[end++];
			const point = points[end];
			const middle = (previous.x + point.x) / 2;
			segment += ` C${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
		}
		if (end > start) {
			line += `${line ? " " : ""}${segment}`;
			area += `${area ? " " : ""}${segment} L${points[end].x},32 L${points[start].x},32 Z`;
		}
		start = end + 1;
	}
	const markers = points.filter((point, index) => point.turn === values.length || points[index - 1]?.turn !== point.turn - 1 && points[index + 1]?.turn !== point.turn + 1);
	return { line, area, points, markers };
}
