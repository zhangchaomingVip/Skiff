import test from "node:test";
import assert from "node:assert/strict";
import { layoutCommitGraph } from "../src/workbench/gitHistory";

test("commit graph opens merge lanes and joins their shared ancestor", () => {
	const rows = layoutCommitGraph([{ hash: "merge", parents: ["left", "right"] }, { hash: "left", parents: ["base"] }, { hash: "right", parents: ["base"] }, { hash: "base", parents: [] }]);
	assert.equal(rows[0].width, 2);
	assert.equal(rows[0].lines.filter((line) => line.start === 16).length, 2);
	assert.equal(rows[2].column, 1);
	assert.ok(rows[2].lines.some((line) => line.from === 1 && line.to === 0));
	assert.equal(rows[3].width, 1);
	assert.ok(rows[3].lines.every((line) => line.end === 16));
	assert.equal(rows[0].color, rows[1].color);
});

test("independent roots and octopus merges keep every graph edge in range", () => {
	const rows = layoutCommitGraph([{ hash: "a", parents: ["b", "c", "d"] }, { hash: "other", parents: [] }, { hash: "b", parents: ["end"] }, { hash: "c", parents: ["end"] }, { hash: "d", parents: ["end"] }, { hash: "end", parents: [] }]);
	assert.equal(rows[0].width, 3);
	for (const row of rows) for (const line of row.lines) {
		assert.ok(line.from >= 0 && line.from < row.width);
		assert.ok(line.to >= 0 && line.to < row.width);
	}
	assert.deepEqual(layoutCommitGraph([]), []);
});
