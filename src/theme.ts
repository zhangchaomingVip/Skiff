import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePreference = "system" | "light" | "dark";
export const themeColors = [
	{ value: "default", label: "默认" },
	{ value: "purple", label: "紫色" },
	{ value: "yellow", label: "黄色" },
	{ value: "green", label: "绿色" },
	{ value: "blue", label: "蓝色" },
] as const;
export type ThemeColor = (typeof themeColors)[number]["value"];
const subscribe = (notify: () => void) => {
	window.addEventListener("skiff:theme-changed", notify);
	return () => window.removeEventListener("skiff:theme-changed", notify);
};
export const setThemePreference = (theme: ThemePreference) => window.dispatchEvent(new CustomEvent("skiff:theme-request", { detail: theme }));
export const setThemeColor = (color: ThemeColor) => window.dispatchEvent(new CustomEvent("skiff:theme-color-request", { detail: color }));
export function useThemePreference() {
	return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.themePreference ?? "system") as ThemePreference);
}
export function useThemeColor() {
	return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.themeColor ?? "default") as ThemeColor);
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
