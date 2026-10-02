import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiRpc, type RpcEvent } from "../rpc/RpcClient";
import { parseModels } from "./parse";
import { reduce } from "./reducer";
import { initialSessionState, type ModelInfo, type SessionState } from "./types";

const RAW_LINE_LIMIT = 500;

export interface PiSessionActions {
	prompt: (text: string) => Promise<void>;
	abort: () => Promise<void>;
	newSession: () => Promise<void>;
	setModel: (model: ModelInfo) => Promise<void>;
	clearError: () => void;
}

/**
 * Owns the single `pi --mode rpc` session: starts the bridge, folds events
 * through the reducer, and exposes the commands the UI needs. Keep this hook
 * free of rendering concerns so it survives the GPUI port.
 */
export function usePiSession() {
	const rpcRef = useRef<PiRpc | null>(null);
	const [state, setState] = useState<SessionState>(initialSessionState);
	const [connected, setConnected] = useState(false);
	const [rawLines, setRawLines] = useState<string[]>([]);

	const fail = useCallback((error: unknown) => {
		setState((s) => ({ ...s, lastError: error instanceof Error ? error.message : String(error) }));
	}, []);

	useEffect(() => {
		const rpc = new PiRpc("main");
		rpcRef.current = rpc;
		const offEvent = rpc.onEvent((event: RpcEvent) => setState((s) => reduce(s, event)));
		const offLine = rpc.onLine((line) =>
			setRawLines((prev) => [...prev.slice(-(RAW_LINE_LIMIT - 1)), line]),
		);

		let cancelled = false;
		void (async () => {
			try {
				await rpc.start({ piPath: "pi" });
				if (cancelled) return;
				setConnected(true);
				const [stateResult, modelsResult] = await Promise.allSettled([
					rpc.request<Record<string, unknown>>({ type: "get_state" }),
					rpc.request<{ models?: unknown }>({ type: "get_available_models" }),
				]);
				if (cancelled) return;
				setState((s) => {
					let next = s;
					if (stateResult.status === "fulfilled") {
						const data = stateResult.value;
						next = {
							...next,
							model: (data.model as ModelInfo | undefined) ?? next.model,
							thinkingLevel:
								typeof data.thinkingLevel === "string" ? data.thinkingLevel : next.thinkingLevel,
						};
					}
					if (modelsResult.status === "fulfilled") {
						next = { ...next, availableModels: parseModels(modelsResult.value.models) };
					}
					return next;
				});
			} catch (error) {
				if (!cancelled) fail(error);
			}
		})();

		return () => {
			cancelled = true;
			offEvent();
			offLine();
			void rpc.stop().catch(() => {});
			rpcRef.current = null;
		};
	}, [fail]);

	const actions = useMemo<PiSessionActions>(
		() => ({
			prompt: async (text: string) => {
				const trimmed = text.trim();
				if (!trimmed) return;
				try {
					await rpcRef.current?.request({ type: "prompt", message: trimmed });
				} catch (error) {
					fail(error);
				}
			},
			abort: async () => {
				try {
					await rpcRef.current?.request({ type: "abort" });
				} catch (error) {
					fail(error);
				}
			},
			newSession: async () => {
				try {
					await rpcRef.current?.request({ type: "new_session" });
					setState((s) => ({ ...s, messages: [], notices: [], lastError: undefined }));
				} catch (error) {
					fail(error);
				}
			},
			setModel: async (model: ModelInfo) => {
				try {
					const result = await rpcRef.current?.request<ModelInfo>({
						type: "set_model",
						provider: model.provider,
						modelId: model.id,
					});
					setState((s) => ({ ...s, model: result ?? model }));
				} catch (error) {
					fail(error);
				}
			},
			clearError: () => setState((s) => ({ ...s, lastError: undefined })),
		}),
		[fail],
	);

	return { state, connected, rawLines, actions };
}
