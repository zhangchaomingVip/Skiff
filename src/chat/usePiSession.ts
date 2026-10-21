import { fingerprint, locateMessage, runtimeHistory, type MessageLocation } from "./historySearch";
import { DialogRuntime, emptyQueue, extensionDialog, queueSize, type Delivery, type DialogReply } from "./interactions";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { listen } from "@tauri-apps/api/event";
import { PiRpc, type RpcEvent } from "../rpc/RpcClient";
import { parseMessages, parseModels } from "./parse";
import { reduce } from "./reducer";
import { forkEntry, forkTurn } from "./turns";
import { loadAppendPrompt } from "./prompt";
import { initialSessionState, type ContextUsage, type ImageAttachment, type ModelInfo, type SessionState } from "./types";
import type { RuntimeOffer } from "./modelFamilies";
import { attachHistoricalSnapshots } from "./routeSnapshot";
import type { FamiliesConfig } from "./useModelFamilies";

export interface SessionTarget {
	id: string;
	cwd: string;
	sessionFile?: string;
	elapsedMs?: number;
	model?: ModelInfo;
	routeSnapshots?: Array<import("./types").RouteSnapshot | null>;
}

export interface PiCommand {
	name: string;
	description?: string;
	/** Where the command came from; `extension` means pi loaded a Skiff add-on. */
	source?: string;
}

export interface PiSessionActions {
	rewind: (id: string, expected?: { target: MessageLocation; branchVersion: string }, onFork?: (sessionFile?: string) => void) => Promise<boolean>;
	getCommands: () => Promise<PiCommand[]>;
	captureEdit: (id: string) => Promise<{ target: MessageLocation; branchVersion: string } | undefined>;
	validateEdit: (target: MessageLocation, branchVersion: string) => Promise<string | undefined>;
	prompt: (text: string, images?: ImageAttachment[], delivery?: Delivery) => Promise<boolean>;
	abort: () => Promise<void>;
	clearQueue: () => Promise<void>;
	replyDialog: (id: string, reply: DialogReply) => Promise<boolean>;
	setModel: (model: ModelInfo) => Promise<boolean>;
	setThinkingLevel: (level: string) => Promise<void>;
	/** Toggles the pi extension's `web_search` tool via its `/web` command. */
	setWebSearch: (enabled: boolean) => Promise<void>;
	clearError: () => void;
}

function parseCommands(raw: unknown): PiCommand[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item) => {
			const record = (item ?? {}) as Record<string, unknown>;
			const name = typeof record.name === "string" ? record.name : String(((record.name as Record<string, unknown> | undefined)?.name) ?? "");
			return {
				name,
				description: typeof record.description === "string" ? record.description : undefined,
				source: typeof record.source === "string" ? record.source : undefined,
			};
		})
		.filter((command) => command.name.length > 0);
}

export function parseContextUsage(raw: unknown, version: number): ContextUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	const value = record.contextUsage;
	if (!value || typeof value !== "object") return undefined;
	const context = value as Record<string, unknown>;
	const window = typeof context.contextWindow === "number" && Number.isFinite(context.contextWindow) && context.contextWindow > 0 ? context.contextWindow : undefined;
	const tokens = context.tokens === null ? null : typeof context.tokens === "number" && Number.isFinite(context.tokens) && context.tokens >= 0 ? context.tokens : null;
	return { tokens, ...(window === undefined ? {} : { contextWindow: window }), source: "pi", estimated: tokens !== null, version };
}

const isContextRefreshEvent = (type: string | undefined) => Boolean(type && /message_end|agent_end|agent_settled|compaction|compact|context_reset/i.test(type));

let nextGeneration = 0;

export interface SessionOwner {
	id?: string;
	cwd?: string;
	generation: number;
}

/** Managed selections are valid only while their projected route is live. */
export function preferredModelIsConfigured(preferred: Pick<ModelInfo, "provider" | "id" | "modelId">, offers: readonly RuntimeOffer[]): boolean {
	if (!preferred.provider.startsWith("skiff-")) return true;
	const modelId = preferred.modelId ?? preferred.id;
	return offers.some((offer) => offer.providerKey === preferred.provider && offer.modelId === modelId);
}

interface SessionSnapshot {
	owner: SessionOwner;
	phase: "loading" | "ready" | "error";
	state: SessionState;
	readyId?: string;
	loadedId?: string;
	loadedConfig?: FamiliesConfig;
	sessionFile?: string;
	rawLines: string[];
	pending: boolean;
	elapsedMs: number;
}

