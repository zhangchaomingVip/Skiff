import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModelInfo } from "../chat/types";
import { ModelPicker } from "./ModelPicker";

interface Provider {
	provider: string;
	source: string;
	kind: string;
}

interface AuthStatus {
	agent_dir: string | null;
	auth_file: string | null;
	auth_file_exists: boolean;
	configured_providers: Provider[];
}

/**
 * Reads `~/.pi/agent/auth.json` directly via the Rust command (same as
 * pi-desktop) and shows the configured providers plus the active model.
 */
export function StatusBar({
	connected,
	streaming,
	model,
	models,
	onSelectModel,
	onNewSession,
	rawOpen,
	onToggleRaw,
}: {
	connected: boolean;
	streaming: boolean;
	model?: ModelInfo;
	models: ModelInfo[];
	onSelectModel: (model: ModelInfo) => void;
	onNewSession: () => void;
	rawOpen: boolean;
	onToggleRaw: () => void;
}) {
	const [providers, setProviders] = useState<Provider[]>([]);

	useEffect(() => {
		invoke<AuthStatus>("get_pi_auth_status")
			.then((status) => setProviders(status.configured_providers))
			.catch(() => {});
	}, []);

	const dotClass = !connected ? "off" : streaming ? "busy" : "on";
	const dotTitle = !connected ? "connecting" : streaming ? "streaming" : "idle";

	return (
		<header className="statusbar">
			<span className="brand">Skiff</span>
			<span className={`dot ${dotClass}`} title={dotTitle} />
			<span className="providers">
				{providers.map((provider) => (
					<span key={provider.provider} className="chip">
						{provider.provider}
					</span>
				))}
			</span>
			<div className="spacer" />
			<ModelPicker models={models} current={model} onSelect={onSelectModel} />
			<button className="btn ghost" onClick={onNewSession}>
				New session
			</button>
			<button className={`btn ghost ${rawOpen ? "active" : ""}`} onClick={onToggleRaw}>
				Raw
			</button>
		</header>
	);
}
