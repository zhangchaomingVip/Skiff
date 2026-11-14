import test from "node:test";
import assert from "node:assert/strict";
import { addDesignCanvas, assetCanvasId, designCanvasKey, emptyCanvasState, maxCanvasNameLength, readDesignCanvases, removeDesignCanvas, renameDesignCanvas } from "../src/workbench/designCanvases.ts";

const storage = (value: unknown) => ({ getItem: (key: string) => key === designCanvasKey && value !== undefined ? JSON.stringify(value) : null });

test("canvas index tolerates damaged and legacy payloads", () => {
	assert.deepEqual(readDesignCanvases(storage(undefined)), emptyCanvasState);
	assert.deepEqual(readDesignCanvases(storage({ version: 1, canvases: "nope" })), emptyCanvasState);
	assert.deepEqual(readDesignCanvases({ getItem: () => "{broken" }), emptyCanvasState);
	const read = readDesignCanvases(storage({ version: 1, activeId: "missing", canvases: [
		{ id: "a", name: "  夏日短片  ", createdAt: 5, updatedAt: 6 },
		{ id: "a", name: "重复 ID" },
		{ id: "b", name: "   " },
		{ id: "c", name: "夜".repeat(maxCanvasNameLength + 5) },
		null,
	] }));
	assert.deepEqual(read.canvases.map((canvas) => canvas.name), ["夏日短片", "夜".repeat(maxCanvasNameLength)]);
	assert.equal(read.activeId, "", "An unknown active canvas falls back to ungrouped");
	assert.equal(readDesignCanvases(storage({ version: 1, activeId: "a", canvases: [{ id: "a", name: "夏日短片" }] })).activeId, "a");
});

test("creating, renaming and removing canvases keeps works addressable", () => {
	let state = emptyCanvasState;
	state = addDesignCanvas(state, "夏日短片", "canvas-a");
	assert.equal(state.activeId, "canvas-a");
	assert.equal(state.canvases.length, 1);
	state = addDesignCanvas(state, "   ", "canvas-b");
	assert.equal(state.canvases[1].name, "未命名画布");
	state = renameDesignCanvas(state, "canvas-b", "  夜色街拍 ");
	assert.equal(state.canvases[1].name, "夜色街拍");
	assert.equal(renameDesignCanvas(state, "canvas-b", "   "), state, "Blank names never overwrite the current one");
	const canvasA = state.canvases[0];
	assert.equal(assetCanvasId({ canvasId: canvasA.id }, state.canvases), canvasA.id);
	assert.equal(assetCanvasId({ canvasId: "deleted" }, state.canvases), "", "Works of a deleted canvas fall back to ungrouped");
	assert.equal(assetCanvasId({}, state.canvases), "");
	assert.equal(removeDesignCanvas({ ...state, activeId: "canvas-a" }, "canvas-b").activeId, "canvas-a", "Removing another canvas keeps the open one");
	state = removeDesignCanvas(state, "canvas-b");
	assert.deepEqual(state.canvases.map((canvas) => canvas.id), ["canvas-a"]);
	assert.equal(state.activeId, "", "Removing the open canvas returns to ungrouped");
	state = removeDesignCanvas(state, "canvas-a");
	assert.equal(state.canvases.length, 0);
});
