import { parseBlocks } from "./parse";
import type { ChatMessage, ContentBlock, SessionState } from "./types";
import type { RpcEvent } from "../rpc/RpcClient";
import type { RuntimeOffer } from "./modelFamilies";
import { snapshotForResponse } from "./routeSnapshot";

let seq = 0;
const nextId = (prefix: string): string => `${prefix}_${++seq}_${Date.now().toString(36)}`;

/** pi sends `timestamp` in ms; keep only finite values. */
const timestamp = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

function lastAssistantIndex(messages: ChatMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "assistant") return i;
	}
	return -1;
}

function lastIndexOfRole(messages: ChatMessage[], role: ChatMessage["role"]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === role) return i;
	}
	return -1;
}

function shrinkBlocks(blocks: ContentBlock[]): ContentBlock[] {
	// A sparse array can appear when text_start/toolcall_start use a higher
	// contentIndex first; drop the holes so React keys stay dense.
	return blocks.filter((b): b is ContentBlock => Boolean(b));
}

/**
 * Pure reducer mapping a single `pi --mode rpc` stdout event to the next
 * chat state. Kept framework-free so it can be reused by the GPUI rewrite.
 */
export interface ReducerOptions {
	offers?: readonly RuntimeOffer[];
}

export function reduce(state: SessionState, event: RpcEvent, options: ReducerOptions = {}): SessionState {
	switch (event.type) {
		case "agent_start":
			return { ...state, isStreaming: true, lastError: undefined };

		case "agent_settled":
		case "agent_end":
			return {
				...state,
				isStreaming: false,
				messages: state.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
			};

		case "message_start": {
			const message = event.message as Record<string, unknown> | undefined;
			const role = message?.role;
			if (role !== "user" && role !== "assistant") return state; // drop system prompt
			const chat: ChatMessage = {
				id: nextId(role),
				role,
				blocks: role === "assistant" ? [] : parseBlocks(message?.content),
				streaming: role === "assistant",
				provider: typeof message?.provider === "string" ? message.provider : undefined,
				model: typeof message?.model === "string" ? message.model : undefined,
				usage: message?.usage as ChatMessage["usage"],
				routeSnapshot: undefined,
				stopReason: typeof message?.stopReason === "string" ? message.stopReason : undefined,
				timestamp: timestamp(message?.timestamp),
			};
			return { ...state, messages: [...state.messages, chat] };
		}

		case "message_update": {
			const delta = event.assistantMessageEvent as Record<string, unknown> | undefined;
			if (!delta) return state;
			const index = lastAssistantIndex(state.messages);
			if (index < 0) return state;

			const messages = [...state.messages];
			const target: ChatMessage = { ...messages[index], blocks: [...messages[index].blocks] };
			const contentIndex = typeof delta.contentIndex === "number" ? delta.contentIndex : 0;
			const current = target.blocks[contentIndex];

			switch (delta.type) {
				case "text_start":
					target.blocks[contentIndex] = { kind: "text", text: "" };
					break;
				case "text_delta":
					target.blocks[contentIndex] = {
						kind: "text",
						text: (current?.kind === "text" ? current.text : "") + String(delta.delta ?? ""),
					};
					break;
				case "text_end":
					target.blocks[contentIndex] = {
						kind: "text",
						text: String(delta.content ?? (current?.kind === "text" ? current.text : "")),
					};
					break;
				case "thinking_start":
					target.blocks[contentIndex] = { kind: "thinking", text: "" };
					break;
				case "thinking_delta":
					target.blocks[contentIndex] = {
						kind: "thinking",
						text: (current?.kind === "thinking" ? current.text : "") + String(delta.delta ?? ""),
					};
					break;
				case "toolcall_start":
					target.blocks[contentIndex] = {
						kind: "tool",
						id: String(delta.id ?? ""),
						name: String(delta.toolName ?? "tool"),
						argsText: "",
						done: false,
					};
					break;
				case "toolcall_delta":
					if (current?.kind === "tool") {
						target.blocks[contentIndex] = { ...current, argsText: current.argsText + String(delta.delta ?? "") };
					}
					break;
				case "toolcall_end":
					if (current?.kind === "tool") {
						target.blocks[contentIndex] = { ...current, done: true };
					}
					break;
				default:
					break;
			}

			target.blocks = shrinkBlocks(target.blocks);
			if (event.usage) target.usage = event.usage as ChatMessage["usage"];
			messages[index] = target;
			return { ...state, messages };
		}

		case "message_end": {
			const message = event.message as Record<string, unknown> | undefined;
			const role = message?.role;
			if (role === "toolResult") {
				const paired = state.messages.findIndex((m) => m.blocks.some((b) => b.kind === "tool" && b.id === message?.toolCallId));
				const index = paired >= 0 ? paired : lastAssistantIndex(state.messages);
				if (index < 0) return state;
				const messages = [...state.messages];
				messages[index] = {
					...messages[index],
					blocks: [...messages[index].blocks, ...parseBlocks([{ ...message, type: "toolResult" }])],
				};
				return { ...state, messages };
			}
			if (role !== "user" && role !== "assistant") return state;

			const index = lastIndexOfRole(state.messages, role);
			const finalised: ChatMessage = {
				id: index >= 0 ? state.messages[index].id : nextId(role),
				role,
				blocks: parseBlocks(message?.content),
				streaming: false,
				provider: typeof message?.provider === "string" ? message.provider : undefined,
				model: typeof message?.model === "string" ? message.model : undefined,
				usage: message?.usage as ChatMessage["usage"],
				routeSnapshot: role === "assistant" ? snapshotForResponse({ provider: typeof message?.provider === "string" ? message.provider : undefined, model: typeof message?.model === "string" ? message.model : undefined }, state.model, options.offers ?? []) ?? (index >= 0 ? state.messages[index].routeSnapshot : undefined) : undefined,
				stopReason: typeof message?.stopReason === "string" ? message.stopReason : undefined,
				durationMs: index >= 0 ? state.messages[index].durationMs : undefined,
				timestamp: index >= 0 ? state.messages[index].timestamp : timestamp(message?.timestamp),
			};

			if (index < 0) return { ...state, messages: [...state.messages, finalised] };
			const messages = [...state.messages];
			messages[index] = finalised;
			return { ...state, messages, ...(typeof message?.errorMessage === "string" ? { lastError: message.errorMessage } : {}) };
		}

		case "turn_duration": {
			const durationMs = typeof event.durationMs === "number" ? Math.max(0, event.durationMs) : 0;
			const index = lastAssistantIndex(state.messages);
			if (index < 0) return state;
			const messages = [...state.messages];
			const completedAt = typeof event.completedAt === "number" ? event.completedAt : messages[index].timestamp;
			messages[index] = { ...messages[index], durationMs, timestamp: completedAt };
			return { ...state, messages };
		}

		case "thinking_level_changed":
			return { ...state, thinkingLevel: typeof event.level === "string" ? event.level : state.thinkingLevel };

		case "extension_ui_request": {
			if (event.method === "notify" && typeof event.message === "string") {
				const kind = event.notifyType === "error" || event.notifyType === "warning" ? event.notifyType : "info";
				return {
					...state,
					notices: [...state.notices, { id: nextId("notice"), kind, text: event.message }],
				};
			}
			return state;
		}

		case "error":
			return {
				...state,
				lastError: String(event.errorMessage ?? event.message ?? "unknown error"),
			};

		default:
			return state;
	}
}
