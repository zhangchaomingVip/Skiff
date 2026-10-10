import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { PiRpc, type RpcEvent } from "../rpc/RpcClient";
import { parseMessages, parseModels } from "./parse";
import { reduce } from "./reducer";
import { forkTurn } from "./turns";
import { loadAppendPrompt } from "./prompt";
import { initialSessionState, type ImageAttachment, type ModelInfo, type SessionState } from "./types";
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
	rewind: (id: string) => Promise<boolean>;
	getCommands: () => Promise<PiCommand[]>;
	prompt: (text: string, images?: ImageAttachment[]) => Promise<boolean>;
	abort: () => Promise<void>;
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

// Serialize teardown/start across fast navigation and React effect cleanup.
let previousTeardown: Promise<void> = Promise.resolve();

/** A real pi session per conversation; transcripts stay in pi's files. */
export function usePiSession(target?: SessionTarget, runtimeOffers: readonly RuntimeOffer[] = [], configuration?: { config?: FamiliesConfig; ready: boolean }) {
	const rpcRef = useRef<PiRpc | null>(null);
	const busyRef = useRef(false);
	const streamingRef = useRef(false);
	const [state, setState] = useState<SessionState>(initialSessionState);
	const stateRef = useRef(state);
	stateRef.current = state;
	const [readyId, setReadyId] = useState<string>();
	const [loadedId, setLoadedId] = useState<string>();
	const [loadedConfig, setLoadedConfig] = useState<FamiliesConfig>();
	const [sessionFile, setSessionFile] = useState<string>();
	const [rawLines, setRawLines] = useState<string[]>([]);
	const [revision, setRevision] = useState(0);
	const [pending, setPending] = useState(false);
	const [elapsedMs, setElapsedMs] = useState(0);
	const runStarted = useRef<number>();
	const promptRef = useRef<{ id: string; cancelled: boolean }>();
	const preferredModel = useRef<{ chatId?: string; model?: ModelInfo }>();
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
	const connected = !!target && readyId === target.id;

	const fail = useCallback((error: unknown) => {
		setState((s) => ({ ...s, lastError: error instanceof Error ? error.message : String(error) }));
	}, []);

	useEffect(() => {
		const selected = targetRef.current;
		if (!selected || !configurationReady) return;
		const rpc = new PiRpc(`chat_${crypto.randomUUID()}`);
		rpcRef.current = rpc;
		let cancelled = false;
		// pi's provider errors go to stderr; without this they are silently dropped.
		const offStderr = listen<string>(`rpc-stderr://${rpc.instanceId}`, (e) => {
			if (!cancelled && e.payload) setRawLines((prev) => [...prev.slice(-499), `[stderr] ${e.payload}`]);
		});
		setReadyId(undefined);
		setLoadedId(undefined);
		setLoadedConfig(undefined);
		setSessionFile(undefined);
		setState(initialSessionState);
		setRawLines([]);
		setPending(false);
		setElapsedMs(selected.elapsedMs ?? 0);
		runStarted.current = undefined;
		promptRef.current = undefined;
		busyRef.current = false;
		streamingRef.current = false;
		const offEvent = rpc.onEvent((event: RpcEvent) => {
			if (cancelled) return;
			const now = Date.now();
			if (event.type === "agent_start" && runStarted.current === undefined) runStarted.current = now;
			let duration: number | undefined;
			if (["agent_end", "agent_settled", "bridge_exit"].includes(String(event.type)) && runStarted.current !== undefined) {
				duration = Math.max(0, now - runStarted.current);
				setElapsedMs((ms) => ms + (duration ?? 0));
				runStarted.current = undefined;
			}
			if (event.type === "bridge_exit") {
				setReadyId(undefined);
				setPending(false);
				streamingRef.current = false;
			}
			if (event.type === "agent_start") streamingRef.current = true;
			if (event.type === "agent_end" || event.type === "agent_settled") streamingRef.current = false;
			const timedEvent = { ...event, ...(event.type === "agent_start" ? { startedAt: runStarted.current } : {}), ...(duration === undefined ? {} : { durationMs: duration, completedAt: now }) };
			setState((s) => {
				const options = { offers: runtimeOffersRef.current };
				return reduce(s, timedEvent, options);
			});
		});
		const offLine = rpc.onLine((line) => {
			if (!cancelled) setRawLines((prev) => [...prev.slice(-499), line]);
		});
		const preceding = previousTeardown;
		let startupConfig: FamiliesConfig | undefined;
		const spawned = preceding.then(async () => {
			if (cancelled) return;
			startupConfig = configurationRef.current?.config;
			await rpc.start({ cwd: selected.cwd, appendSystemPrompt: loadAppendPrompt() });
		});
		void (async () => {
			try {
				await spawned;
				if (cancelled) return;
				if (selected.sessionFile) {
					const result = await rpc.request<{ cancelled?: boolean }>({ type: "switch_session", sessionPath: selected.sessionFile });
					if (result.cancelled) throw new Error("pi 扩展取消了聊天切换，未载入该聊天。");
				}
				if (cancelled) return;
				const preferred = preferredModel.current?.chatId === selected.id ? preferredModel.current.model ?? selected.model : selected.model;
				preferredModel.current = undefined;
				let unavailableModel: ModelInfo | undefined;
				let selectionError: unknown;
				if (preferred) {
					try { await rpc.request({ type: "set_model", provider: preferred.provider, modelId: preferred.id }); }
					catch (error) { unavailableModel = preferred; selectionError = error; } // The app resolves removed/disabled models after loading configuration.
				}
				if (cancelled) return;
				const [data, models, transcript, levels] = await Promise.all([
					rpc.request<Record<string, unknown>>({ type: "get_state" }),
					rpc.request<{ models?: unknown }>({ type: "get_available_models" }),
					rpc.request<{ messages?: unknown }>({ type: "get_messages" }),
					rpc.request<{ levels?: string[] }>({ type: "get_available_thinking_levels" }).catch(() => ({ levels: [] })),
				]);
				if (cancelled) return;
				const availableModels = parseModels(models.models);
				if (unavailableModel && availableModels.some((model) => model.provider === unavailableModel.provider && model.id === unavailableModel.id)) throw selectionError;
				const parsedModel = parseModels([data.model])[0];
				const restoredModel = unavailableModel ?? (parsedModel && preferred ? { ...parsedModel, offerId: preferred.offerId, routeId: preferred.routeId, modelId: preferred.modelId, familyId: preferred.familyId, familyName: preferred.familyName, relayId: preferred.relayId } : parsedModel);
				const messages = attachHistoricalSnapshots(parseMessages(transcript.messages), selected.routeSnapshots);
				const user = [...messages].reverse().find((message) => message.role === "user");
				const startedAt = Boolean(data.isStreaming) ? runStarted.current ?? user?.timestamp ?? Date.now() : undefined;
				runStarted.current = startedAt;
				setState({
					...initialSessionState, model: restoredModel,
					thinkingLevel: typeof data.thinkingLevel === "string" ? data.thinkingLevel : undefined,
					thinkingLevels: levels.levels ?? [],
						availableModels, messages,
					isStreaming: Boolean(data.isStreaming),
					activeRun: startedAt === undefined ? undefined : { startedAt, turnId: user ? `turn:${user.id}` : undefined },
				});
				streamingRef.current = Boolean(data.isStreaming);
				setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
				setLoadedId(selected.id);
				setLoadedConfig(startupConfig);
				setReadyId(selected.id);
			} catch (error) {
				if (!cancelled) fail(error);
			}
		})();
		return () => {
			cancelled = true;
			runStarted.current = undefined;
			promptRef.current = undefined;
			void offStderr.then((off) => off());
			offEvent();
			offLine();
			// A late spawn must not become an orphan after switching conversations.
			// Wait only for the spawn, then stop immediately to reject outstanding
			// initialization requests instead of waiting for their RPC timeout.
			previousTeardown = spawned.catch(() => {}).then(() => rpc.stop()).catch(() => {});
			if (rpcRef.current === rpc) rpcRef.current = null;
		};
	}, [target?.id, target?.cwd, revision, configurationReady, fail]);

	const actions = useMemo<PiSessionActions>(() => ({
		getCommands: async () => {
			const result = await rpcRef.current?.request<{ commands?: unknown }>({ type: "get_commands" });
			return parseCommands(result?.commands);
		},
		rewind: async (id) => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || busyRef.current || streamingRef.current) return false;
			busyRef.current = true; setPending(true);
			let forked = false;
			try {
				if (!await forkTurn(rpc, stateRef.current.messages, id)) { fail("pi 扩展取消了消息操作。"); return false; }
				forked = true;
				const [transcript, data] = await Promise.all([rpc.request<{ messages: unknown }>({ type: "get_messages" }), rpc.request<Record<string, unknown>>({ type: "get_state" })]);
				if (rpcRef.current !== rpc) return false;
				setState((s) => ({ ...s, messages: parseMessages(transcript.messages), lastError: undefined }));
				setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
				return true;
			} catch (error) {
				if (rpcRef.current === rpc) {
					fail(error);
					// If refresh failed after forking, reload the indexed original session.
					if (forked) { setReadyId(undefined); setRevision((value) => value + 1); }
				}
				return false;
			}
			finally { if (rpcRef.current === rpc) { busyRef.current = false; setPending(false); } }
		},
		prompt: async (text, images = []) => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || busyRef.current || streamingRef.current || runStarted.current !== undefined || (!text.trim() && !images.length)) return false;
			busyRef.current = true;
			setPending(true);
			const prompt = { id: crypto.randomUUID(), cancelled: false };
			promptRef.current = prompt;
			const startedAt = Date.now();
			runStarted.current = startedAt;
			setState((s) => reduce(s, {
				type: "prompt_start", promptId: prompt.id, startedAt,
				message: { id: `pending_${prompt.id}`, role: "user", timestamp: startedAt, blocks: [...(text.trim() ? [{ kind: "text", text: text.trim() }] : []), ...images.map(({ data, mimeType }) => ({ kind: "image", data, mimeType }))] },
			}));
			try {
				await rpc.request({ type: "prompt", message: text.trim(), ...(images.length ? { images: images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })) } : {}) });
				if (rpcRef.current !== rpc || promptRef.current !== prompt || prompt.cancelled) return false;
				// pi may assign its file lazily on the first message.
				try {
					const data = await rpc.request<Record<string, unknown>>({ type: "get_state" });
					if (rpcRef.current === rpc && promptRef.current === prompt && !prompt.cancelled) {
						setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
						// Extension commands may complete without starting an agent run.
						if (text.trim().startsWith("/") && !data.isStreaming && !streamingRef.current) {
							runStarted.current = undefined;
							setState((s) => reduce(s, { type: "prompt_cancel", promptId: prompt.id }));
						}
					}
				} catch (error) { if (rpcRef.current === rpc && promptRef.current === prompt && !prompt.cancelled) fail(error); }
				return rpcRef.current === rpc && promptRef.current === prompt && !prompt.cancelled;
			} catch (error) {
				if (rpcRef.current === rpc && promptRef.current === prompt && !prompt.cancelled) {
					if (!streamingRef.current) {
						runStarted.current = undefined;
						setState((s) => reduce(s, { type: "prompt_cancel", promptId: prompt.id }));
					}
					fail(error);
				}
				return false;
			} finally {
				if (rpcRef.current === rpc && promptRef.current === prompt) { setPending(false); busyRef.current = false; }
			}
		},
		abort: async () => {
			const rpc = rpcRef.current;
			const prompt = promptRef.current;
			try {
				await rpc?.request({ type: "abort" });
				if (rpcRef.current === rpc && promptRef.current === prompt && prompt && !streamingRef.current) {
					prompt.cancelled = true;
					runStarted.current = undefined;
					busyRef.current = false;
					setPending(false);
					setState((s) => reduce(s, { type: "prompt_cancel", promptId: prompt.id }));
				}
			} catch (error) { if (rpcRef.current === rpc) fail(error); }
		},
		setModel: async (model) => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || busyRef.current || streamingRef.current) return false;
			busyRef.current = true;
			setPending(true);
			try {
				const result = await rpc.request<ModelInfo>({ type: "set_model", provider: model.provider, modelId: model.id });
				if (rpcRef.current !== rpc) return false;
				const parsed = parseModels([result])[0];
				setState((s) => ({ ...s, model: parsed ? { ...parsed, offerId: model.offerId, routeId: model.routeId, modelId: model.modelId ?? model.id, familyId: model.familyId, familyName: model.familyName, relayId: model.relayId } : parsed, thinkingLevels: [], thinkingLevel: undefined, lastError: undefined }));
				const [data, levels] = await Promise.all([rpc.request<Record<string, unknown>>({ type: "get_state" }), rpc.request<{ levels: string[] }>({ type: "get_available_thinking_levels" }).catch(() => ({ levels: [] }))]);
				if (rpcRef.current !== rpc) return false;
				setState((s) => ({ ...s, thinkingLevel: String(data.thinkingLevel ?? "off"), thinkingLevels: levels.levels }));
				return true;
			} catch (error) { if (rpcRef.current === rpc) fail(error); return false; } finally { if (rpcRef.current === rpc) { setPending(false); busyRef.current = false; } }
		},
		setThinkingLevel: async (level) => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || busyRef.current || streamingRef.current) return;
			busyRef.current = true; setPending(true);
			try {
				await rpc.request({ type: "set_thinking_level", level });
				const data = await rpc.request<Record<string, unknown>>({ type: "get_state" });
				if (rpcRef.current !== rpc) return;
				setState((s) => ({ ...s, thinkingLevel: String(data.thinkingLevel ?? "off") }));
			} catch (error) { if (rpcRef.current === rpc) fail(error); } finally { if (rpcRef.current === rpc) { busyRef.current = false; setPending(false); } }
		},
		setWebSearch: async (enabled) => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || busyRef.current || streamingRef.current) return;
			busyRef.current = true;
			setPending(true);
			try {
				// pi expands leading slashes into extension commands, so this never
				// reaches the model as a chat message.
				await rpc.request({ type: "prompt", message: `/web ${enabled ? "on" : "off"}` });
			} catch (error) { if (rpcRef.current === rpc) fail(error); } finally { if (rpcRef.current === rpc) { busyRef.current = false; setPending(false); } }
		},
		clearError: () => setState((s) => ({ ...s, lastError: undefined })),
	}), [connected, fail]);

	// Stable identity: callers restart the session from effects and must not
	// re-trigger on every render.
	const reconnect = useCallback((model?: ModelInfo) => {
		preferredModel.current = { chatId: targetRef.current?.id, model };
		setReadyId(undefined);
		setRevision((revision) => revision + 1);
	}, []);

	return { state, connected, rawLines, actions, sessionFile, loadedId, loadedConfig, pending, elapsedMs, reconnect };
}
