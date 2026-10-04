import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PiSessionActions } from "./usePiSession";

/** Secret never leaves Rust; only a trailing hint comes back. */
interface Status {
	agentDir?: string;
	configured: boolean;
	keyHint?: string;
	extensionInstalled: boolean;
	enabled: boolean;
}

export interface WebSearchControls {
	/** pi actually loaded the Skiff extension, so `/web` exists. */
	available: boolean;
	configured: boolean;
	keyHint?: string;
	extensionInstalled: boolean;
	enabled: boolean;
	busy: boolean;
	error?: string;
	toggle: (next: boolean) => Promise<void>;
	clearKey: () => Promise<void>;
	install: () => Promise<void>;
	refresh: () => void;
}

/**
 * Wires the composer's web-search pill to three places: pi's extension command
 * (`/web on|off`), the key stored beside pi's config, and the shipped extension
 * file itself.
 */
export function useWebSearch(actions: PiSessionActions, connected: boolean, reconnect: () => void): WebSearchControls {
	const [available, setAvailable] = useState(false);
	const [status, setStatus] = useState<Status>();
	const [enabled, setEnabled] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	const refresh = useCallback(() => {
		void invoke<Status>("get_web_search_status")
			.then((next) => {
				setStatus(next);
				setEnabled(next.enabled);
			})
			.catch((e) => setError(String(e)));
	}, []);

	useEffect(() => {
		if (!connected) {
			setAvailable(false);
			return;
		}
		let cancelled = false;
		// A pi session without the extension simply has no `web` command.
		void actions
			.getCommands()
			.then((commands) => {
				if (!cancelled) setAvailable(commands.some((command) => command.source === "extension" && command.name === "web"));
			})
			.catch(() => undefined);
		return () => { cancelled = true; };
	}, [actions, connected]);

	useEffect(() => { refresh(); }, [refresh, connected]);

	const toggle = useCallback(async (next: boolean) => {
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
	}, [actions]);

	const clearKey = useCallback(async () => {
		setBusy(true);
		setError(undefined);
		try {
			await invoke("clear_web_search_key");
			setEnabled(false);
			refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [refresh]);

	const install = useCallback(async () => {
		setBusy(true);
		setError(undefined);
		try {
			const changed = await invoke<boolean>("install_web_search_extension");
			if (changed) reconnect();
			refresh();
		} catch (e) {
			setError(String(e));
		} finally {
			setBusy(false);
		}
	}, [reconnect, refresh]);

	return {
		available,
		configured: status?.configured ?? false,
		keyHint: status?.keyHint,
		extensionInstalled: status?.extensionInstalled ?? false,
		enabled,
		busy,
		error,
		toggle,
		clearKey,
		install,
		refresh,
	};
}
