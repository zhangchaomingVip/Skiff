import type { VoyageTimeline } from "./voyageTimeline";

/** Model descriptor as reported by pi's `get_available_models` / `get_state`. */
export type Currency = "CNY" | "USD";

export interface ModelInfo {
	provider: string;
	id: string;
	/** Product identity from Skiff; provider/id remain pi compatibility fields. */
	offerId?: string;
	routeId?: string;
	modelId?: string;
	familyId?: string;
	familyName?: string;
	relayId?: string;
	billingAccountId?: string;
	name?: string;
	providerName?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	streaming?: boolean;
	tools?: boolean;
	vision?: boolean;
	input?: string[];
	cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
	currency?: Currency;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	reasoning?: number;
	cost?: { total?: number };
}

/** Immutable route and price metadata captured for a completed assistant reply. */
export interface RouteSnapshot {
	offerId?: string;
	routeId?: string;
	providerKey: string;
	familyId: string;
	familyName: string;
	modelId: string;
	alias?: string;
	relayId: string;
	relayName: string;
	billingAccountId?: string;
	currency: Currency;
	inputCost: number;
	outputCost: number;
	cacheReadCost?: number;
	cacheWriteCost?: number;
}

export type ContentBlock =
	| { kind: "text"; text: string }
	| { kind: "image"; data: string; mimeType: string }
	| { kind: "thinking"; text: string }
	| { kind: "tool"; id: string; name: string; argsText: string; done: boolean }
	| { kind: "toolResult"; id?: string; name: string; text: string; isError: boolean; diff?: string };

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	blocks: ContentBlock[];
	streaming?: boolean;
	provider?: string;
	model?: string;
	usage?: Usage;
	routeSnapshot?: RouteSnapshot;
	/** pi finish reason, e.g. `stop`, `length`, `toolUse`, `aborted`. */
	stopReason?: string;
	/** Wall-clock duration of the turn, attached when the agent run settles. */
	durationMs?: number;
	/** pi message time in ms; for the settling assistant message it is the turn's completion time. */
	timestamp?: number;
}

export interface Notice {
	id: string;
	kind: "info" | "warning" | "error";
	text: string;
}

export type ContextUsageSource = "pi" | "last-request" | "local-estimate" | "unknown";

/** A snapshot of the current context, deliberately separate from cumulative usage. */
export interface ContextUsage {
	/** null means pi knows the context but has no usable reading yet. */
	tokens: number | null;
	contextWindow?: number;
	source: ContextUsageSource;
	/** pi may estimate its projection; this flag is independent of source. */
	estimated: boolean;
	/** Monotonically increasing within one session owner. */
	version: number;
}

export interface SessionState {
	messages: ChatMessage[];
	isStreaming: boolean;
	/** Ephemeral event ledger for the current run; reset on every prompt/session. */
	voyageTimeline?: VoyageTimeline;
	/** Ephemeral run timing; message durations are written only when the run settles. */
	activeRun?: { startedAt: number; turnId?: string; promptId?: string };
	/** Optimistic display only; pi events remain the source of transcript messages. */
	pendingPrompt?: { id: string; userMessage?: ChatMessage };
	model?: ModelInfo;
	availableModels: ModelInfo[];
	thinkingLevel?: string;
	thinkingLevels?: string[];
	notices: Notice[];
	lastError?: string;
	/** Current context snapshot. This is never the cumulative usage total. */
	contextUsage?: ContextUsage;
}

export const initialSessionState: SessionState = {
	messages: [],
	isStreaming: false,
	availableModels: [],
	notices: [],
};

export interface ImageAttachment {
	id: string;
	name: string;
	type: "image";
	data: string;
	mimeType: string;
}
