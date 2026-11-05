import { useEffect, useMemo, useRef, useState } from "react";
import { advanceVoyageContext, contextPressure, contextReminder, currentTurnMessages, currentTurnStats, sampleVoyage, startVoyage, turnOutput, visibleOutputUnits, visibleReplyUnits, voyageStatus, type VoyageActivity, type VoyageContext, type VoyagePhase, type VoyageSample } from "./sailing";
import { advanceTimeline, refreshTimeline, startTimeline, toolFailureStatus, type VoyageTimeline, type VoyageTool } from "./voyageTimeline";
import type { ChatMessage, ContextUsage, ModelInfo, SessionState } from "./types";
import { cacheSavingsRatio, summarizeCosts, type CostSummary } from "./cost";
import { SPARK_SAMPLES } from "./sparkline";
import { decodeReading, decodeTiming } from "./voyageBento";
import { summarizeUsage } from "./usage";

export interface VoyageMetrics {
	speed: number;
	averageSpeed?: number;
	peakSpeed?: number;
	averageEstimated: boolean;
	ttftMs?: number;
	decodeMs?: number;
	sessionTokens?: number;
	cacheSavings?: number;
	tokenTrail?: number[];
	activity: VoyageActivity;
	reminder?: string;
	streaming: boolean;
	context?: number;
	limit?: number;
	ratio: number;
	overhead?: number;
	conversation?: number;
	status: string;
	statusDurationMs?: number;
	phase: VoyagePhase;
	arrived: boolean;
	pressure: "normal" | "warning" | "critical";
	turn: { durationMs?: number; input?: number; total?: number; newInput?: number; cacheRead?: number; hitRate?: number; output?: number; reasoning?: number; cost?: CostSummary };
	recentRequestInput?: number;
	liveTurn?: { turnId?: string; durationMs: number };
	sessionCost: CostSummary;
	timeline?: VoyageTimeline;
	/** Recent instantaneous speeds of the current run, oldest first. */
	speedTrail: number[];
	activeTools: VoyageTool[];
	toolLog: VoyageTool[];
	contextEstimated: boolean;
	contextSource: ContextUsage["source"];
	speedEstimated: boolean;
}

