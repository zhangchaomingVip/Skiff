/** Model descriptor as reported by pi's `get_available_models` / `get_state`. */
export interface ModelInfo {
	provider: string;
	id: string;
	name?: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	input?: string[];
	cost?: { input?: number; output?: number };
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
