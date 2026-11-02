import test from "node:test";
import assert from "node:assert/strict";
import { sparkGeometry } from "../src/chat/sparkline.ts";

const parse = (line: string) => line.split(" ").filter(Boolean).map((point) => point.split(",").map(Number));

test("an empty trail has no shape", () => {
	assert.deepEqual(sparkGeometry([]), { line: "", area: "", last: undefined });
});

test("a single sample sits on the live edge at the top", () => {
	const one = sparkGeometry([12]);
	assert.deepEqual(parse(one.line), [[100, 2]]);
	assert.deepEqual(one.last, { x: 100, y: 2 });
	assert.equal(one.area, "M0,26 L100,2 L100,26 Z");
});

test("an all-zero trail draws nothing so the baseline can stand in", () => {
	assert.deepEqual(sparkGeometry([0, 0, 0]), { line: "", area: "", last: undefined });
	assert.deepEqual(sparkGeometry([0]), { line: "", area: "", last: undefined });
});

test("a steady trail hugs the ceiling while a climb starts on the floor", () => {
	const steady = parse(sparkGeometry([10, 10, 10]).line);
	assert(steady.every(([, y]) => y === 2));
	const rising = parse(sparkGeometry([0, 10, 20]).line);
	assert.equal(rising[0][1], 24);
	assert.equal(rising.at(-1)![1], 2);
	// Evenly spaced across the box, first at the left edge and last at the right.
	assert.deepEqual(rising.map(([x]) => x), [0, 50, 100]);
});

test("broken samples read as zero instead of breaking the curve", () => {
	assert.equal(sparkGeometry([Number.NaN, -4, undefined as unknown as number, 10]).line, "0,24 33.33,24 66.67,24 100,2");
});

test("the area closes back to the baseline", () => {
	const area = sparkGeometry([4, 8]).area;
	assert(area.startsWith("M0,26 L0,13 L100,2 L100,26 Z"));
});

test("a shorter trail keeps the same box", () => {
	const points = parse(sparkGeometry([1, 2], 100, 26).line);
	assert.equal(points[0][0], 0);
	assert.equal(points[1][0], 100);
});
