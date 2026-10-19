import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SettingsMetadata } from "./settingsManagement";

export const SETTINGS_METADATA_EVENT = "skiff-settings-metadata";
export function useSettingsMetadata(config: unknown) {
	const [metadata, setMetadata] = useState<SettingsMetadata>({ version: 1, tests: [], usage: [] });
	useEffect(() => {
		let disposed = false;
		let sequence = 0;
		const refresh = () => {
			if (disposed) return;
			const request = ++sequence;
			void invoke<SettingsMetadata>("list_settings_metadata").then((value) => { if (!disposed && request === sequence) setMetadata(value); }).catch(() => {});
		};
		const unlisten = listen("settings-metadata-changed", refresh).catch(() => () => {});
		refresh(); window.addEventListener(SETTINGS_METADATA_EVENT, refresh);
		return () => { disposed = true; void unlisten.then((stop) => stop()).catch(() => {}); window.removeEventListener(SETTINGS_METADATA_EVENT, refresh); };
	}, [config]);
	return metadata;
}
