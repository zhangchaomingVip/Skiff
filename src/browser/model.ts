import type { BrowserControl, BrowserStatus, BrowserTab, BrowserTarget } from "./native";

export const sameBrowser = (a: BrowserTarget | undefined | null, b: BrowserTarget | undefined | null) => !!a && !!b && a.chatId === b.chatId && a.generation === b.generation;
export const canWatchBrowser = (status?: BrowserStatus | null) => !!status && ["ai", "human", "takingOver", "returning", "stopping", "stopped"].includes(status.control);
export const browserControlLabels: Record<BrowserControl, string> = {
	starting: "正在启动", ai: "AI 控制", human: "人工控制", takingOver: "正在接管", returning: "正在交还", stopping: "正在停止", stopped: "已停止", closing: "正在关闭", closed: "已关闭", disconnected: "浏览器已断开", faulted: "浏览器故障",
};
/** A tab shows its page title, then the host, then a neutral new-tab label. */
export function browserHost(url?: string | null) {
	try {
		if (!url || url === "about:blank" || url === "chrome://newtab/") return "";
		return new URL(url).host;
	} catch { return ""; }
}
export function browserTabLabel(tab: Pick<BrowserTab, "title" | "url">) {
	return tab.title.trim() || browserHost(tab.url) || "新标签页";
}
const validTab = (tab: unknown): tab is BrowserTab => {
	if (!tab || typeof tab !== "object") return false;
	const value = tab as BrowserTab;
	return typeof value.id === "string" && typeof value.title === "string" && typeof value.url === "string" && typeof value.active === "boolean";
};
export function isBrowserStatus(value: unknown): value is BrowserStatus {
	if (!value || typeof value !== "object") return false;
	const status = value as BrowserStatus;
	return typeof status.chatId === "string" && typeof status.generation === "string" && Object.prototype.hasOwnProperty.call(browserControlLabels, status.control) && Number.isSafeInteger(status.controlVersion) && status.controlVersion >= 0 && (status.url === null || typeof status.url === "string") && (status.title === null || typeof status.title === "string") && typeof status.canGoBack === "boolean" && typeof status.canGoForward === "boolean" && (status.activeTabId === null || typeof status.activeTabId === "string") && Array.isArray(status.tabs) && status.tabs.every(validTab) && (status.error === null || typeof status.error === "string");
}
export function mergeBrowserStatus(current: BrowserStatus | undefined | null, next: BrowserStatus): BrowserStatus {
	if (!sameBrowser(current, next)) return next;
	if (current!.controlVersion > next.controlVersion || (next.control === "starting" && current!.control !== "starting")) return current!;
	return next;
}
export interface BrowserPanelRecord {
	expanded: boolean;
	status?: BrowserStatus | null;
	seenGeneration?: string;
	error?: string;
}
export function observeBrowser(record: BrowserPanelRecord, status: BrowserStatus | null): BrowserPanelRecord {
	const next = status ? mergeBrowserStatus(record.status, status) : null;
	const first = !!next && next.generation !== record.seenGeneration && !["closed", "closing"].includes(next.control);
	return { ...record, status: next, error: undefined, expanded: first || record.expanded, seenGeneration: next?.generation ?? record.seenGeneration };
}
