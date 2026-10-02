/** Model descriptor as reported by pi's `get_available_models` / `get_state`. */
export interface ModelInfo {
	provider: string;
	id: string;
	name?: string;
	contextWindow?: number;
	reasoning?: boolean;
	input?: string[];
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
	| { kind: "toolResult"; name: string; text: string; isError: boolean };

export interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	blocks: ContentBlock[];
	streaming?: boolean;
	provider?: string;
	model?: string;
	usage?: Usage;
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
