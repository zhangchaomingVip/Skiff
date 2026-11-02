import test from "node:test";
import assert from "node:assert/strict";
import { companionPose, latestToolFailed, POSE_MOOD, POSE_OVERLOAD, type PoseSignals } from "../src/chat/companionPose.ts";
import type { ToolStatus, VoyageTool } from "../src/chat/voyageTimeline.ts";

const signals = (overrides: Partial<PoseSignals> = {}): PoseSignals => ({
	streaming: false, phase: "response", activity: "moored", ratio: 0, activeTools: 0, failedTool: false, ...overrides,
});
const tool = (status: ToolStatus, completionOrder?: number): VoyageTool => ({
	id: `${status}-${completionOrder}`, sourceKey: "turn:user", name: "read", summary: "", startedAt: 0, endedAt: 1, status, durationMs: 1, showDuration: false, completionOrder,
});

test("a moored turn rests unless the cache was warm", () => {
	assert.equal(companionPose(signals()), "idle");
	assert.equal(companionPose(signals({ hitRate: 0 })), "idle");
	assert.equal(companionPose(signals({ hitRate: .69 })), "idle");
	assert.equal(companionPose(signals({ hitRate: .7 })), "happy");
	assert.equal(companionPose(signals({ hitRate: .98 })), "happy");
});

test("flowing reply text is the only happy sail", () => {
	assert.equal(companionPose(signals({ streaming: true, activity: "sailing" })), "happy");
	assert.equal(companionPose(signals({ streaming: true, activity: "fishing" })), "sleep");
	assert.equal(companionPose(signals({ streaming: true, activity: "sailing", phase: "thinking" })), "sleep");
});

test("a tool call eats context, a running call counts even before the phase flips", () => {
	assert.equal(companionPose(signals({ streaming: true, activity: "fishing", phase: "tool" })), "eat");
	assert.equal(companionPose(signals({ streaming: true, activity: "sailing", activeTools: 2 })), "eat");
});

test("a failed tool or an overloaded context frowns, and outranks progress", () => {
	assert.equal(companionPose(signals({ failedTool: true })), "angry");
	assert.equal(companionPose(signals({ ratio: POSE_OVERLOAD })), "angry");
	assert.equal(companionPose(signals({ ratio: .99, streaming: true, activity: "sailing" })), "angry");
	assert.equal(companionPose(signals({ failedTool: true, streaming: true, phase: "tool", activity: "fishing" })), "angry");
	// Just under the warning line keeps the content mood.
	assert.equal(companionPose(signals({ ratio: .89, streaming: true, activity: "sailing" })), "happy");
});

test("the newest logged tool decides whether the run frowns", () => {
	assert.equal(latestToolFailed([]), false);
	assert.equal(latestToolFailed([tool("completed", 1)]), false);
	for (const status of ["failed", "timeout", "missing"] as const) assert.equal(latestToolFailed([tool(status, 1)]), true);
	// A cancel is not the navigator's fault.
	assert.equal(latestToolFailed([tool("interrupted", 1)]), false);
	assert.equal(latestToolFailed([tool("failed", 1), tool("completed", 2)]), false);
	assert.equal(latestToolFailed([tool("completed", 2), tool("failed", 1)]), false);
	assert.equal(latestToolFailed([tool("failed", 1), tool("running", 2)]), false);
	assert.equal(latestToolFailed([tool("failed")]), true);
	// No completion order yet: the last entry is still the newest.
	assert.equal(latestToolFailed([tool("failed"), tool("completed")]), false);
});

test("every pose has a mood caption", () => {
	for (const pose of ["idle", "happy", "eat", "sleep", "angry"] as const) assert(/\S/.test(POSE_MOOD[pose]));
});
