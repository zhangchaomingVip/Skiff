import type { ChatMessage } from "./types";
import type { VoyagePhase } from "./sailing";

export type ToolStatus = "running" | "completed" | "failed" | "timeout" | "interrupted" | "missing";
export interface VoyageTool {
	id: string;
	/** Stable row ID above; pi may supply its call ID only at message_end. */
	callId?: string;
	sourceKey: string;
	name: string;
	summary: string;
	startedAt: number;
	endedAt?: number;
	status: ToolStatus;
	result?: string;
	durationMs: number;
	showDuration: boolean;
	completionOrder?: number;
}
export interface ToolBatch {
	startedAt: number;
	endedAt?: number;
	toolIds: string[];
}
export interface PhaseSegment {
	phase: VoyagePhase;
	startedAt: number;
	endedAt?: number;
}
export interface VoyageTimeline {
	key: string;
	startedAt: number;
	at: number;
	endedAt?: number;
	phase: VoyagePhase;
	segments: PhaseSegment[];
	tools: VoyageTool[];
	batches: ToolBatch[];
	durationMs: number;
	thinkingMs: number;
	toolMs: number;
	completedCount: number;
	seenResults: string[];
	/** First visible output timestamp. Kept separate from the run clock. */
	outputStartedAt?: number;
	/** Exact output usage when pi has reported it. */
	outputTokens?: number;
	/** True until the provider reports an exact output count. */
	outputTokensEstimated?: boolean;
	contextUsed?: number;
	contextLimit?: number;
	contextEstimated?: boolean;
}

/** Normalised lifecycle events used by the voyage instrument. */
export type VoyageEvent =
	| { type: "run_start"; key: string; at: number; phase?: VoyagePhase }
	| { type: "phase"; phase: VoyagePhase; at: number }
	| { type: "tool_start"; id: string; name: string; summary?: string; at: number }
	| { type: "tool_complete"; id: string; result?: string; success: boolean; at: number }
	| { type: "output_delta"; at: number; estimatedTokens?: number }
	| { type: "usage"; at: number; output?: number; context?: number; limit?: number }
	| { type: "context"; at: number; used: number; limit?: number; estimated?: boolean }
	| { type: "run_end"; at: number; status?: "completed" | "failed" | "aborted" | "interrupted" };

const validTime = (value: number) => Number.isFinite(value) ? value : 0;
const compact = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 120);
export const toolStatusLabel: Record<ToolStatus, string> = {
	running: "执行中", completed: "已完成", failed: "失败", timeout: "超时", interrupted: "已中止", missing: "缺少结果",
};

export function startTimeline(key: string, now: number, startedAt = now): VoyageTimeline {
	const at = validTime(now);
	const start = Number.isFinite(startedAt) ? Math.min(at, startedAt) : at;
	return { key, startedAt: start, at, phase: "response", segments: [], tools: [], batches: [], durationMs: Math.max(0, at - start), thinkingMs: 0, toolMs: 0, completedCount: 0, seenResults: [] };
}

const eventTime = (value: number, previous: number) => Math.max(previous, validTime(value));
const eventSummary = (value: string | undefined) => compact(value ?? "");

function stageTotals(segments: PhaseSegment[], at: number): Pick<VoyageTimeline, "thinkingMs" | "toolMs"> {
	let thinkingMs = 0;
	let toolMs = 0;
	for (const segment of segments) {
		const duration = Math.max(0, (segment.endedAt ?? at) - segment.startedAt);
		if (segment.phase === "thinking") thinkingMs += duration;
		if (segment.phase === "tool") toolMs += duration;
	}
	return { thinkingMs, toolMs };
}

function cloneTimeline(previous: VoyageTimeline, at: number): VoyageTimeline {
	const segments = previous.segments.map((segment) => ({ ...segment }));
	const tools = previous.tools.map((tool) => ({ ...tool }));
	const batches = previous.batches.map((batch) => ({ ...batch, toolIds: [...batch.toolIds] }));
	const next: VoyageTimeline = { ...previous, at, segments, tools, batches, seenResults: [...previous.seenResults] };
	for (const tool of next.tools) {
		tool.durationMs = Math.max(0, (tool.endedAt ?? at) - tool.startedAt);
		tool.showDuration = tool.durationMs >= 5000;
	}
	return next;
}

/**
 * Apply one real pi lifecycle event. The function is deliberately pure so
 * protocol fixtures can exercise it without React or a browser clock.
 */
