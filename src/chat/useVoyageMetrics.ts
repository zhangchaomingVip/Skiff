import { useEffect, useMemo, useRef, useState } from "react";
import { contextPressure, currentTurnStats, estimateOutputTokens, outputSpeed, voyageStatus } from "./sailing";
import type { ChatMessage, ModelInfo } from "./types";
import { summarizeUsage } from "./usage";
import { summarizeCosts, type CostSummary } from "./cost";

export interface VoyageMetrics {
	speed: number;
	streaming: boolean;
	context?: number;
	limit?: number;
	ratio: number;
	overhead?: number;
	conversation?: number;
	status: string;
	arrived: boolean;
	pressure: "normal" | "warning" | "critical";
	turn: { durationMs?: number; output?: number; cost?: CostSummary };
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

export function useVoyageMetrics(messages: ChatMessage[], model: ModelInfo | undefined, streaming: boolean, pricingModels: ModelInfo[] = []): VoyageMetrics {
	const liveTokens = estimateOutputTokens(messages);
	const liveTokensRef = useRef(liveTokens);
	liveTokensRef.current = liveTokens;
	const samples = useRef<{ at: number; tokens: number }[]>([]);
	const [speed, setSpeed] = useState(0);

	useEffect(() => {
		if (!streaming) {
			samples.current = [];
			setSpeed(0);
			return;
		}
		let previousTick = performance.now();
		const tick = () => {
			const now = performance.now();
			const elapsed = now - previousTick;
			previousTick = now;
			const tokens = liveTokensRef.current;
			const previous = samples.current[samples.current.length - 1];
			if (!previous || tokens < previous.tokens) samples.current = [{ at: now, tokens }];
			else samples.current.push({ at: now, tokens });
			samples.current = samples.current.filter((sample) => sample.at >= now - 600);
			const target = outputSpeed(samples.current, now, 500);
			setSpeed((previousSpeed) => {
				const next = previousSpeed + (target - previousSpeed) * Math.min(1, elapsed / 300);
				return next < .05 ? 0 : next;
			});
		};
		tick();
		const timer = window.setInterval(tick, 100);
		return () => window.clearInterval(timer);
	}, [streaming]);

	const data = useMemo(() => {
		const assistants = messages.filter((message) => message.role === "assistant" && message.usage && !message.streaming);
		const last = assistants[assistants.length - 1];
		const limit = model?.contextWindow;
		if (!last?.usage || !limit || limit <= 0) return undefined;
		if ((last.model && last.model !== model?.id) || (last.provider && last.provider !== model?.provider)) return undefined;
		const context = summarizeUsage([last]).total;
		const first = assistants[0];
		const firstUser = messages.find((message) => message.role === "user");
		const firstUserText = firstUser?.blocks.map((block) => block.kind === "text" ? block.text : "").join("") ?? "";
		const overhead = Math.min(context, first ? Math.max(0, summarizeUsage([first]).inputTotal - estimateTokens(firstUserText)) : 0);
		return { context, limit, overhead, conversation: Math.max(0, context - overhead) };
	}, [messages, model]);

	const ratio = data ? data.context / data.limit : 0;
	const arrived = ratio >= 1;
	const turn = useMemo(() => currentTurnStats(messages, pricingModels, model), [messages, pricingModels, model]);
	const sessionCost = useMemo(() => summarizeCosts(messages, pricingModels, model), [messages, pricingModels, model]);
	return {
		speed,
		streaming,
		context: data?.context,
		limit: model?.contextWindow,
		ratio,
		overhead: data?.overhead,
		conversation: data?.conversation,
		status: voyageStatus(ratio, streaming),
		arrived,
		pressure: contextPressure(ratio),
		turn,
		sessionCost,
	};
}
