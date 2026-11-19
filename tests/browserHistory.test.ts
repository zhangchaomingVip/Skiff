import test from "node:test";
import assert from "node:assert/strict";
import { browserDestination, browserHistoryKey, isNewTab, matchBrowserHistory, observeBrowserVisit, readBrowserHistory, removeBrowserVisit } from "../src/browser/history";
import type { BrowserStatus } from "../src/browser/native";

test("address input distinguishes web addresses, local services and Google queries", () => {
	assert.equal(browserDestination(" example.com/path "), "https://example.com/path");
	assert.equal(browserDestination("example.com:8080/path"), "https://example.com:8080/path");
	assert.equal(browserDestination("localhost:1421"), "http://localhost:1421/");
	assert.equal(browserDestination("127.0.0.1:8080"), "http://127.0.0.1:8080/");
	assert.equal(browserDestination("[::1]:8080"), "http://[::1]:8080/");
	assert.equal(browserDestination("https://example.com/a?q=1#x"), "https://example.com/a?q=1#x");
	assert.equal(browserDestination("gemini"), "https://www.google.com/search?q=gemini");
	assert.equal(browserDestination("中文 搜索"), `https://www.google.com/search?q=${encodeURIComponent("中文 搜索")}`);
	for (const value of ["", "javascript:alert(1)", "file:///tmp/a", "https://u:p@example.com", "https://"]) assert.throws(() => browserDestination(value));
	assert.equal(isNewTab("about:blank"), true);
	assert.equal(isNewTab("chrome://newtab/"), true);
});

test("history persists globally, caps visits and does not resurrect deleted entries on polling", () => {
	const data = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
	Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
	const status: BrowserStatus = { chatId: "history-test", generation: "one", activeTabId: "one", control: "human", controlVersion: 1, title: "Example", url: "https://example.com/", tabs: [], canGoBack: false, canGoForward: false, error: null };
	observeBrowserVisit(status);
	assert.equal(readBrowserHistory().length, 1);
	observeBrowserVisit({ ...status, chatId: "other" });
	assert.equal(readBrowserHistory().length, 1);
	removeBrowserVisit(status.url!);
	observeBrowserVisit(status);
	observeBrowserVisit({ ...status, title: "Late title" });
	assert.deepEqual(readBrowserHistory(), []);
	observeBrowserVisit({ ...status, url: "https://example.com/next" });
	observeBrowserVisit(status);
	assert.equal(readBrowserHistory()[0].url, status.url);
	assert.equal(matchBrowserHistory(readBrowserHistory(), "EXAMPLE").length, 2);
	for (let index = 0; index < 105; index++) observeBrowserVisit({ ...status, url: `https://example.com/${index}` });
	assert.equal(readBrowserHistory().length, 100);
	assert.equal(matchBrowserHistory(readBrowserHistory(), "").length, 8);
	data.set(browserHistoryKey, "broken");
	assert.deepEqual(readBrowserHistory(), []);
	delete (globalThis as any).window;
	delete (globalThis as any).localStorage;
});
