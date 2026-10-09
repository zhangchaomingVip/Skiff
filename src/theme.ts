import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePreference = "system" | "light" | "dark";
const subscribe = (notify: () => void) => {
	window.addEventListener("skiff:theme-changed", notify);
	return () => window.removeEventListener("skiff:theme-changed", notify);
};
export const setThemePreference = (theme: ThemePreference) => window.dispatchEvent(new CustomEvent("skiff:theme-request", { detail: theme }));
export function useThemePreference() {
	return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.themePreference ?? "system") as ThemePreference);
}
export function syncNativeTheme() {
	const apply = () => {
		try { void getCurrentWindow().setTheme(document.documentElement.dataset.theme as "light" | "dark").catch(() => undefined); }
		catch { /* Browser preview has no native window. */ }
	};
	apply();
	window.addEventListener("skiff:theme-changed", apply);
	return () => window.removeEventListener("skiff:theme-changed", apply);
}