export function useVoyageMetrics(messages: ChatMessage[], model: ModelInfo | undefined, streaming: boolean, pricingModels: ModelInfo[] = [], activeRun?: SessionState["activeRun"], error?: string, abortedRunKey?: string, eventTimeline?: VoyageTimeline, contextUsage?: ContextUsage): VoyageMetrics {
	const user = [...messages].reverse().find((message) => message.role === "user");
	const transcriptId = `turn:${user?.id ?? messages[0]?.id ?? "empty"}`;
	const run = useRef<{ key: string; identity: string; turnId?: string; baseline: string }>();
	const identity = activeRun ? `run:${activeRun.startedAt}:${activeRun.promptId ?? ""}` : transcriptId;
	if (streaming) {
		const changedTurn = activeRun?.turnId && run.current?.turnId && activeRun.turnId !== run.current.turnId;
		if (run.current?.identity !== identity || changedTurn) run.current = { key: `${identity}:${activeRun?.turnId ?? transcriptId}`, identity, turnId: activeRun?.turnId, baseline: transcriptId };
		else run.current.turnId = activeRun?.turnId ?? transcriptId;
	}
	const retained = run.current && (run.current.turnId === transcriptId || run.current.baseline === transcriptId);
	const key = eventTimeline?.key ?? (streaming || retained ? run.current!.key : `history:${transcriptId}`);
	const belongs = streaming ? !activeRun || activeRun.turnId === transcriptId : !retained || !run.current?.turnId || run.current.turnId === transcriptId;
	const turnMessages = useMemo(() => belongs ? currentTurnMessages(messages, streaming ? activeRun : undefined) : [], [messages, belongs, streaming, activeRun]);
	const tokens = useMemo(() => visibleReplyUnits(turnMessages), [turnMessages]);
	const input = useRef({ key, tokens, streaming, activeRun, turnMessages, error, abortedRunKey, eventTimeline });
	input.current = { key, tokens, streaming, activeRun, turnMessages, error, abortedRunKey, eventTimeline };
	const sampler = useRef<VoyageSample>();
	// Only a running turn samples the sparkline; a finished curve stays frozen.
	const trail = useRef<{ key: string; speeds: number[]; tokens: number[]; units: number; at: number }>({ key: "", speeds: [], tokens: [], units: 0, at: 0 });
	const ledger = useRef<VoyageTimeline>();
	const contextLedger = useRef<VoyageContext>();
	const [reading, setReading] = useState<{ sample: VoyageSample; timeline?: VoyageTimeline }>();
	const tick = () => {
		const current = input.current;
		const now = Date.now();
		const fresh = startVoyage(current.key, now, current.activeRun?.startedAt);
		// A restored running transcript is a baseline, not a fresh burst of output.
		if (current.streaming && !current.activeRun?.promptId) {
			fresh.tokens = current.tokens;
			fresh.samples = [{ at: now, tokens: current.tokens }];
		}
		const previous = sampler.current?.key === current.key ? sampler.current : fresh;
		const aborted = current.abortedRunKey === current.key || current.turnMessages.some((message) => message.stopReason === "aborted");
		const failed = current.error || current.turnMessages.some((message) => message.stopReason === "error");
		const sourceTimeline = current.eventTimeline?.key === current.key ? current.eventTimeline : undefined;
		const interruptedSource = sourceTimeline && aborted && sourceTimeline.endedAt !== undefined && sourceTimeline.tools.some((tool) => tool.status === "missing" || tool.status === "running");
		const timeline = interruptedSource ? { ...sourceTimeline, tools: sourceTimeline.tools.map((tool) => tool.status === "missing" || tool.status === "running" ? { ...tool, status: "interrupted" as const } : tool) } : sourceTimeline ? refreshTimeline(sourceTimeline, now) : ledger.current?.key === current.key ? ledger.current : current.streaming ? startTimeline(current.key, now, current.activeRun?.startedAt) : undefined;
		let nextTimeline = sourceTimeline ? timeline : timeline ? advanceTimeline(timeline, { key: current.key, now, messages: current.turnMessages, running: current.streaming,
			unresolvedStatus: aborted ? "interrupted" : failed ? toolFailureStatus(current.error ?? "error") : "missing" }) : undefined;
		// Transcript previews have no lifecycle output event; retain the first observed text.
		if (!sourceTimeline && nextTimeline && current.streaming && current.tokens > previous.tokens && nextTimeline.outputStartedAt === undefined) nextTimeline = { ...nextTimeline, outputStartedAt: now };
		const next = sampleVoyage(previous, current.tokens, now, current.streaming, nextTimeline?.phase === "response");
		sampler.current = next;
		ledger.current = nextTimeline;
		if (trail.current.key !== current.key) trail.current = { key: current.key, speeds: [], tokens: [], units: current.activeRun?.promptId ? 0 : visibleOutputUnits(current.turnMessages), at: now };
		if (current.streaming) {
			trail.current.speeds = [...trail.current.speeds, Math.round(next.speed * 10) / 10].slice(-SPARK_SAMPLES);
			const units = visibleOutputUnits(current.turnMessages);
			if (now > trail.current.at) {
				trail.current.tokens = [...trail.current.tokens, Math.max(0, units - trail.current.units) * 1000 / (now - trail.current.at)].slice(-SPARK_SAMPLES);
				trail.current.units = units;
				trail.current.at = now;
			}
		}
		setReading({ sample: next, timeline: nextTimeline });
	};
	useEffect(() => { tick(); }, [key, tokens, streaming, turnMessages, error, abortedRunKey, eventTimeline]);
	useEffect(() => {
		if (!streaming) return;
		const timer = window.setInterval(tick, 100);
		return () => window.clearInterval(timer);
	}, [streaming, key]);
	const currentSample = reading?.sample.key === key ? reading.sample : undefined;
	const timeline = reading?.timeline?.key === key ? reading.timeline : undefined;
	const phase = timeline?.phase ?? "response";
	const activity = streaming ? phase === "response" ? currentSample?.activity ?? "fishing" : "fishing" : "moored";
	const data = useMemo(() => {
		// A timeline belongs to an earlier run and must not supply a window after
		// a model/branch change. Use the pi snapshot or current model only.
		const limit = contextUsage?.contextWindow ?? model?.contextWindow;
		const next = advanceVoyageContext(contextLedger.current, key, belongs ? messages : [], contextUsage);
		contextLedger.current = next;
		return { ...next, limit: limit && Number.isFinite(limit) && limit > 0 ? limit : undefined };
	}, [key, messages, model, belongs, eventTimeline, contextUsage]);

	const ratio = data.limit && data.context !== undefined ? data.context / data.limit : 0;
	const arrived = ratio >= 1;
	const turn = useMemo(() => belongs ? currentTurnStats(messages, pricingModels, model) : {}, [messages, pricingModels, model, belongs]);
	const durationMs = timeline?.durationMs ?? turn.durationMs;
	const output = turnOutput(turnMessages, streaming);
	const savedPerformance = !streaming ? [...turnMessages].reverse().find((message) => message.performance)?.performance : undefined;
	const timing = savedPerformance ? { ttftMs: savedPerformance.ttftMs, decodeMs: savedPerformance.decodeMs } : decodeTiming(timeline);
	const pending = turnMessages.filter((message) => message.streaming || !message.usage);
	const pendingOutput = Math.ceil(visibleOutputUnits(pending));
	const reportedPending = summarizeUsage(pending).output;
	const liveOutput = Math.max(0, pendingOutput - reportedPending);
	const pendingReasoning = Math.ceil(visibleOutputUnits(pending.map((message) => ({ ...message, blocks: message.blocks.filter((block) => block.kind === "thinking") }))));
	const reasoning = turn.reasoning === undefined ? pendingReasoning > 0 ? pendingReasoning : undefined : turn.reasoning + Math.max(0, pendingReasoning - (summarizeUsage(pending).reasoning ?? 0));
	const average = savedPerformance ?? decodeReading(turnMessages, streaming, timing.decodeMs);
	const statusDurationMs = timeline ? phase === "tool" ? timeline.toolMs : phase === "thinking" ? timeline.thinkingMs : timeline.durationMs : undefined;
	// Cumulative usage (often zero while streaming) cannot measure instantaneous speed.
	const speedEstimated = streaming || output.estimated;
	const liveTurn = useMemo(() => streaming && durationMs !== undefined ? { turnId: activeRun?.turnId, durationMs } : undefined, [streaming, durationMs, activeRun?.turnId]);
	const sessionCost = useMemo(() => summarizeCosts(messages, pricingModels, model), [messages, pricingModels, model]);
	const cacheSavings = useMemo(() => streaming ? undefined : cacheSavingsRatio(turnMessages, pricingModels, model), [turnMessages, pricingModels, model, streaming]);
	return {
		speed: activity === "sailing" ? currentSample?.speed ?? 0 : 0,
		averageSpeed: average.averageSpeed,
		peakSpeed: currentSample?.peak,
		averageEstimated: average.averageEstimated,
		...timing,
		sessionTokens: summarizeUsage(messages).total + (streaming ? liveOutput : 0),
		cacheSavings,
		tokenTrail: trail.current.key === key ? trail.current.tokens : [],
		activity,
		reminder: contextReminder(data?.context, data?.limit, data?.estimated),
		streaming,
		context: data?.context,
		limit: data?.limit,
		ratio,
		status: voyageStatus(activity, phase),
		statusDurationMs,
		phase,
		arrived,
		pressure: contextPressure(ratio),
		turn: { ...turn, input: data.input, durationMs, reasoning, output: streaming ? (turn.output ?? 0) + liveOutput : turn.output, total: streaming ? (turn.total ?? 0) + liveOutput : turn.total },
		recentRequestInput: data.lastRequestInput,
		liveTurn,
		sessionCost,
		timeline,
		speedTrail: trail.current.key === key ? trail.current.speeds : [],
		activeTools: timeline?.tools.filter((tool) => tool.status === "running") ?? [],
		toolLog: timeline?.tools.filter((tool) => tool.status !== "running").sort((a, b) => a.completionOrder! - b.completionOrder!) ?? [],
		contextEstimated: data?.estimated ?? true,
		contextSource: data?.source ?? "unknown",
		speedEstimated,
	};
}
