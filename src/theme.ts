import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePreference = "system" | "light" | "dark";
export const themeColors = [
	{ value: "purple", label: "薰衣草紫" },
	{ value: "yellow", label: "暖杏米" },
	{ value: "green", label: "鼠尾草绿" },
	{ value: "blue", label: "晴空蓝" },
] as const;
export type ThemeColor = (typeof themeColors)[number]["value"];
export const darkThemeColors = [
	{ value: "star-black", label: "星空黑" },
	{ value: "star-blue", label: "星空蓝" },
] as const;
export type DarkThemeColor = (typeof darkThemeColors)[number]["value"];
const subscribe = (notify: () => void) => {
	window.addEventListener("skiff:theme-changed", notify);
	return () => window.removeEventListener("skiff:theme-changed", notify);
};
export const setThemePreference = (theme: ThemePreference) => window.dispatchEvent(new CustomEvent("skiff:theme-request", { detail: theme }));
export const setThemeColor = (color: ThemeColor) => window.dispatchEvent(new CustomEvent("skiff:theme-color-request", { detail: color }));
export const setDarkThemeColor = (color: DarkThemeColor) => window.dispatchEvent(new CustomEvent("skiff:dark-theme-color-request", { detail: color }));
export const setThemeStars = (enabled: boolean) => window.dispatchEvent(new CustomEvent("skiff:theme-stars-request", { detail: enabled }));
export function useThemePreference() {
	return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.themePreference ?? "system") as ThemePreference);
}
export function useThemeColor() {
	return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.themeColor ?? "yellow") as ThemeColor);
}
export function useDarkThemeColor() {
	return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.darkThemeColor ?? "star-blue") as DarkThemeColor);
}
export function useThemeStars() {
	return useSyncExternalStore(subscribe, () => document.documentElement.dataset.themeStars !== "false");
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
