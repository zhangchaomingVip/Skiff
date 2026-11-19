import type { BrowserStatus } from "./native";

export const browserHistoryKey = "skiff.browser.history.v1";
export const browserHistoryEvent = "skiff-browser-history";
export interface BrowserVisit { url: string; title: string; visitedAt: number }

export function isNewTab(url?: string | null) {
	return !url || ["about:blank", "chrome://newtab", "chrome://newtab/", "chrome://new-tab-page/"].includes(url);
}

export function browserDestination(input: string): string {
	const text = input.trim();
	if (!text) throw new Error("请输入网址或搜索词");
	const local = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?=[:/]|$)/i.test(text);
	const address = local || /^(\[[\da-f:]+\]|[^\s/:]+\.[^\s/:]+)(?=[:/]|$)/i.test(text);
	const explicit = /^[a-z][a-z\d+.-]*:/i.test(text) && !local && !/^[^\s/:]+\.([^\s/:]+):\d+(?:\/|$)/.test(text);
	if (!explicit && !address) return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
	let url: URL;
	try { url = new URL(explicit ? text : `${local ? "http" : "https"}://${text}`); }
	catch { throw new Error("请输入有效的网址"); }
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("只支持不含凭据的 http/https 网址");
	if (url.href.length > 8192) throw new Error("网址过长");
	return url.href;
}

export function readBrowserHistory(): BrowserVisit[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(browserHistoryKey) ?? "[]");
		if (!Array.isArray(value)) return [];
		return value.filter((item): item is BrowserVisit => typeof item?.url === "string" && /^https?:\/\//.test(item.url) && typeof item.title === "string" && Number.isFinite(item.visitedAt)).slice(0, 100);
	} catch { return []; }
}

function writeHistory(items: BrowserVisit[]) {
	try { localStorage.setItem(browserHistoryKey, JSON.stringify(items)); } catch { /* Browsing remains available without storage. */ }
	window.dispatchEvent(new Event(browserHistoryEvent));
}

export function removeBrowserVisit(url: string) {
	writeHistory(readBrowserHistory().filter((item) => item.url !== url));
}

export function matchBrowserHistory(items: BrowserVisit[], query: string) {
	const search = query.trim().toLocaleLowerCase();
	return items.filter((item) => `${item.title} ${item.url}`.toLocaleLowerCase().includes(search)).slice(0, 8);
}

// A repeated poll or late title update must not resurrect a deleted visit.
const observed = new Map<string, { url: string; title: string }>();
export function observeBrowserVisit(status: BrowserStatus) {
	if (!["ai", "human", "stopped"].includes(status.control) || !status.activeTabId || !status.url || !/^https?:\/\//.test(status.url)) return;
	const key = `${status.chatId}:${status.generation}:${status.activeTabId}`;
	const url = status.url;
	let host: string;
	try { host = new URL(url).host; } catch { return; }
	const title = status.title?.trim() || host;
	const previous = observed.get(key);
	if (previous?.url === url && previous.title === title) return;
	observed.set(key, { url, title });
	if (observed.size > 1000) observed.delete(observed.keys().next().value!);
	const items = readBrowserHistory();
	if (previous?.url === url) {
		if (items.some((item) => item.url === url)) writeHistory(items.map((item) => item.url === url ? { ...item, title } : item));
		return;
	}
	writeHistory([{ url, title, visitedAt: Date.now() }, ...items.filter((item) => item.url !== url)].slice(0, 100));
}
