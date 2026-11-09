// Native browser contracts shared by capability settings and the live browser panel.
import { invoke } from "@tauri-apps/api/core";

export type BrowserControl = "starting" | "ai" | "takingOver" | "human" | "stopping" | "stopped" | "returning" | "closing" | "closed" | "disconnected" | "faulted";
export interface BrowserTarget { chatId: string; generation: string }
export interface BrowserStatus extends BrowserTarget {
	control: BrowserControl;
	controlVersion: number;
	requiresSnapshot?: boolean;
	url: string | null;
	error: string | null;
}
export interface BrowserDependencies {
	enabled: boolean;
	ready: boolean;
	supported: boolean;
	cliPath: string | null;
	configuredCliPath: string | null;
	version: string | null;
	browserInstalled: boolean;
	message: string;
	installCommands: string[];
}
export interface BrowserConnection {
	status: BrowserStatus;
	bridgeUrl: string;
	agentToken: string;
	streamUrl: string;
}
const targetRef = ({ chatId, generation }: BrowserTarget): BrowserTarget => ({ chatId, generation });
export const browserNative = {
	dependencies: () => invoke<BrowserDependencies>("browser_dependencies"),
	configure: (cliPath: string | null) => invoke<BrowserDependencies>("browser_configure", { settings: { cliPath } }),
	setEnabled: (enabled: boolean) => invoke<BrowserDependencies>("browser_set_enabled", { enabled }),
	start: (chatId: string) => invoke<BrowserStatus>("browser_start", { chatId }),
	status: (target: BrowserTarget) => invoke<BrowserStatus>("browser_status", { target: targetRef(target) }),
	find: (chatId: string) => invoke<BrowserStatus | null>("browser_find", { chatId }),
	connection: (target: BrowserTarget) => invoke<BrowserConnection>("browser_connection", { target: targetRef(target) }),
	control: (target: BrowserTarget, operation: "takeOver" | "return" | "stop") => invoke<BrowserStatus>("browser_control", { target: targetRef(target), operation }),
	beginControl: (target: BrowserTarget, operation: "takeOver" | "return" | "stop") => invoke<BrowserStatus>("browser_begin_control", { target: targetRef(target), operation }),
	completeControl: (target: BrowserTarget, operation: "takeOver" | "return" | "stop", controlVersion: number) => invoke<BrowserStatus>("browser_complete_control", { target: targetRef(target), operation, controlVersion }),
	close: (target: BrowserTarget) => invoke<BrowserStatus>("browser_close", { target: targetRef(target) }),
	retireChat: (chatId: string, deleteProfile = false) => invoke<void>("browser_retire_chat", { chatId, deleteProfile }),
	restoreChat: (chatId: string) => invoke<void>("browser_restore_chat", { chatId }),
};
