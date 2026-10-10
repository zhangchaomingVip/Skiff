import { useEffect, useMemo, useRef, useState } from "react";
import { averageOutputSpeed, contextPressure, contextReminder, currentTurnMessages, currentTurnStats, pendingToolCallId, sampleVoyage, startVoyage, turnOutput, visibleOutputUnits, voyagePhase, voyageStatus, type VoyageActivity, type VoyageSample } from "./sailing";
import type { ChatMessage, ModelInfo, SessionState } from "./types";
import { summarizeUsage } from "./usage";
import { summarizeCosts, type CostSummary } from "./cost";

export interface VoyageMetrics {
	speed: number;
	averageSpeed?: number;
	peakSpeed?: number;
	averageEstimated: boolean;
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
	arrived: boolean;
	pressure: "normal" | "warning" | "critical";
	turn: { durationMs?: number; output?: number; cost?: CostSummary };
	liveTurn?: { turnId?: string; durationMs: number };
	sessionCost: CostSummary;
}

const estimateTokens = (text: string): number => {
	let units = 0;
	for (const char of text) {
		if (/\s/.test(char)) continue;
		units += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.25;
	}
	return Math.ceil(units);
};

export function useVoyageMetrics(messages: ChatMessage[], model: ModelInfo | undefined, streaming: boolean, pricingModels: ModelInfo[] = [], activeRun?: SessionState["activeRun"]): VoyageMetrics {
	const user = [...messages].reverse().find((message) => message.role === "user");
	const transcriptId = `turn:${user?.id ?? messages[0]?.id ?? "empty"}`;
	const run = useRef<{ key: string; turnId?: string; baseline: string }>();
	const runKey = activeRun ? `run:${activeRun.startedAt}:${activeRun.promptId ?? ""}` : transcriptId;
	if (streaming) {
		if (run.current?.key !== runKey) run.current = { key: runKey, turnId: activeRun?.turnId, baseline: transcriptId };
		else run.current.turnId = activeRun?.turnId ?? transcriptId;
	}
	const retained = run.current && (run.current.turnId === transcriptId || run.current.baseline === transcriptId);
	const key = streaming ? runKey : retained ? run.current!.key : `history:${transcriptId}`;
	const belongs = streaming ? !activeRun || activeRun.turnId === transcriptId : !retained || !run.current?.turnId || run.current.turnId === transcriptId;
	const turnMessages = useMemo(() => belongs ? currentTurnMessages(messages, streaming ? activeRun : undefined) : [], [messages, belongs, streaming, activeRun]);
	const tokens = useMemo(() => visibleOutputUnits(turnMessages), [turnMessages]);
	const input = useRef({ key, tokens, streaming, activeRun });
	input.current = { key, tokens, streaming, activeRun };
	const sampler = useRef<VoyageSample>();
	const [sample, setSample] = useState<VoyageSample>();
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
		const next = sampleVoyage(previous, current.tokens, now, current.streaming);
		sampler.current = next;
		setSample(next);
	};
	useEffect(() => { tick(); }, [key, tokens, streaming]);
	useEffect(() => {
		if (!streaming) return;
		const timer = window.setInterval(tick, 100);
		return () => window.clearInterval(timer);
	}, [streaming, key]);
	const currentSample = sample?.key === key ? sample : undefined;
	const activity = streaming ? currentSample?.activity ?? "fishing" : "moored";
	const data = useMemo(() => {
		const assistants = messages.filter((message) => message.role === "assistant" && message.usage && !message.streaming);
		const last = assistants[assistants.length - 1];
		const limit = model?.contextWindow;
		if (!last?.usage || !limit || !Number.isFinite(limit) || limit <= 0 || ![last.usage.input, last.usage.output, last.usage.cacheRead, last.usage.cacheWrite].every((value) => Number.isFinite(value) && value >= 0)) return undefined;
		const context = summarizeUsage([last]).total;
		const first = assistants[0];
		const firstUser = messages.find((message) => message.role === "user");
		const firstUserText = firstUser?.blocks.map((block) => block.kind === "text" ? block.text : "").join("") ?? "";
		const overhead = Math.min(context, first ? Math.max(0, summarizeUsage([first]).inputTotal - estimateTokens(firstUserText)) : 0);
		return { context, limit, overhead, conversation: Math.max(0, context - overhead) };
	}, [messages, model]);

	const ratio = data ? data.context / data.limit : 0;
	const arrived = ratio >= 1;
	const turn = useMemo(() => belongs ? currentTurnStats(messages, pricingModels, model) : {}, [messages, pricingModels, model, belongs]);
	const durationMs = streaming ? currentSample?.durationMs ?? (activeRun ? Math.max(0, Date.now() - activeRun.startedAt) : undefined) : turn.durationMs ?? currentSample?.durationMs;
	const output = turnOutput(turnMessages, streaming);
	const phase = voyagePhase(turnMessages);
	const pendingToolId = streaming && phase === "tool" ? pendingToolCallId(turnMessages) : undefined;
	const toolTimer = useRef<{ key: string; startedAt: number }>();
	const toolKey = pendingToolId ? `${key}:${pendingToolId}` : undefined;
	if (toolTimer.current?.key !== toolKey) toolTimer.current = toolKey ? { key: toolKey, startedAt: Date.now() } : undefined;
	const statusDurationMs = streaming && phase === "tool" && toolTimer.current ? Math.max(0, (currentSample?.at ?? Date.now()) - toolTimer.current.startedAt) : durationMs;
	const liveTurn = useMemo(() => streaming && durationMs !== undefined ? { turnId: activeRun?.turnId, durationMs } : undefined, [streaming, durationMs, activeRun?.turnId]);
	const sessionCost = useMemo(() => summarizeCosts(messages, pricingModels, model), [messages, pricingModels, model]);
	return {
		speed: activity === "sailing" ? currentSample?.speed ?? 0 : 0,
		averageSpeed: averageOutputSpeed(output.output, durationMs),
		peakSpeed: currentSample?.peak,
		averageEstimated: output.estimated,
		activity,
		reminder: contextReminder(data?.context, data?.limit),
		streaming,
		context: data?.context,
		limit: model?.contextWindow,
		ratio,
		overhead: data?.overhead,
		conversation: data?.conversation,
		status: voyageStatus(activity, phase),
		statusDurationMs,
		arrived,
		pressure: contextPressure(ratio),
		turn: { ...turn, durationMs },
		liveTurn,
		sessionCost,
	};
}
