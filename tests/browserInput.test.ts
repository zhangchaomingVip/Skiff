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
	assert.equal(browserPoint(rect, { width: 0, height: 0 }, 100, 100), undefined);
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
