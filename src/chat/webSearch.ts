import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PiSessionActions, SessionOwner } from "./usePiSession";
import { useSessionValue } from "./useSessionValue";

export type WebSearchProvider = "tavily" | "exa";

/** Secret never leaves Rust; only a trailing hint comes back. */
interface Status {
	agentDir?: string;
	provider?: WebSearchProvider;
	configured: boolean;
	keyHint?: string;
	extensionInstalled: boolean;
	enabled: boolean;
	readUrlEnabled?: boolean;
	validated: boolean | null;
	validationMessage?: string;
}

export interface WebSearchControls {
	/** pi actually loaded the Skiff extension, so `/web` exists. */
	available: boolean;
	/** Search engine in use; keys are stored per engine in Rust. */
	provider: WebSearchProvider;
	configured: boolean;
	keyHint?: string;
	agentDir?: string;
	extensionInstalled: boolean;
	enabled: boolean;
	/** Exa-only `read_url` tool switch; ignored while another engine is active. */
	readUrlEnabled: boolean;
	validated?: boolean;
	validationMessage?: string;
	statusLoaded: boolean;
	validating: boolean;
	busy: boolean;
	error?: string;
	toggle: (next: boolean) => Promise<void>;
	setProvider: (provider: WebSearchProvider) => Promise<void>;
	setReadUrl: (next: boolean) => Promise<void>;
	clearKey: () => Promise<void>;
	install: () => Promise<void>;
	refresh: () => Promise<void>;
	/** Live key check; costs engine credits, so call it only after a save or by request. */
	verify: () => Promise<void>;
}

/**
 * Keeps local configuration, Tavily health, and the live pi command list in
 * one place so the composer and settings dialog always show the same state.
 */
export function useWebSearch(actions: PiSessionActions, connected: boolean, reconnect: () => void, owner: SessionOwner, isCurrent: () => boolean): WebSearchControls {
	const [available, setAvailable] = useSessionValue(owner, isCurrent, () => false);
	const [status, setStatus] = useState<Status>();
	const [provider, setProviderState] = useState<WebSearchProvider>("tavily");
	const [enabled, setEnabled] = useState(false);
	const [readUrlEnabled, setReadUrlState] = useState(false);
	const [validating, setValidating] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const statusRequest = useRef(0);

	/**
	 * Reads the stored configuration only. Never calls the search engine: a live
	 * key check costs real credits on Exa, so it is reserved for saving or
	 * explicitly re-running validation.
	 */
	const refresh = useCallback(async () => {
		const requestId = ++statusRequest.current;
		setError(undefined);
		try {
			const next = await invoke<Status>("get_web_search_status");
			if (requestId !== statusRequest.current) return;
			setStatus(next);
			setProviderState(next.provider ?? "tavily");
			setEnabled(next.enabled);
			setReadUrlState(next.readUrlEnabled ?? false);
		} catch (e) {
			if (requestId === statusRequest.current) setError(String(e));
		}
	}, []);

	/** Live key check; costs credits, so only called after a save or on demand. */
	const verify = useCallback(async () => {
		const requestId = ++statusRequest.current;
		setValidating(true);
		setError(undefined);
		try {
			const next = await invoke<Status>("validate_web_search");
			if (requestId !== statusRequest.current) return;
			setStatus(next);
			setProviderState(next.provider ?? "tavily");
			setEnabled(next.enabled);
			setReadUrlState(next.readUrlEnabled ?? false);
		} catch (e) {
			if (requestId === statusRequest.current) setStatus((current) => (current ? { ...current, validated: false, validationMessage: String(e) } : current));
		} finally {
			if (requestId === statusRequest.current) setValidating(false);
		}
	}, []);

	useEffect(() => {
		if (!connected) {
			setAvailable(false);
			return;
		}
		let cancelled = false;
		void actions
			.getCommands()
			.then((commands) => {
				if (!cancelled) setAvailable(commands.some((command) => command.source === "extension" && command.name === "web"));
			})
			.catch(() => { if (!cancelled) setAvailable(false); });
		return () => { cancelled = true; };
	}, [actions, connected, setAvailable]);

	useEffect(() => { void refresh(); }, [refresh]);

	const toggle = useCallback(async (next: boolean) => {
		if (!isCurrent() || !connected) return;
		if (!available) {
			setError("当前 pi 会话尚未加载联网搜索扩展，请在设置中安装或重新加载。");
			return;
		}
		if (next && status?.validated === false) {
			setError(status.validationMessage ?? "搜索引擎 API Key 验证失败，请检查设置。");
			return;
		}
		setBusy(true);
		setError(undefined);
		try {
			await actions.setWebSearch(next);
			setEnabled(next);
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [actions, available, connected, isCurrent, status, setBusy, setError]);

	const setProvider = useCallback(async (next: WebSearchProvider) => {
		if (!isCurrent() || next === provider) return;
		setBusy(true);
		setError(undefined);
		try {
			await invoke("set_web_search_provider", { provider: next });
			setProviderState(next);
			await refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [provider, refresh, isCurrent, setBusy, setError]);

	const setReadUrl = useCallback(async (next: boolean) => {
		if (!isCurrent()) return;
		setBusy(true);
		setError(undefined);
		try {
			await invoke("set_web_search_read_url", { enabled: next });
			setReadUrlState(next);
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [isCurrent, setBusy, setError]);

	const clearKey = useCallback(async () => {
		if (!isCurrent()) return;
		setBusy(true);
		setError(undefined);
		try {
			await invoke("clear_web_search_key");
			setEnabled(false);
			await refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [refresh, isCurrent, setBusy, setError]);

	const install = useCallback(async () => {
		if (!isCurrent()) return;
		setBusy(true);
		setError(undefined);
		try {
			const changed = await invoke<boolean>("install_web_search_extension");
			if (!isCurrent()) return;
			if (changed || !available) reconnect();
			await refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [available, reconnect, refresh, isCurrent, setBusy, setError]);

	return {
		available,
		provider,
		configured: status?.configured ?? false,
		keyHint: status?.keyHint,
		agentDir: status?.agentDir,
		extensionInstalled: status?.extensionInstalled ?? false,
		enabled,
		readUrlEnabled,
		validated: status?.validated ?? undefined,
		validationMessage: status?.validationMessage,
		statusLoaded: status !== undefined,
		validating,
		busy,
		error,
		toggle,
		setProvider,
		setReadUrl,
		clearKey,
		install,
		refresh,
		verify,
	};
}
