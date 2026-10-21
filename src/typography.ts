import { useSyncExternalStore } from "react";

export const FONT_FAMILIES = [
	{ value: "system", label: "系统默认" },
	{ value: "sans", label: "微软雅黑" },
	{ value: "serif", label: "宋体" },
	{ value: "mono", label: "等宽字体" },
] as const;
export type TypographyPreference = { size: number; family: typeof FONT_FAMILIES[number]["value"] };
export const DEFAULT_TYPOGRAPHY: TypographyPreference = { size: 15, family: "system" };
const storageKey = "skiff.typography.v1";
const fontSizes = ["xs", "sm", "base", "md", "chat", "lg", "xl", "2xl", "3xl", "gauge-min"].map((name) => `--font-size-${name}`);

export function normalizeTypography(value: unknown): TypographyPreference {
	const preference = value && typeof value === "object" ? value as Partial<TypographyPreference> : {};
	return {
		size: typeof preference.size === "number" && Number.isInteger(preference.size) && preference.size >= 12 && preference.size <= 20 ? preference.size : DEFAULT_TYPOGRAPHY.size,
		family: FONT_FAMILIES.some(({ value }) => value === preference.family) ? preference.family! : DEFAULT_TYPOGRAPHY.family,
	};
}

export function readTypographyPreference(storage?: Pick<Storage, "getItem">): TypographyPreference {
	try { return normalizeTypography(JSON.parse((storage ?? window.localStorage).getItem(storageKey) ?? "null")); }
	catch { return { ...DEFAULT_TYPOGRAPHY }; }
}

export function saveTypographyPreference(preference: TypographyPreference, storage?: Pick<Storage, "setItem">) {
	try { (storage ?? window.localStorage).setItem(storageKey, JSON.stringify(normalizeTypography(preference))); }
	catch { /* Font changes still work for this window when storage is unavailable. */ }
}

function applyTypography(preference: TypographyPreference) {
	const root = document.documentElement;
	// Read the canonical token sizes afresh, so repeated edits and HMR never compound scaling.
	for (const name of fontSizes) root.style.removeProperty(name);
	root.style.removeProperty("--font-family-base");
	if (preference.size !== DEFAULT_TYPOGRAPHY.size) {
		const style = getComputedStyle(root);
		const sizes = fontSizes.map((name) => [name, parseFloat(style.getPropertyValue(name))] as const);
		for (const [name, size] of sizes) if (Number.isFinite(size)) root.style.setProperty(name, `${Math.max(11, size * preference.size / DEFAULT_TYPOGRAPHY.size)}px`);
	}
	if (preference.family !== "system") root.style.setProperty("--font-family-base", `var(--font-family-${preference.family})`);
	root.dataset.typography = JSON.stringify(preference);
	window.dispatchEvent(new Event("skiff:typography-changed"));
}

export function setTypographyPreference(preference: TypographyPreference) {
	const value = normalizeTypography(preference);
	saveTypographyPreference(value);
	applyTypography(value);
}

export function initTypography() {
	applyTypography(readTypographyPreference());
	const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) applyTypography(readTypographyPreference()); };
	window.addEventListener("storage", onStorage);
	return () => window.removeEventListener("storage", onStorage);
}

const subscribe = (notify: () => void) => {
	window.addEventListener("skiff:typography-changed", notify);
	return () => window.removeEventListener("skiff:typography-changed", notify);
};
const snapshot = () => document.documentElement.dataset.typography ?? JSON.stringify(DEFAULT_TYPOGRAPHY);
export function useTypographyPreference(): TypographyPreference {
	return normalizeTypography(JSON.parse(useSyncExternalStore(subscribe, snapshot)));
}