export function processEvent(previous: VoyageTimeline | undefined, event: VoyageEvent): VoyageTimeline {
	if (event.type === "run_start") {
		if (previous && previous.key === event.key && previous.endedAt === undefined) return refreshTimeline(previous, event.at);
		const at = validTime(event.at);
		const phase = event.phase ?? "thinking";
		return {
			...startTimeline(event.key, at, at), phase, segments: [{ phase, startedAt: at }],
		};
	}
	if (!previous || previous.endedAt !== undefined) return previous ?? startTimeline("unknown", event.at, event.at);
	const at = eventTime(event.at, previous.at);
	const next = cloneTimeline(previous, at);
	const setPhase = (phase: VoyagePhase) => {
		const open = next.segments[next.segments.length - 1];
		if (next.phase === phase && open && open.endedAt === undefined) return;
		if (open && open.endedAt === undefined) open.endedAt = at;
		next.segments.push({ phase, startedAt: at });
		next.phase = phase;
	};
	const finish = (tool: VoyageTool, status: ToolStatus, result?: string) => {
		if (tool.status !== "running") return;
		tool.status = status;
		tool.endedAt = at;
		tool.result = result;
		tool.durationMs = Math.max(0, at - tool.startedAt);
		tool.showDuration = tool.durationMs >= 5000;
		tool.completionOrder = ++next.completedCount;
	};
	if (event.type === "phase") setPhase(event.phase);
	else if (event.type === "tool_start") {
		setPhase("tool");
		if (!next.tools.some((tool) => tool.id === event.id)) {
			next.tools = [...next.tools, { id: event.id, callId: event.id, sourceKey: event.id, name: event.name, summary: eventSummary(event.summary), startedAt: at, status: "running", durationMs: 0, showDuration: false }];
		}
	} else if (event.type === "tool_complete") {
		const tool = next.tools.find((item) => item.id === event.id || item.callId === event.id);
		if (tool) finish(tool, event.success ? "completed" : "failed", eventSummary(event.result));
	} else if (event.type === "output_delta") {
		setPhase("response");
		if (next.outputStartedAt === undefined) next.outputStartedAt = at;
		if (event.estimatedTokens !== undefined && Number.isFinite(event.estimatedTokens)) {
			next.outputTokens = (next.outputTokens ?? 0) + Math.max(0, event.estimatedTokens);
			next.outputTokensEstimated = true;
		}
	} else if (event.type === "usage") {
		if (event.output !== undefined && Number.isFinite(event.output) && event.output >= 0) {
			next.outputTokens = event.output;
			next.outputTokensEstimated = false;
		}
		if (event.context !== undefined && Number.isFinite(event.context) && event.context >= 0) {
			next.contextUsed = event.context;
			next.contextEstimated = false;
		}
		if (event.limit !== undefined && Number.isFinite(event.limit) && event.limit > 0) next.contextLimit = event.limit;
	} else if (event.type === "context") {
		if (Number.isFinite(event.used) && event.used >= 0) next.contextUsed = event.used;
		if (event.limit !== undefined && Number.isFinite(event.limit) && event.limit > 0) next.contextLimit = event.limit;
		next.contextEstimated = event.estimated ?? false;
	} else if (event.type === "run_end") {
		for (const tool of next.tools) if (tool.status === "running") finish(tool, event.status === "aborted" ? "interrupted" : event.status === "failed" ? "failed" : "missing", event.status === "completed" ? undefined : "本轮已结束，未收到工具结果");
		const open = next.segments[next.segments.length - 1];
		if (open && open.endedAt === undefined) open.endedAt = at;
		next.endedAt = at;
	}
	const totals = stageTotals(next.segments, at);
	return { ...next, at, durationMs: Math.max(next.durationMs, at - next.startedAt), ...totals };
}

/** Advance only live durations; terminal timelines remain immutable. */
export function refreshTimeline(previous: VoyageTimeline, now: number): VoyageTimeline {
	if (previous.endedAt !== undefined) return previous;
	const at = eventTime(now, previous.at);
	const next = cloneTimeline(previous, at);
	const totals = stageTotals(next.segments, at);
	return { ...next, at, durationMs: Math.max(next.durationMs, at - next.startedAt), ...totals };
}

export function toolFailureStatus(text: string): "failed" | "timeout" {
	return /timed?\s*out|timeout|超时/i.test(text) ? "timeout" : "failed";
}

