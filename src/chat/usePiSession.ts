import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiRpc, type RpcEvent } from "../rpc/RpcClient";
import { parseMessages, parseModels } from "./parse";
import { reduce } from "./reducer";
import { initialSessionState, type ImageAttachment, type ModelInfo, type SessionState } from "./types";

export interface SessionTarget {
	id: string;
	cwd: string;
	sessionFile?: string;
	elapsedMs?: number;
}

export interface PiSessionActions {
	prompt: (text: string, images?: ImageAttachment[]) => Promise<boolean>;
	abort: () => Promise<void>;
	setModel: (model: ModelInfo) => Promise<void>;
	setThinkingLevel: (level: string) => Promise<void>;
	clearError: () => void;
}

// Serialize teardown/start across fast navigation and React effect cleanup.
let previousTeardown: Promise<void> = Promise.resolve();

/** A real pi session per conversation; transcripts stay in pi's files. */
export function usePiSession(target?: SessionTarget) {
	const rpcRef = useRef<PiRpc | null>(null);
	const busyRef = useRef(false);
	const streamingRef = useRef(false);
	const [state, setState] = useState<SessionState>(initialSessionState);
	const [readyId, setReadyId] = useState<string>();
	const [loadedId, setLoadedId] = useState<string>();
	const [sessionFile, setSessionFile] = useState<string>();
	const [rawLines, setRawLines] = useState<string[]>([]);
	const [revision, setRevision] = useState(0);
	const [pending, setPending] = useState(false);
	const [elapsedMs, setElapsedMs] = useState(0);
	const [liveElapsedMs, setLiveElapsedMs] = useState(0);
	const runStarted = useRef<number>();
	const preferredModel = useRef<ModelInfo>();
	// Saving a newly assigned pi file must not restart the running session.
	const targetRef = useRef(target);
	targetRef.current = target;
	const connected = !!target && readyId === target.id;

	const fail = useCallback((error: unknown) => {
		setState((s) => ({ ...s, lastError: error instanceof Error ? error.message : String(error) }));
	}, []);

	useEffect(() => {
		const selected = targetRef.current;
		if (!selected) return;
		const rpc = new PiRpc(`chat_${crypto.randomUUID()}`);
		rpcRef.current = rpc;
		let cancelled = false;
		setReadyId(undefined);
		setLoadedId(undefined);
		setSessionFile(undefined);
		setState(initialSessionState);
		setRawLines([]);
		setPending(false);
		setElapsedMs(selected.elapsedMs ?? 0);
		runStarted.current = undefined;
		busyRef.current = false;
		streamingRef.current = false;
		const offEvent = rpc.onEvent((event: RpcEvent) => {
			if (cancelled) return;
			if (event.type === "agent_start" && runStarted.current === undefined) runStarted.current = Date.now();
			if (["agent_end", "agent_settled", "bridge_exit"].includes(String(event.type)) && runStarted.current !== undefined) {
				const duration = Date.now() - runStarted.current;
				setElapsedMs((ms) => ms + Math.max(0, duration));
				runStarted.current = undefined;
			}
			if (event.type === "bridge_exit") {
				setReadyId(undefined);
				setPending(false);
				streamingRef.current = false;
				setState((s) => ({ ...s, isStreaming: false, lastError: String(event.message) }));
				return;
			}
			if (event.type === "agent_start") streamingRef.current = true;
			if (event.type === "agent_end" || event.type === "agent_settled") streamingRef.current = false;
			setState((s) => reduce(s, event));
		});
		const offLine = rpc.onLine((line) => {
			if (!cancelled) setRawLines((prev) => [...prev.slice(-499), line]);
		});
		const preceding = previousTeardown;
		const starting = (async () => {
			try {
				await preceding;
				if (cancelled) return;
				await rpc.start({ cwd: selected.cwd });
				if (cancelled) return;
				if (selected.sessionFile) {
					const result = await rpc.request<{ cancelled?: boolean }>({ type: "switch_session", sessionPath: selected.sessionFile });
					if (result.cancelled) throw new Error("pi 扩展取消了聊天切换，未载入该聊天。");
				}
				if (preferredModel.current) {
					await rpc.request({ type: "set_model", provider: preferredModel.current.provider, modelId: preferredModel.current.id });
					preferredModel.current = undefined;
				}
				const [data, models, transcript, levels] = await Promise.all([
					rpc.request<Record<string, unknown>>({ type: "get_state" }),
					rpc.request<{ models?: unknown }>({ type: "get_available_models" }),
					rpc.request<{ messages?: unknown }>({ type: "get_messages" }),
					rpc.request<{ levels?: string[] }>({ type: "get_available_thinking_levels" }).catch(() => ({ levels: [] })),
				]);
				if (cancelled) return;
				setState({
					...initialSessionState, model: parseModels([data.model])[0],
					thinkingLevel: typeof data.thinkingLevel === "string" ? data.thinkingLevel : undefined,
					thinkingLevels: levels.levels ?? [],
					availableModels: parseModels(models.models), messages: parseMessages(transcript.messages),
					isStreaming: Boolean(data.isStreaming),
				});
				streamingRef.current = Boolean(data.isStreaming);
				setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
				setLoadedId(selected.id);
				setReadyId(selected.id);
			} catch (error) {
				if (!cancelled) fail(error);
			}
		})();
		return () => {
			cancelled = true;
			runStarted.current = undefined;
			offEvent();
			offLine();
			// A late spawn must not become an orphan after switching conversations.
			previousTeardown = starting.then(() => rpc.stop()).catch(() => {});
			if (rpcRef.current === rpc) rpcRef.current = null;
		};
	}, [target?.id, target?.cwd, revision, fail]);

	useEffect(() => {
		const update = () => setLiveElapsedMs(elapsedMs + (runStarted.current === undefined ? 0 : Math.max(0, Date.now() - runStarted.current)));
		update();
		if (!state.isStreaming) return;
		const timer = window.setInterval(update, 250);
		return () => window.clearInterval(timer);
	}, [elapsedMs, state.isStreaming]);

	const actions = useMemo<PiSessionActions>(() => ({
		prompt: async (text, images = []) => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || busyRef.current || streamingRef.current || (!text.trim() && !images.length)) return false;
			busyRef.current = true;
			setPending(true);
			try {
				await rpc.request({ type: "prompt", message: text.trim(), ...(images.length ? { images: images.map(({ data, mimeType }) => ({ type: "image", data, mimeType })) } : {}) });
				if (rpcRef.current !== rpc) return false;
				// pi may assign its file lazily on the first message.
				try {
					const data = await rpc.request<Record<string, unknown>>({ type: "get_state" });
					if (rpcRef.current === rpc) setSessionFile(typeof data.sessionFile === "string" ? data.sessionFile : undefined);
				} catch (error) { if (rpcRef.current === rpc) fail(error); }
				return true;
			} catch (error) {
				if (rpcRef.current === rpc) fail(error);
				return false;
			} finally {
				if (rpcRef.current === rpc) { setPending(false); busyRef.current = false; }
			}
		},
		abort: async () => {
			try { await rpcRef.current?.request({ type: "abort" }); } catch (error) { fail(error); }
		},
		setModel: async (model) => {
			const rpc = rpcRef.current;
			if (!connected || !rpc || busyRef.current || streamingRef.current) return;
			busyRef.current = true;
			setPending(true);
			try {
				const result = await rpc.request<ModelInfo>({ type: "set_model", provider: model.provider, modelId: model.id });
				if (rpcRef.current !== rpc) return;
				setState((s) => ({ ...s, model: parseModels([result])[0], thinkingLevels: [], thinkingLevel: undefined }));
				const [data, levels] = await Promise.all([rpc.request<Record<string, unknown>>({ type: "get_state" }), rpc.request<{ levels: string[] }>({ type: "get_available_thinking_levels" }).catch(() => ({ levels: [] }))]);
				if (rpcRef.current !== rpc) return;
				setState((s) => ({ ...s, thinkingLevel: String(data.thinkingLevel ?? "off"), thinkingLevels: levels.levels }));
			} catch (error) { if (rpcRef.current === rpc) fail(error); } finally { if (rpcRef.current === rpc) { setPending(false); busyRef.current = false; } }
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
		clearError: () => setState((s) => ({ ...s, lastError: undefined })),
	}), [connected, fail]);

	return { state, connected, rawLines, actions, sessionFile, loadedId, pending, elapsedMs, liveElapsedMs, reconnect: (model?: ModelInfo) => { preferredModel.current = model; setRevision((r) => r + 1); } };
}
