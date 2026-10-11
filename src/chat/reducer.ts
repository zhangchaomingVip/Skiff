import { parseBlocks } from "./parse";
import type { ChatMessage, ContentBlock, SessionState } from "./types";
import type { RpcEvent } from "../rpc/RpcClient";
import type { RuntimeOffer } from "./modelFamilies";
import { snapshotForResponse } from "./routeSnapshot";
import { processEvent, type VoyageEvent } from "./voyageTimeline";

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

function reduceChat(state: SessionState, event: RpcEvent, options: ReducerOptions = {}): SessionState {
	switch (event.type) {
		case "prompt_start": {
			const startedAt = timestamp(event.startedAt);
			const message = event.message as ChatMessage | undefined;
			if (startedAt === undefined || typeof event.promptId !== "string" || message?.role !== "user" || typeof message.id !== "string") return state;
			return {
				...state, isStreaming: true, lastError: undefined,
				activeRun: { startedAt, turnId: `turn:${message.id}`, promptId: event.promptId },
				pendingPrompt: { id: event.promptId, userMessage: message },
			};
		}

		case "prompt_cancel":
			if (state.activeRun?.promptId !== event.promptId) return state;
			return { ...state, isStreaming: false, activeRun: undefined, pendingPrompt: undefined };

		case "agent_start": {
			const startedAt = timestamp(event.startedAt);
			return { ...state, isStreaming: true, lastError: undefined, activeRun: state.activeRun ?? (startedAt === undefined ? undefined : { startedAt }) };
		}

		case "agent_settled":
		case "agent_end":
		case "bridge_exit": {
			const settled = state.activeRun?.turnId && typeof event.durationMs === "number"
				? reduceChat(state, { type: "turn_duration", turnId: state.activeRun.turnId, durationMs: event.durationMs, completedAt: event.completedAt }, options)
				: state;
			return {
				...settled,
				isStreaming: false,
				activeRun: undefined,
				pendingPrompt: undefined,
				messages: settled.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
				...(event.type === "bridge_exit" ? { lastError: String(event.message) } : {}),
			};
		}

		case "message_start": {
			const message = event.message as Record<string, unknown> | undefined;
			const role = message?.role;
			if (role !== "user" && role !== "assistant") return state; // drop system prompt
			const chat: ChatMessage = {
				id: role === "user" ? state.pendingPrompt?.userMessage?.id ?? nextId(role) : nextId(role),
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
			const activeRun = state.activeRun && (role === "user" || state.messages.length === 0) ? { ...state.activeRun, turnId: `turn:${chat.id}` } : state.activeRun;
			const pendingPrompt = role === "assistant" ? undefined : state.pendingPrompt ? { ...state.pendingPrompt, userMessage: undefined } : undefined;
			return { ...state, activeRun, pendingPrompt, messages: [...state.messages, chat] };
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
			const userIndex = lastIndexOfRole(state.messages, "user");
			if (index < 0 || index < userIndex) return state;
			const turnId = `turn:${state.messages[userIndex >= 0 ? userIndex : 0].id}`;
			if (typeof event.turnId === "string" && event.turnId !== turnId) return state;
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

const finite = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" ? value as Record<string, unknown> : undefined;
const textTokens = (value: unknown): number => {
	if (typeof value !== "string") return 0;
	let units = 0;
	for (const char of value) {
		if (/\s/.test(char)) continue;
		units += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : .25;
	}
	return Math.ceil(units);
};
const atOf = (state: SessionState, event: RpcEvent): number => finite(event.voyageAt) ?? finite(event.startedAt) ?? finite(event.completedAt) ?? state.voyageTimeline?.at ?? state.activeRun?.startedAt ?? 0;

function usageEvent(at: number, value: unknown): VoyageEvent | undefined {
	const usage = record(value);
	if (!usage) return undefined;
	const output = finite(usage.output);
	const reportedContext = finite(usage.totalTokens);
	const channels = [usage.input, usage.cacheRead, usage.cacheWrite, usage.output].map(finite);
	const context = reportedContext ?? (channels.every((item) => item !== undefined) ? channels.reduce((sum, item) => sum + (item ?? 0), 0) : undefined);
	if (output === undefined && context === undefined) return undefined;
	return { type: "usage", at, ...(output === undefined ? {} : { output }), ...(context === undefined ? {} : { context }) };
}

/** Translate pi's wire events into the small, independently testable voyage protocol. */
function voyageEventsFor(state: SessionState, event: RpcEvent): VoyageEvent[] {
	const at = atOf(state, event);
	if (event.type === "tool_start" || event.type === "tool_use") {
		const tool = record(event.tool) ?? record(event.tool_use) ?? event;
		const id = String(tool.id ?? tool.toolCallId ?? `tool:${at}`);
		return [{ type: "tool_start", id, name: String(tool.name ?? tool.toolName ?? "tool"), summary: typeof tool.arguments === "string" ? tool.arguments : JSON.stringify(tool.arguments ?? ""), at }];
	}
	if (event.type === "tool_result" || event.type === "tool_complete") {
		const id = event.id ?? event.toolCallId;
		if (typeof id !== "string") return [];
		return [{ type: "tool_complete", id, result: typeof event.result === "string" ? event.result : typeof event.text === "string" ? event.text : undefined, success: event.success !== false && event.isError !== true, at }];
	}
	if (event.type === "text_delta") return [{ type: "output_delta", at, estimatedTokens: textTokens(event.delta) }];
	if (event.type === "stop") return [{ type: "run_end", at, status: event.reason === "aborted" ? "aborted" : event.reason === "error" ? "failed" : "completed" }];
	if (event.type === "prompt_start") {
		return [{ type: "run_start", key: `run:${String(event.promptId ?? at)}`, at, phase: "thinking" }];
	}
	if (event.type === "agent_start") {
		const run = state.activeRun;
		return [{ type: "run_start", key: `run:${run?.promptId ?? run?.startedAt ?? at}`, at, phase: "thinking" }];
	}
	if (event.type === "prompt_cancel") return state.activeRun?.promptId === event.promptId ? [{ type: "run_end", at, status: "aborted" }] : [];
	if (event.type === "agent_end" || event.type === "agent_settled") return [{ type: "run_end", at, status: "completed" }];
	if (event.type === "bridge_exit") return [{ type: "run_end", at, status: "failed" }];
	if (event.type === "error") return [{ type: "run_end", at, status: "failed" }];
	if (event.type === "message_update") {
		const delta = record(event.assistantMessageEvent);
		if (!delta) return [];
		const type = String(delta.type ?? "");
		const events: VoyageEvent[] = [];
		if (type === "thinking_start" || type === "thinking_delta" || type === "thinking_end") events.push({ type: "phase", phase: "thinking", at });
		if (type === "toolcall_start") events.push({ type: "tool_start", id: String(delta.id ?? `tool:${at}`), name: String(delta.toolName ?? "tool"), at });
		if (type === "text_delta") events.push({ type: "output_delta", at, estimatedTokens: textTokens(delta.delta) });
		const usage = usageEvent(at, event.usage ?? delta.usage);
		if (usage) events.push(usage);
		return events;
	}
	if (event.type === "message_end") {
		const message = record(event.message);
		if (!message) return [];
		const events: VoyageEvent[] = [];
		if (message.role === "toolResult") {
			const id = message.toolCallId ?? message.id;
			const content = Array.isArray(message.content) ? message.content : [];
			const result = content.map((item) => { const part = record(item); return typeof part?.text === "string" ? part.text : ""; }).filter(Boolean).join(" ") || (typeof message.content === "string" ? message.content : undefined);
			if (typeof id === "string") events.push({ type: "tool_complete", id, result, success: message.isError !== true, at });
		} else if (message.role === "assistant") {
			for (const block of (Array.isArray(message.content) ? message.content : [])) {
				const item = record(block);
				if (item?.type === "toolCall" || item?.type === "tool_call") events.push({ type: "tool_start", id: String(item.id ?? `tool:${at}`), name: String(item.name ?? "tool"), summary: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? ""), at });
			}
			const usage = usageEvent(at, message.usage);
			if (usage) events.push(usage);
			const stop = String(message.stopReason ?? "");
			if (["stop", "length", "error", "aborted"].includes(stop)) events.push({ type: "run_end", at, status: stop === "aborted" ? "aborted" : stop === "error" ? "failed" : "completed" });
		}
		return events;
	}
	return [];
}

export function reduce(state: SessionState, event: RpcEvent, options: ReducerOptions = {}): SessionState {
	const next = reduceChat(state, event, options);
	const events = voyageEventsFor(state, event);
	if (!events.length) return next;
	let timeline = state.voyageTimeline;
	for (const voyageEvent of events) {
		if (!timeline && voyageEvent.type !== "run_start") timeline = processEvent(undefined, { type: "run_start", key: `run:${state.activeRun?.promptId ?? state.activeRun?.startedAt ?? voyageEvent.at}`, at: voyageEvent.at, phase: "thinking" });
		timeline = processEvent(timeline, voyageEvent);
	}
	return { ...next, voyageTimeline: timeline };
}