const TARGET_KEYS = ["command", "path", "file", "filePath", "pattern", "query", "url"] as const;
/** Best-effort human target from (possibly truncated) JSON args; "" when only raw JSON. */
export function toolTargetText(summary: string): string {
	for (const key of TARGET_KEYS) {
		const match = summary.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
		if (match?.[1]?.trim()) return match[1].replace(/\\(["\\/])/g, "$1").replace(/\\n/g, " ").slice(0, 120);
	}
	return summary.startsWith("{") ? "" : summary;
}

/** Transcript timestamps describe messages, not tool execution. Use first observation
 * for calls/results; no guessed timeout can terminate a legitimate long-running tool.
 * Missing IDs use block location. Reused IDs converge on the first lifecycle.
 */
export function advanceTimeline(previous: VoyageTimeline, input: {
	key: string; now: number; messages: ChatMessage[]; running: boolean;
	unresolvedStatus?: Exclude<ToolStatus, "running" | "completed">;
}): VoyageTimeline {
	if (previous.key !== input.key || previous.endedAt !== undefined) return previous;
	const at = Math.max(previous.at, validTime(input.now));
	const tools = previous.tools.map((tool) => ({ ...tool }));
	const byId = new Map<string, VoyageTool>();
	for (const tool of tools) { byId.set(tool.id, tool); if (tool.callId) byId.set(tool.callId, tool); }
	const bySource = new Map(tools.map((tool) => [tool.sourceKey, tool]));
	let activeCount = tools.filter((tool) => tool.status === "running").length;
	const batches = previous.batches.map((batch) => ({ ...batch, toolIds: [...batch.toolIds] }));
	let completedCount = previous.completedCount;
	const seenResults = new Set(previous.seenResults);
	const closeBatch = () => {
		const batch = batches[batches.length - 1];
		if (batch && batch.endedAt === undefined && activeCount === 0) batch.endedAt = at;
	};
	const settle = (tool: VoyageTool, status: ToolStatus, result?: string) => {
		if (tool.status !== "running") return;
		tool.status = status;
		tool.result = result;
		tool.endedAt = at;
		tool.completionOrder = ++completedCount;
		activeCount--;
		closeBatch();
	};
	for (const message of input.messages) for (const [index, block] of message.blocks.entries()) {
		if (block.kind === "tool") {
			const sourceKey = `${message.id}:${index}`;
			const id = block.id || `anonymous:${message.id}:${index}`;
			const provisional = bySource.get(sourceKey);
			const existing = byId.get(id) ?? (provisional && !provisional.callId ? provisional : undefined);
			if (existing) {
				if (existing.sourceKey === sourceKey) { existing.name = block.name; existing.summary = compact(block.argsText); }
				if (block.id && !existing.callId) { existing.callId = block.id; byId.set(block.id, existing); }
				continue;
			}
			let batch = batches[batches.length - 1];
			if (!batch || batch.endedAt !== undefined) {
				batch = { startedAt: at, toolIds: [] };
				batches.push(batch);
			}
			batch.toolIds.push(id);
			const tool: VoyageTool = { id, callId: block.id || undefined, sourceKey, name: block.name, summary: compact(block.argsText), startedAt: at, status: "running", durationMs: 0, showDuration: false };
			tools.push(tool);
			byId.set(id, tool);
			bySource.set(sourceKey, tool);
			activeCount++;
		} else if (block.kind === "toolResult") {
			const resultKey = `${message.id}:${index}`;
			if (seenResults.has(resultKey)) continue;
			seenResults.add(resultKey);
			// A result without an ID can only safely pair with one unresolved tool of
			// that name. Ambiguous/orphan results never settle another call.
			const identified = block.id ? byId.get(block.id) : undefined;
			const matches = block.id ? identified?.status === "running" ? [identified] : [] : tools.filter((tool) => tool.status === "running" && tool.name === block.name);
			if (matches.length === 1) settle(matches[0], block.isError ? toolFailureStatus(block.text) : "completed", compact(block.text));
		}
	}
	if (!input.running) for (const tool of tools) settle(tool, input.unresolvedStatus ?? "missing", "本轮已结束，未收到工具结果");
	for (const tool of tools) {
		tool.durationMs = Math.max(tool.durationMs, (tool.endedAt ?? at) - tool.startedAt);
		tool.showDuration = tool.durationMs >= 5000;
	}
	const lastMessage = input.messages[input.messages.length - 1];
	const lastBlock = lastMessage?.blocks[lastMessage.blocks.length - 1];
	const phase = tools.some((tool) => tool.status === "running") ? "tool" : lastMessage?.streaming && lastBlock?.kind === "thinking" ? "thinking" : "response";
	const segments = previous.segments.map((segment) => ({ ...segment }));
	const last = segments[segments.length - 1];
	if (last && last.endedAt === undefined && (!input.running || phase !== previous.phase)) last.endedAt = at;
	if (input.running && (!last || last.endedAt !== undefined)) segments.push({ phase, startedAt: at });
	const thinkingMs = segments.filter((segment) => segment.phase === "thinking").reduce((sum, segment) => sum + (segment.endedAt ?? at) - segment.startedAt, 0);
	const toolMs = batches.reduce((sum, batch) => sum + (batch.endedAt ?? at) - batch.startedAt, 0);
	return { ...previous, at, phase, segments, tools, batches, completedCount, seenResults: [...seenResults],
		endedAt: input.running ? undefined : at, durationMs: Math.max(previous.durationMs, at - previous.startedAt),
		thinkingMs: Math.max(previous.thinkingMs, thinkingMs), toolMs: Math.max(previous.toolMs, toolMs) };
}
