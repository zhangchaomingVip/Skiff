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

export interface SessionState {
	messages: ChatMessage[];
	isStreaming: boolean;
	model?: ModelInfo;
	availableModels: ModelInfo[];
	thinkingLevel?: string;
	thinkingLevels?: string[];
	notices: Notice[];
	lastError?: string;
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
