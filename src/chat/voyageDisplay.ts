import type { VoyageMetrics } from "./useVoyageMetrics";
import type { ChatMessage, ModelInfo } from "./types";
import { advanceVoyageContext, currentTurnMessages, currentTurnStats } from "./sailing";
import { voyageProcessStats } from "./voyageBento";

type Source = Pick<VoyageMetrics, "streaming" | "speed" | "averageSpeed" | "ttftMs" | "peakSpeed" | "turn" | "telemetry" | "context" | "limit" | "ratio" | "contextSource">;

export interface VoyageDisplay {
	identity: string;
	turnKey: string;
	speedStarted: boolean;
	speed?: { value?: number; ttftMs?: number; peakSpeed?: number };
	tokens?: { total: number; input: number; output: number; fresh?: number; steps: number; trend: (number | undefined)[] };
	cache?: { input: number; read: number; write: number };
	context?: { used: number; limit: number; ratio: number; source: Source["contextSource"] };
	retained: { speed: boolean; tokens: boolean; cache: boolean; context: boolean };
}

/** Presentation only: preserve coherent readings while the next turn has not reported them. */
export function advanceVoyageDisplay(previous: VoyageDisplay | undefined, source: Source, identity: string, turnKey: string, clearContext = false): VoyageDisplay {
	const last = previous?.identity === identity ? previous : undefined;
	const { turn } = source;
	const speedStarted = !!(last?.turnKey === turnKey && last.speedStarted) || source.streaming && source.ttftMs !== undefined && source.speed > 0;
	const speedReady = source.streaming ? speedStarted : source.averageSpeed !== undefined;
	// Streaming SDKs may send an all-zero placeholder before the request reports usage.
	const inputReported = turn.input !== undefined && (!source.streaming || turn.input > 0 || source.telemetry.turn.reportedSteps > 0);
	const tokensReady = inputReported && turn.input !== undefined && turn.output !== undefined && turn.total !== undefined && Math.abs(turn.input + turn.output - turn.total) < 1e-6;
	const cacheReady = inputReported && turn.cacheRead !== undefined && turn.cacheWrite !== undefined;
	const oldContext = !clearContext && last?.context && last.context.limit === source.limit ? last.context : undefined;
	// A fresh local text estimate must not replace a usage-backed window snapshot.
	const contextReady = source.context !== undefined && source.limit !== undefined && !clearContext && !(source.contextSource === "local-estimate" && oldContext && oldContext.source !== "local-estimate");
	return {
		identity, turnKey, speedStarted,
		speed: speedReady ? { value: source.streaming ? source.speed : source.averageSpeed, ttftMs: source.ttftMs, peakSpeed: source.peakSpeed } : last?.speed,
		tokens: tokensReady ? { total: turn.total!, input: turn.input!, output: turn.output!, fresh: turn.newInput, steps: source.telemetry.turn.steps, trend: source.telemetry.inputTrend } : last?.tokens,
		cache: cacheReady ? { input: turn.input!, read: turn.cacheRead!, write: turn.cacheWrite! } : last?.cache,
		context: contextReady ? { used: source.context!, limit: source.limit!, ratio: source.ratio, source: source.contextSource } : oldContext,
		retained: { speed: !speedReady && !!last?.speed, tokens: !tokensReady && !!last?.tokens, cache: !cacheReady && !!last?.cache, context: !contextReady && !!oldContext },
	};
}

/** Restore the preceding turn when opening a conversation whose current turn is still waiting. */
export function restoreVoyageDisplay(source: Source, messages: ChatMessage[], identity: string, model?: ModelInfo): VoyageDisplay | undefined {
	let lastUser = messages.length - 1;
	while (lastUser >= 0 && messages[lastUser].role !== "user") lastUser--;
	if (lastUser <= 0) return undefined;
	const previous = messages.slice(0, lastUser);
	const replies = currentTurnMessages(previous);
	const lastReply = replies[replies.length - 1];
	if (model && (lastReply?.provider && lastReply.provider !== model.provider || lastReply?.model && lastReply.model !== model.id)) return undefined;
	const performance = [...replies].reverse().find((message) => message.performance)?.performance;
	const context = advanceVoyageContext(undefined, "previous", previous);
	return advanceVoyageDisplay(undefined, {
		...source, streaming: false, averageSpeed: performance?.averageSpeed, ttftMs: performance?.ttftMs, peakSpeed: undefined,
		turn: currentTurnStats(previous),
		context: context.context, contextSource: context.source, ratio: context.context !== undefined && source.limit ? context.context / source.limit : 0,
		telemetry: { ...source.telemetry, turn: voyageProcessStats(replies), inputTrend: source.telemetry.inputTrend.slice(0, -1) },
	}, identity, "previous");
}
