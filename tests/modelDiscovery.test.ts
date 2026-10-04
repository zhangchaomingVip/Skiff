import test from "node:test";
import assert from "node:assert/strict";
import { sortDiscoveredModels } from "../src/chat/modelDiscovery.ts";

test("small lists stay alphabetical, even with family matches", () => {
	assert.deepEqual(sortDiscoveredModels(["z-model", "deepseek-chat", "a-model", "a-model"], "deepseek"), ["a-model", "deepseek-chat", "z-model"]);
	const twenty = Array.from({ length: 19 }, (_, i) => `a-${String(i).padStart(2, "0")}`).concat("deepseek-chat");
	assert.equal(sortDiscoveredModels(twenty, "deepseek").at(-1), "deepseek-chat");
});

test("large lists prioritise each family's case-insensitive aliases", () => {
	const others = Array.from({ length: 21 }, (_, i) => `a-${String(i).padStart(2, "0")}`);
	for (const [family, matches] of [
		["deepseek", ["deepseek-chat", "vendor/DeepSeek-V3"]],
		["kimi", ["Kimi-K2", "vendor/moonshot-v1"]],
		["glm", ["GLM-4.6", "vendor/chatglm-6b"]],
	] as const) {
		const result = sortDiscoveredModels([...others, ...matches], family);
		assert.deepEqual(result.slice(0, 2), matches);
		assert.deepEqual(result.slice(2), others);
	}
});
