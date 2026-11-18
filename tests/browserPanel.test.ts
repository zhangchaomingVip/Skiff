import test from "node:test";
import assert from "node:assert/strict";
import { browserControlLabels, browserHost, browserTabLabel, canWatchBrowser, isBrowserStatus, mergeBrowserStatus, observeBrowser } from "../src/browser/model";
import { LatestBrowserFrames } from "../src/browser/frames";

const status = { chatId: "a", generation: "one", control: "ai" as const, controlVersion: 1, requiresSnapshot: false, url: "https://example.test", title: "示例页面", canGoBack: false, canGoForward: false, tabs: [{ id: "tab-a", title: "示例页面", url: "https://example.test", active: true }], activeTabId: "tab-a", error: null };
test("browser panel opens once per instance, preserves manual collapse and rejects stale control", () => {
	const first = observeBrowser({ expanded: false }, status);
	assert.equal(first.expanded, true);
	const collapsed = { ...first, expanded: false };
	assert.equal(observeBrowser(collapsed, { ...status, url: "https://example.test/next" }).expanded, false);
	assert.equal(observeBrowser(collapsed, { ...status, generation: "two" }).expanded, true);
	assert.equal(observeBrowser(collapsed, { ...status, generation: "closed", control: "closed" }).expanded, false);
	const human = { ...status, control: "human" as const, controlVersion: 4 };
	assert.equal(mergeBrowserStatus(human, status), human);
	assert.equal(isBrowserStatus({ ...status, control: "invalid" }), false);
	assert.equal(isBrowserStatus({ ...status, controlVersion: -1 }), false);
	assert.equal(isBrowserStatus({ ...status, tabs: [{ id: "tab-a", title: "缺少激活标记" }] }), false);
	assert.equal(isBrowserStatus({ ...status, canGoBack: undefined }), false);
	assert.equal(canWatchBrowser({ ...status, control: "disconnected" }), false);
	assert.equal(canWatchBrowser({ ...status, control: "stopped" }), true);
	// Navigation state can advance without a control change, so a same-version snapshot wins.
	const navigated = { ...status, url: "https://example.test/two", canGoBack: true, tabs: [{ ...status.tabs[0], url: "https://example.test/two", title: "第二页" }] };
	assert.deepEqual(mergeBrowserStatus(status, navigated).tabs, navigated.tabs);
	assert.equal(browserHost("https://gemini.google.com/app?x=1"), "gemini.google.com");
	assert.equal(browserHost("about:blank"), "");
	assert.equal(browserTabLabel({ title: "  ", url: "about:blank" }), "新标签页");
	assert.equal(browserTabLabel({ title: "", url: "https://example.test/deep" }), "example.test");
	assert.equal(browserControlLabels.human, "人工控制");
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
test("frame decoding paints the frame it decoded, then catches up with the newest one", async () => {
	const decodes: { data: string; resolve: (image: any) => void }[] = [];
	const drawn: number[] = [];
	const acks: number[] = [];
	const closed: number[] = [];
	const frames = new LatestBrowserFrames((data) => new Promise<any>((resolve) => { decodes.push({ data, resolve }); }), (_image, seq) => drawn.push(seq), (seq) => acks.push(seq), () => assert.fail("valid frame"));
	frames.push({ seq: 1, data: "one" }); await tick();
	frames.push({ seq: 2, data: "two" }); frames.push({ seq: 3, data: "three" });
	assert.deepEqual(acks, [2]);
	// Frames that keep landing while a decode is in flight must not leave the panel blank:
	// the decoded picture is painted, and the newest replacement follows on the next tick.
	decodes[0].resolve({ width: 10, height: 10, close: () => closed.push(1) }); await tick();
	assert.deepEqual(drawn, [1], "An in-flight decode still paints");
	// Painting resets a 30 fps gate, so the newest replacement lands a moment later.
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(decodes[1].data, "three");
	decodes[1].resolve({ width: 10, height: 10, close: () => closed.push(3) }); await tick();
	assert.deepEqual(drawn, [1, 3]); assert.deepEqual(closed, [1, 3]);
	frames.dispose();
	frames.push({ seq: 4, data: "four" }); await tick();
	assert.equal(decodes.length, 2);
	const disposed = new LatestBrowserFrames(() => new Promise<any>((resolve) => { decodes.push({ data: "late", resolve }); }), () => assert.fail("disposed"), () => assert.fail("no late ack"), () => assert.fail("disposed"));
	disposed.push({ seq: 5, data: "late" }); await tick(); disposed.dispose();
	decodes[2].resolve({ width: 10, height: 10, close: () => closed.push(5) }); await tick();
	assert.equal(closed.at(-1), 5);
});

test("a stream faster than decoding never starves the panel", async () => {
	const drawn: number[] = [];
	let inFlight: { resolve: (image: any) => void } | undefined;
	const frames = new LatestBrowserFrames(() => new Promise<any>((resolve) => { inFlight = { resolve }; }), (_image, seq) => drawn.push(seq), () => {}, () => assert.fail("valid frame"));
	let seq = 0;
	for (let round = 0; round < 12; round += 1) {
		frames.push({ seq: ++seq, data: String(seq) });
		frames.push({ seq: ++seq, data: String(seq) });
		await tick();
		inFlight?.resolve({ width: 10, height: 10, close: () => {} });
		await new Promise((resolve) => setTimeout(resolve, 35));
	}
	assert.ok(drawn.length >= 6, `Fast streams must keep painting, drew ${drawn.length}`);
	frames.dispose();
});
