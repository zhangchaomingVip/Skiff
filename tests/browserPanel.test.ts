import test from "node:test";
import assert from "node:assert/strict";
import { canWatchBrowser, isBrowserStatus, mergeBrowserStatus, observeBrowser } from "../src/browser/model";
import { LatestBrowserFrames } from "../src/browser/frames";

const status = { chatId: "a", generation: "one", control: "ai" as const, controlVersion: 1, url: "https://example.test", error: null };
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
	assert.equal(canWatchBrowser({ ...status, control: "disconnected" }), false);
	assert.equal(canWatchBrowser({ ...status, control: "stopped" }), true);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
test("frame decoding drops replaced frames, closes bitmaps and never paints after disposal", async () => {
	const decodes: { data: string; resolve: (image: any) => void }[] = [];
	const drawn: number[] = [];
	const acks: number[] = [];
	const closed: number[] = [];
	const frames = new LatestBrowserFrames((data) => new Promise<any>((resolve) => { decodes.push({ data, resolve }); }), (_image, seq) => drawn.push(seq), (seq) => acks.push(seq), () => assert.fail("valid frame"));
	frames.push({ seq: 1, data: "one" }); await tick();
	frames.push({ seq: 2, data: "two" }); frames.push({ seq: 3, data: "three" });
	assert.deepEqual(acks, [2]);
	decodes[0].resolve({ width: 10, height: 10, close: () => closed.push(1) }); await tick();
	assert.deepEqual(drawn, [], "Superseded in-flight bitmap must not flash");
	assert.equal(decodes[1].data, "three");
	decodes[1].resolve({ width: 10, height: 10, close: () => closed.push(3) }); await tick();
	assert.deepEqual(drawn, [3]); assert.deepEqual(closed, [1, 3]);
	frames.dispose();
	frames.push({ seq: 4, data: "four" }); await tick();
	assert.equal(decodes.length, 2);
	const disposed = new LatestBrowserFrames(() => new Promise<any>((resolve) => { decodes.push({ data: "late", resolve }); }), () => assert.fail("disposed"), () => assert.fail("no late ack"), () => assert.fail("disposed"));
	disposed.push({ seq: 5, data: "late" }); await tick(); disposed.dispose();
	decodes[2].resolve({ width: 10, height: 10, close: () => closed.push(5) }); await tick();
	assert.equal(closed.at(-1), 5);
});