/** A real pi session per conversation; transcripts stay in pi's files. */
export function usePiSession(target?: SessionTarget, runtimeOffers: readonly RuntimeOffer[] = [], configuration?: { config?: FamiliesConfig; ready: boolean }) {
	// Reconnects serialize only this conversation's teardown and startup.
	const previousTeardown = useRef<Promise<void>>(Promise.resolve());
	const rpcRef = useRef<PiRpc | null>(null);
	const busyRef = useRef(false);
	const streamingRef = useRef(false);
	const stoppingRef = useRef(false);
	const submissionsRef = useRef(0);
	const startsRef = useRef(0);
	const dialogsRef = useRef<DialogRuntime>();
	const queueRef = useRef(emptyQueue());
	const [revision, setRevision] = useState(0);
	const runStarted = useRef<number>();
	const contextVersionRef = useRef(0);
	const promptRef = useRef<{ id: string; cancelled: boolean }>();
	const preferredModel = useRef<{ chatId?: string; cwd?: string; model?: ModelInfo }>();
	const runtimeOffersRef = useRef(runtimeOffers);
	runtimeOffersRef.current = runtimeOffers;
	// Saving a newly assigned pi file must not restart the running session.
	const targetRef = useRef(target);
	targetRef.current = target;
	const configurationRef = useRef(configuration);
	configurationRef.current = configuration;
	// Finish initial migration before spawning. Refreshes with an existing
	// configuration leave the current conversation running until it is idle.
	const configurationReady = !configuration || configuration.ready || !!configuration.config;
	const owner = useMemo<SessionOwner>(() => ({ id: target?.id, cwd: target?.cwd, generation: ++nextGeneration }), [target?.id, target?.cwd, revision, configurationReady]);
	if (preferredModel.current && (preferredModel.current.chatId !== owner.id || preferredModel.current.cwd !== owner.cwd)) preferredModel.current = undefined;
	const ownerRef = useRef<SessionOwner>();
	ownerRef.current = owner;
	const empty = useMemo<SessionSnapshot>(() => ({ owner, phase: "loading", state: initialSessionState, rawLines: [], pending: false, elapsedMs: targetRef.current?.elapsedMs ?? 0 }), [owner]);
	const [snapshot, setSnapshot] = useState(empty);
	// Project ownership during render, before effects mount a newly keyed chat.
	// ID alone is insufficient for A→B→A, reconnects and cwd changes.
	const visible = snapshot.owner === owner ? snapshot : empty;
	const { state, readyId, loadedId, loadedConfig, sessionFile, rawLines, pending, elapsedMs, phase } = visible;
	const stateRef = useRef(state);
	stateRef.current = state;
	const setters = useMemo(() => {
		function field<K extends keyof SessionSnapshot>(key: K): Dispatch<SetStateAction<SessionSnapshot[K]>> {
			return (update) => {
				if (ownerRef.current !== owner) return;
				setSnapshot((previous) => {
					if (ownerRef.current !== owner) return previous;
					const current = previous.owner === owner ? previous : empty;
					const value = typeof update === "function" ? (update as (value: SessionSnapshot[K]) => SessionSnapshot[K])(current[key]) : update;
					return { ...current, [key]: value };
				});
			};
		}
		return { setState: field("state"), setReadyId: field("readyId"), setLoadedId: field("loadedId"), setLoadedConfig: field("loadedConfig"), setSessionFile: field("sessionFile"), setRawLines: field("rawLines"), setPending: field("pending"), setElapsedMs: field("elapsedMs"), setPhase: field("phase") };
	}, [owner, empty]);
	const { setState, setReadyId, setLoadedId, setLoadedConfig, setSessionFile, setRawLines, setPending, setElapsedMs, setPhase } = setters;
	const connected = !!target && readyId === target.id;
	const isCurrent = useCallback(() => ownerRef.current === owner, [owner]);
	const ownsRpc = useCallback((rpc: PiRpc | null) => isCurrent() && !!rpc && rpcRef.current === rpc, [isCurrent]);

	const fail = useCallback((error: unknown) => {
		setState((s) => ({ ...s, lastError: error instanceof Error ? error.message : String(error) }));
		setPhase((value) => value === "loading" ? "error" : value);
	}, [setState, setPhase]);

	useEffect(() => {
		ownerRef.current = owner;
		const selected = targetRef.current;
		if (!selected || !configurationReady) return () => { if (ownerRef.current === owner) ownerRef.current = undefined; };
		const rpc = new PiRpc(`chat_${crypto.randomUUID()}`);
		rpcRef.current = rpc;
		let cancelled = false;
		const current = () => !cancelled && isCurrent();
		contextVersionRef.current = 0;
		let contextInFlight = false;
		let contextPending = false;
		const invalidateContext = () => {
			contextVersionRef.current++;
			setState((s) => ({ ...s, contextUsage: undefined }));
		};
		const refreshContext = async () => {
			if (!current()) return;
			if (contextInFlight) { contextPending = true; return; }
			contextInFlight = true;
			const version = contextVersionRef.current;
			try {
				const result = await rpc.request<Record<string, unknown>>({ type: "get_session_stats" });
				if (current() && version === contextVersionRef.current) {
					const reading = parseContextUsage(result, version);
					// Missing contextUsage means an older pi. Leave the field absent so
					// the metrics hook uses its local compatibility path.
					if (reading) setState((s) => ({ ...s, contextUsage: reading }));
				}
			} catch {
				// A transient stats failure must never interrupt a chat run. An
				// invalidated snapshot is intentionally not restored here.
			} finally {
				contextInFlight = false;
				if (contextPending) { contextPending = false; void refreshContext(); }
			}
		};
		// pi's provider errors go to stderr; without this they are silently dropped.
		const offStderr = listen<string>(`rpc-stderr://${rpc.instanceId}`, (e) => {
			if (current() && e.payload) setRawLines((prev) => [...prev.slice(-499), `[stderr] ${e.payload}`]);
		});
		setReadyId(undefined);
		setLoadedId(undefined);
		setLoadedConfig(undefined);
		setSessionFile(undefined);
		setState(initialSessionState);
		setRawLines([]);
		setPending(false);
		setElapsedMs(selected.elapsedMs ?? 0);
		setPhase("loading");
		runStarted.current = undefined;
		promptRef.current = undefined;
		busyRef.current = false;
		streamingRef.current = false;
		stoppingRef.current = false;
		submissionsRef.current = 0;
		queueRef.current = emptyQueue();
		const dispatch = (event: RpcEvent) => setState((s) => reduce(s, event, { offers: runtimeOffersRef.current }));
		const dialogs = new DialogRuntime((command) => rpc.sendCommand(command), dispatch);
		dialogsRef.current = dialogs;
		const recheckDialogs = () => dialogs.recheck();
		window.addEventListener("focus", recheckDialogs);
		document.addEventListener("visibilitychange", recheckDialogs);
		let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
		let lifecycle = 0;
		let hasSettled = false;
		let maintenance = false;
		const settleFallback = async (epoch: number) => {
			try {
				const data = await rpc.request<Record<string, unknown>>({ type: "get_state" });
				if (!current() || hasSettled || maintenance || epoch !== lifecycle) return;
				if (data.isStreaming || data.isCompacting || Number(data.pendingMessageCount) > 0) {
					fallbackTimer = setTimeout(() => void settleFallback(epoch), 150); return;
				}
				// Recheck across a second event-loop boundary for older pi versions.
				fallbackTimer = setTimeout(() => { void rpc.request<Record<string, unknown>>({ type: "get_state" }).then((again) => {
					if (!current() || hasSettled || maintenance || epoch !== lifecycle) return;
					if (again.isStreaming || again.isCompacting || Number(again.pendingMessageCount) > 0) { void settleFallback(epoch); return; }
					onEvent({ type: "agent_settled", synthetic: true });
				}).catch(() => {}); }, 100);
			} catch { /* Do not unlock on an unverified idle state. */ }
		};
		const onEvent = (event: RpcEvent) => {
			if (!current()) return;
			if (isContextRefreshEvent(event.type)) {
				if (/compaction|compact|context_reset/i.test(event.type ?? "")) invalidateContext();
				void refreshContext();
			}
			const now = Date.now();
			if (extensionDialog(event, now) && !dialogs.add(event)) return;
			if (event.type === "queue_update") queueRef.current = { steering: Array.isArray(event.steering) ? event.steering as string[] : [], followUp: Array.isArray(event.followUp) ? event.followUp as string[] : [] };
			if (event.type === "agent_start") { startsRef.current++; lifecycle++; clearTimeout(fallbackTimer); }
			if (event.type === "agent_settled") { if (!event.synthetic) hasSettled = true; lifecycle++; clearTimeout(fallbackTimer); }
			if (event.type === "auto_retry_start" || event.type === "auto_compaction_start") { maintenance = true; lifecycle++; clearTimeout(fallbackTimer); }
			if (event.type === "auto_retry_end" || event.type === "auto_compaction_end") {
				maintenance = false;
				if (!hasSettled) { const epoch = lifecycle; clearTimeout(fallbackTimer); fallbackTimer = setTimeout(() => void settleFallback(epoch), 150); }
			}
			if (event.type === "agent_end" && !hasSettled && !event.willRetry && !maintenance) { const epoch = lifecycle; clearTimeout(fallbackTimer); fallbackTimer = setTimeout(() => void settleFallback(epoch), 150); }
			if (event.type === "agent_start" && runStarted.current === undefined) runStarted.current = now;
			let duration: number | undefined;
			if (["agent_settled", "bridge_exit"].includes(String(event.type)) && runStarted.current !== undefined) {
				duration = Math.max(0, now - runStarted.current);
				setElapsedMs((ms) => ms + (duration ?? 0));
				runStarted.current = undefined;
			}
			if (event.type === "bridge_exit") {
				dialogs.dispose();
				setPhase("error");
				setReadyId(undefined);
				setPending(false);
				streamingRef.current = false;
			}
			if (event.type === "agent_start") streamingRef.current = true;
			if (event.type === "agent_settled") streamingRef.current = false;
			const timedEvent = { ...event, voyageAt: now, ...(event.type === "agent_start" ? { startedAt: runStarted.current } : {}), ...(duration === undefined ? {} : { durationMs: duration, completedAt: now }) };
			setState((s) => {
				const options = { offers: runtimeOffersRef.current };
				return reduce(s, timedEvent, options);
			});
		};
		const offEvent = rpc.onEvent(onEvent);
		const offLine = rpc.onLine((line) => {
			if (current()) setRawLines((prev) => [...prev.slice(-499), line]);
		});
		const preceding = previousTeardown.current;
		let startupConfig: FamiliesConfig | undefined;
		const spawned = preceding.then(async () => {
			if (!current()) return;
			startupConfig = configurationRef.current?.config;
			await rpc.start({ cwd: selected.cwd, appendSystemPrompt: loadAppendPrompt() });
		});
		void (async () => {
			try {
				await spawned;
				if (!current()) return;
				if (selected.sessionFile) {
					const result = await rpc.request<{ cancelled?: boolean }>({ type: "switch_session", sessionPath: selected.sessionFile });
					if (result.cancelled) throw new Error("pi 扩展取消了聊天切换，未载入该聊天。");
				}
				if (!current()) return;
				const preferred = preferredModel.current?.chatId === selected.id ? preferredModel.current.model ?? selected.model : selected.model;
				preferredModel.current = undefined;
				let unavailableModel: ModelInfo | undefined;
				let selectionError: unknown;
				if (preferred) {
					// Managed provider keys are derived from the current route projection.
					// Do not ask pi to select a stale key from the workspace index: pi
					// reports that as a fatal "Model not found" error before the route
					// reconciler gets a chance to switch to a live offer.
					if (!preferredModelIsConfigured(preferred, runtimeOffersRef.current)) unavailableModel = preferred;
					else {
						try { await rpc.request({ type: "set_model", provider: preferred.provider, modelId: preferred.id }); }
						catch (error) { unavailableModel = preferred; selectionError = error; } // The app resolves removed/disabled models after loading configuration.
					}
				}
				if (!current()) return;
				const [data, models, transcript, levels, stats] = await Promise.all([
					rpc.request<Record<string, unknown>>({ type: "get_state" }),
					rpc.request<{ models?: unknown }>({ type: "get_available_models" }),
					rpc.request<{ messages?: unknown }>({ type: "get_messages" }),
					rpc.request<{ levels?: string[] }>({ type: "get_available_thinking_levels" }).catch(() => ({ levels: [] })),
					rpc.request<Record<string, unknown>>({ type: "get_session_stats" }).catch(() => ({})),
				]);
				if (!current()) return;
				const availableModels = parseModels(models.models);
				const parsedModel = parseModels([data.model])[0];
				// A saved model can disappear between sessions, and pi can also reject
				// a provider while still having a usable default model. Do not turn that
				// recoverable selection failure into a dead session: keep pi's reported
				// model so the route reconciler can continue with the live configuration.
				const restoredModel = selectionError || unavailableModel ? parsedModel : (parsedModel && preferred ? { ...parsedModel, offerId: preferred.offerId, routeId: preferred.routeId, modelId: preferred.modelId, familyId: preferred.familyId, familyName: preferred.familyName, relayId: preferred.relayId } : parsedModel);
				const messages = attachHistoricalSnapshots(parseMessages(transcript.messages), selected.routeSnapshots);
				const user = [...messages].reverse().find((message) => message.role === "user");
				const startedAt = Boolean(data.isStreaming) ? runStarted.current ?? user?.timestamp ?? Date.now() : undefined;
				runStarted.current = startedAt;
				setState((previous) => ({
					...initialSessionState, dialogs: previous.dialogs, queue: previous.queue, notices: previous.notices, model: restoredModel,
					steeringMode: typeof data.steeringMode === "string" ? data.steeringMode : undefined,
					followUpMode: typeof data.followUpMode === "string" ? data.followUpMode : undefined,
					thinkingLevel: typeof data.thinkingLevel === "string" ? data.thinkingLevel : undefined,
					thinkingLevels: levels.levels ?? [],
						availableModels, messages,
					isStreaming: Boolean(data.isStreaming),
					activeRun: startedAt === undefined ? undefined : { startedAt, turnId: user ? `turn:${user.id}` : undefined },
					contextUsage: parseContextUsage(stats, contextVersionRef.current),
				}));
				streamingRef.current = Boolean(data.isStreaming);
				setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
				setLoadedId(selected.id);
				setLoadedConfig(startupConfig);
				setReadyId(selected.id);
				setPhase("ready");
			} catch (error) {
				if (current()) fail(error);
			}
		})();
		return () => {
			const cancellation = dialogs.cancelAll().finally(() => dialogs.dispose());
			window.removeEventListener("focus", recheckDialogs);
			document.removeEventListener("visibilitychange", recheckDialogs);
			clearTimeout(fallbackTimer);
			cancelled = true;
			if (ownerRef.current === owner) ownerRef.current = undefined;
			runStarted.current = undefined;
			promptRef.current = undefined;
			void offStderr.then((off) => off());
			offEvent();
			offLine();
			// A late spawn must not become an orphan after switching conversations.
			// Cancel valid dialogs before stopping this generation. Only the spawn
			// and bounded cancellation writes delay teardown, never initialization RPCs.
			previousTeardown.current = spawned.catch(() => {}).then(() => cancellation).then(() => rpc.stop()).catch(() => {});
			if (rpcRef.current === rpc) rpcRef.current = null;
		};
	}, [owner, configurationReady, fail, isCurrent, setters]);

	const actions = useMemo<PiSessionActions>(() => ({
		getCommands: async () => {
			const rpc = rpcRef.current;
			if (!connected || !ownsRpc(rpc) || !rpc) return [];
			const result = await rpc.request<{ commands?: unknown }>({ type: "get_commands" });
			return ownsRpc(rpc) ? parseCommands(result?.commands) : [];
		},
		captureEdit: async (id) => {
			const rpc = rpcRef.current;
			if (!rpc || !ownsRpc(rpc) || streamingRef.current || stoppingRef.current || queueSize(queueRef.current)) return;
			try {
				const data = await rpc.request<{ entries: Parameters<typeof forkEntry>[2]; leafId: string | null }>({ type: "get_entries" });
				if (!ownsRpc(rpc)) return;
				const entryId = forkEntry(stateRef.current.messages, id, data.entries, data.leafId);
				const message = stateRef.current.messages.find((message) => message.id === id);
				if (!message || message.role !== "user") return;
				const version = JSON.stringify([sessionFile, data.leafId]);
				const history = runtimeHistory(stateRef.current.messages);
				const index = stateRef.current.messages.indexOf(message), key = fingerprint(history[index]);
				const matches = history.flatMap((item, i) => fingerprint(item) === key ? [i] : []);
				const location: MessageLocation = { chatId: owner.id!, sessionFile, version, fingerprint: key, occurrence: matches.indexOf(index), occurrences: matches.length, query: "" };
				return { target: { ...location, entryId }, branchVersion: version };
			} catch (error) { if (ownsRpc(rpc)) fail(error); }
		},
		validateEdit: async (target, branchVersion) => {
			const rpc = rpcRef.current;
			if (!rpc || !ownsRpc(rpc) || streamingRef.current || stoppingRef.current || queueSize(queueRef.current) || target.chatId !== owner.id || target.sessionFile !== sessionFile) return;
			const data = await rpc.request<{ entries: Parameters<typeof forkEntry>[2]; leafId: string | null }>({ type: "get_entries" });
			if (!ownsRpc(rpc) || JSON.stringify([sessionFile, data.leafId]) !== branchVersion) return;
			const index = locateMessage(runtimeHistory(stateRef.current.messages), target);
			const message = index === undefined ? undefined : stateRef.current.messages[index];
			if (!message || forkEntry(stateRef.current.messages, message.id, data.entries, data.leafId) !== target.entryId) return;
			return message.id;
		},
		rewind: async (id, expected, onFork) => {
			const rpc = rpcRef.current;
			if (!connected || !ownsRpc(rpc) || !rpc || busyRef.current || streamingRef.current || stoppingRef.current || queueSize(queueRef.current)) return false;
			busyRef.current = true; setPending(true);
			let forked = false;
			try {
				let accepted: boolean;
				if (expected) {
					const data = await rpc.request<{ entries: Parameters<typeof forkEntry>[2]; leafId: string | null }>({ type: "get_entries" });
					if (!ownsRpc(rpc) || JSON.stringify([sessionFile, data.leafId]) !== expected.branchVersion || expected.target.entryId !== forkEntry(stateRef.current.messages, id, data.entries, data.leafId)) throw new Error("聊天分支已变化，未执行编辑重发。");
					accepted = !(await rpc.request<{ cancelled?: boolean }>({ type: "fork", entryId: expected.target.entryId })).cancelled;
				} else accepted = await forkTurn(rpc, stateRef.current.messages, id);
				if (!ownsRpc(rpc)) return false;
				if (!accepted) { fail("pi 扩展取消了消息操作。"); return false; }
				forked = true;
				const [transcript, data] = await Promise.all([rpc.request<{ messages: unknown }>({ type: "get_messages" }), rpc.request<Record<string, unknown>>({ type: "get_state" })]);
				if (!ownsRpc(rpc)) return false;
				setState((s) => ({ ...s, messages: parseMessages(transcript.messages), lastError: undefined }));
				// A fork creates a new branch projection; never reuse the old branch's
				// context while the fresh stats request is in flight.
				contextVersionRef.current++;
				setState((s) => ({ ...s, contextUsage: undefined }));
				setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
				onFork?.(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
				try {
					const stats = await rpc.request<Record<string, unknown>>({ type: "get_session_stats" });
					if (ownsRpc(rpc)) setState((s) => ({ ...s, contextUsage: parseContextUsage(stats, contextVersionRef.current) }));
				} catch { /* old pi or a short-lived fork refresh failure */ }
				return true;
			} catch (error) {
				if (ownsRpc(rpc)) {
					fail(error);
					// If refresh failed after forking, reload the indexed original session.
					if (forked) { setReadyId(undefined); setRevision((value) => value + 1); }
				}
				return false;
			}
			finally { if (ownsRpc(rpc)) { busyRef.current = false; setPending(false); } }
		},
		prompt: async (text, images = [], delivery = "steer") => {
			const rpc = rpcRef.current;
			if (!connected || !ownsRpc(rpc) || !rpc || busyRef.current || stoppingRef.current || (!text.trim() && !images.length)) return false;
			const running = streamingRef.current || runStarted.current !== undefined;
			const startVersion = startsRef.current;
			// Reserve the run synchronously so rapid subsequent submissions queue.
			if (!running) { streamingRef.current = true; runStarted.current = Date.now(); }
			submissionsRef.current++;
			setPending(true);
			const prompt = { id: crypto.randomUUID(), cancelled: false };
			if (!running) {
				promptRef.current = prompt;
				setState((s) => reduce(s, { type: "prompt_start", promptId: prompt.id, startedAt: runStarted.current,
					message: { id: `pending_${prompt.id}`, role: "user", timestamp: runStarted.current, blocks: [...(text.trim() ? [{ kind: "text", text: text.trim() }] : []), ...images.map(({ data, mimeType }) => ({ kind: "image", data, mimeType }))] } }));
			}
			try {
				let type: string = running ? delivery : "prompt";
				if (running && text.trim().startsWith("/")) {
					const commands = await rpc.request<{ commands?: unknown }>({ type: "get_commands" });
					const name = text.trim().slice(1).split(/\s/)[0];
					if (parseCommands(commands.commands).some((command) => command.name === name && command.source === "extension")) type = "prompt";
				}
				if (!ownsRpc(rpc) || stoppingRef.current) return false;
				const result = await rpc.request<{ disposition?: string }>({ type, message: text.trim(), ...(running && type === "prompt" ? { streamingBehavior: delivery } : {}), ...(images.length ? { images: images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })) } : {}) });
				if (!ownsRpc(rpc)) return false;
				if (result?.disposition === "handled") {
					if (!running) { runStarted.current = undefined; streamingRef.current = false; }
					setState((s) => ({ ...(running ? s : reduce(s, { type: "prompt_cancel", promptId: prompt.id })), notices: [...s.notices, { id: prompt.id, kind: "info", text: "输入已由扩展处理。" }] }));
				}
				// Old pi may omit disposition. Its events and verified state remain authoritative.
				try {
					const data = await rpc.request<Record<string, unknown>>({ type: "get_state" });
					if (ownsRpc(rpc)) {
						setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
						if (!running && text.trim().startsWith("/") && !data.isStreaming && !data.isCompacting && !Number(data.pendingMessageCount)) {
							runStarted.current = undefined; streamingRef.current = false;
							setState((s) => reduce(s, { type: "prompt_cancel", promptId: prompt.id }));
						}
					}
				} catch { /* Acceptance already succeeded; a state refresh cannot unaccept input. */ }
				return true;
			} catch (error) {
				if (ownsRpc(rpc)) {
					if (!running && promptRef.current === prompt && startsRef.current === startVersion) { runStarted.current = undefined; streamingRef.current = false; setState((s) => reduce(s, { type: "prompt_cancel", promptId: prompt.id })); }
					fail(`发送未被确认（请确认 pi 支持当前投递方式）：${error instanceof Error ? error.message : String(error)}`);
				}
				return false;
			} finally { if (ownsRpc(rpc)) { submissionsRef.current--; setPending(submissionsRef.current > 0); } }
		},
		clearQueue: async () => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || !ownsRpc(rpc) || stoppingRef.current) return;
			try { const result = await rpc.request<Record<string, unknown>>({ type: "clear_queue" }); if (ownsRpc(rpc)) setState((s) => reduce(s, { type: "queue_withdrawn", ...result })); }
			catch (error) { if (ownsRpc(rpc)) fail(error); }
		},
		replyDialog: async (id, reply) => await dialogsRef.current?.reply(id, reply) ?? false,
		abort: async () => {
			const rpc = rpcRef.current;
			if (!connected || !ownsRpc(rpc) || !rpc || stoppingRef.current || (!streamingRef.current && runStarted.current === undefined && !queueSize(queueRef.current))) return;
			stoppingRef.current = true;
			const turnId = stateRef.current.activeRun?.turnId;
			setState((s) => reduce(s, { type: "stop_pending" }));
			let cleared = true; let stopped = false;
			let wasRunning = true;
			try {
				const before = await rpc.request<Record<string, unknown>>({ type: "get_state" }).catch(() => undefined);
				wasRunning = !before || !!before.isStreaming || !!before.isCompacting || Number(before.pendingMessageCount) > 0 || !!stateRef.current.dialogs?.length || !!stateRef.current.retrying;
				if (!ownsRpc(rpc) || !wasRunning) return;
				try { const result = await rpc.request<Record<string, unknown>>({ type: "clear_queue" }); if (ownsRpc(rpc)) setState((s) => reduce(s, { type: "queue_withdrawn", ...result })); }
				catch { cleared = false; if (ownsRpc(rpc)) fail("未能确认队列已清空，仍将尝试中止运行。"); }
				await dialogsRef.current?.cancelAll();
				if (!ownsRpc(rpc)) return;
				await rpc.request({ type: "abort" });
				const deadline = Date.now() + 10000;
				while (ownsRpc(rpc)) {
					const data = await rpc.request<Record<string, unknown>>({ type: "get_state" });
					if (!data.isStreaming && !data.isCompacting && !Number(data.pendingMessageCount)) { stopped = true; break; }
					if (Date.now() >= deadline) throw new Error("尚未确认运行收束，请稍后再试。");
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				if (ownsRpc(rpc) && stopped) {
					const now = Date.now(), duration = runStarted.current === undefined ? undefined : Math.max(0, now - runStarted.current);
					if (duration !== undefined) setElapsedMs((value) => value + duration);
					streamingRef.current = false; runStarted.current = undefined;
					setState((s) => reduce(s, { type: "agent_settled", voyageAt: now, durationMs: duration, completedAt: now }));
				}
			} catch (error) { if (ownsRpc(rpc)) fail(error); }
			finally { if (ownsRpc(rpc)) {
				stoppingRef.current = false;
				setState((s) => ({ ...reduce(s, { type: "stop_finished", success: stopped && cleared && wasRunning, turnId }), ...(!cleared ? { notices: [...s.notices, { id: crypto.randomUUID(), kind: "warning" as const, text: "未能确认队列已清空；本次停止未获完整确认。" }] } : {}) }));
			} }
		},
		setModel: async (model) => {
			const rpc = rpcRef.current;
			if (!connected || !ownsRpc(rpc) || !rpc || busyRef.current || streamingRef.current || stoppingRef.current || queueSize(queueRef.current)) return false;
			busyRef.current = true;
			setPending(true);
			try {
				const result = await rpc.request<ModelInfo>({ type: "set_model", provider: model.provider, modelId: model.id });
				if (!ownsRpc(rpc)) return false;
				const parsed = parseModels([result])[0];
				contextVersionRef.current++;
				setState((s) => ({ ...s, contextUsage: undefined }));
				setState((s) => ({ ...s, model: parsed ? { ...parsed, offerId: model.offerId, routeId: model.routeId, modelId: model.modelId ?? model.id, familyId: model.familyId, familyName: model.familyName, relayId: model.relayId } : parsed, thinkingLevels: [], thinkingLevel: undefined, lastError: undefined }));
				const [data, levels] = await Promise.all([rpc.request<Record<string, unknown>>({ type: "get_state" }), rpc.request<{ levels: string[] }>({ type: "get_available_thinking_levels" }).catch(() => ({ levels: [] }))]);
				if (!ownsRpc(rpc)) return false;
				setState((s) => ({ ...s, thinkingLevel: String(data.thinkingLevel ?? "off"), thinkingLevels: levels.levels }));
				// get_session_stats is intentionally best effort for old pi builds.
				try {
					const stats = await rpc.request<Record<string, unknown>>({ type: "get_session_stats" });
					if (ownsRpc(rpc)) setState((s) => ({ ...s, contextUsage: parseContextUsage(stats, contextVersionRef.current) }));
				} catch { /* compatibility path remains active */ }
				return true;
			} catch (error) { if (ownsRpc(rpc)) fail(error); return false; } finally { if (ownsRpc(rpc)) { setPending(false); busyRef.current = false; } }
		},
		setThinkingLevel: async (level) => {
			const rpc = rpcRef.current;
			if (!connected || !ownsRpc(rpc) || !rpc || busyRef.current || streamingRef.current) return;
			busyRef.current = true; setPending(true);
			try {
				await rpc.request({ type: "set_thinking_level", level });
				if (!ownsRpc(rpc)) return;
				const data = await rpc.request<Record<string, unknown>>({ type: "get_state" });
				if (!ownsRpc(rpc)) return;
				const applied = String(data.thinkingLevel ?? "off");
				setState((s) => ({
					...s, thinkingLevel: applied,
					// pi clamps a level the model does not declare instead of
					// failing; say so rather than showing a silently changed value.
					notices: applied === level || level === "off" ? s.notices : [...s.notices, { id: crypto.randomUUID(), kind: "warning" as const, text: `该模型不支持 ${level}，已改用 ${applied === "off" ? "关闭推理" : applied}。` }],
				}));
			} catch (error) { if (ownsRpc(rpc)) fail(error); } finally { if (ownsRpc(rpc)) { busyRef.current = false; setPending(false); } }
		},
		setWebSearch: async (enabled) => {
			const rpc = rpcRef.current;
			if (!connected || !ownsRpc(rpc) || !rpc || busyRef.current || streamingRef.current) return;
			busyRef.current = true;
			setPending(true);
			try {
				// pi expands leading slashes into extension commands, so this never
				// reaches the model as a chat message.
				await rpc.request({ type: "prompt", message: `/web ${enabled ? "on" : "off"}` });
			} catch (error) { if (ownsRpc(rpc)) fail(error); } finally { if (ownsRpc(rpc)) { busyRef.current = false; setPending(false); } }
		},
		clearError: () => setState((s) => ({ ...s, lastError: undefined })),
	}), [connected, fail, ownsRpc, setters, sessionFile, owner.id]);

	// Stable identity: callers restart the session from effects and must not
	// re-trigger on every render.
	const reconnect = useCallback((model?: ModelInfo) => {
		preferredModel.current = { chatId: targetRef.current?.id, cwd: targetRef.current?.cwd, model };
		// Invalidate callbacks immediately, including the gap before React renders.
		ownerRef.current = undefined;
		setRevision((revision) => revision + 1);
	}, []);
	const canNavigate = useCallback(() => !busyRef.current && !streamingRef.current && !stoppingRef.current && !submissionsRef.current && !queueSize(queueRef.current) && runStarted.current === undefined, []);

	return useMemo(() => ({ owner, phase, loading: !!target && phase === "loading", isCurrent, canNavigate, state, connected, rawLines, actions, sessionFile, loadedId, loadedConfig, pending, elapsedMs, reconnect }), [owner, phase, !!target, isCurrent, canNavigate, state, connected, rawLines, actions, sessionFile, loadedId, loadedConfig, pending, elapsedMs, reconnect]);
}
