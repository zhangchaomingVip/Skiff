import test from "node:test";
import assert from "node:assert/strict";
import { browserPoint } from "../src/browser/input";
import { parseBlocks } from "../src/chat/parse";
import { toolCallSummary, toolTarget } from "../src/chat/toolRuns";

test("browser coordinates preserve aspect ratio and reject letterbox clicks", () => {
	const rect = { left: 10, top: 20, width: 600, height: 600 };
	const image = { width: 1200, height: 600 };
	assert.equal(browserPoint(rect, image, 20, 30), undefined);
	assert.deepEqual(browserPoint(rect, image, 310, 320), { x: 600, y: 300 });
	// Frames arrive at device pixel density; clicks must land on page CSS pixels.
	assert.deepEqual(browserPoint(rect, { width: 2400, height: 1200 }, 310, 320, 2), { x: 600, y: 300 });
	assert.equal(browserPoint(rect, image, 100, 100, 0), undefined);
	assert.equal(browserPoint(rect, { width: 0, height: 0 }, 100, 100), undefined);
});
test("clicks map to page pixels even while the panel box outgrows the page viewport", () => {
	// A resize the browser has not applied yet: the picture is laid out at page width 757,
	// captured at 2x, and stretched into a wider panel box. The density is the page's, not the box's.
	const near = (point: { x: number; y: number } | undefined, x: number, y: number) => {
		assert.ok(point, "click lands on the page");
		assert.ok(Math.abs(point!.x - x) < 1, `x ${point!.x} != ${x}`);
		assert.ok(Math.abs(point!.y - y) < 1, `y ${point!.y} != ${y}`);
	};
	near(browserPoint({ left: 0, top: 0, width: 970, height: 574 }, { width: 1514, height: 1148 }, 484.5, 287, 2), 378, 287);
	near(browserPoint({ left: 0, top: 0, width: 1345, height: 650 }, { width: 1514, height: 1148 }, 672, 325, 2), 378, 287);
});
test("browser operation metadata and screenshot survive history without accepting arbitrary details", () => {
	const parsed = parseBlocks([{ type: "toolResult", toolCallId: "b", name: "browser", content: [{ type: "text", text: "已取消" }, { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }], isError: true, details: { skiffBrowser: { requestId: "op", operation: "fill", target: "@e1", durationMs: 12, outcome: "cancelled", token: "do-not-keep", text: "password" } } }])[0];
	assert.equal(parsed.kind, "toolResult");
	if (parsed.kind !== "toolResult") return;
	assert.deepEqual(parsed.browser, { requestId: "op", operation: "fill", target: "@e1", durationMs: 12, outcome: "cancelled" });
	assert.equal(parsed.images?.[0].mimeType, "image/png");
	const tool = { kind: "tool" as const, id: "b", name: "browser", argsText: JSON.stringify({ action: "fill", selector: "@e1", text: "secret" }), done: true };
	assert.equal(toolCallSummary({ key: 0, block: tool, result: parsed }).label, "填写字段");
	assert.equal(toolTarget(tool), "@e1");
});
