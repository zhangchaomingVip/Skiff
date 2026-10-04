import test from "node:test";
import assert from "node:assert/strict";
import { costTooltip, formatCost, formatCosts, summarizeCosts } from "../src/chat/cost.ts";
import { currentTurnStats } from "../src/chat/sailing.ts";
import type { ChatMessage, ModelInfo } from "../src/chat/types.ts";

const model: ModelInfo = { provider: "skiff-deepseek-one", id: "deepseek-chat", currency: "CNY", cost: { input: 2, output: 4 } };
const reply = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
	id, role: "assistant", blocks: [], provider: model.provider, model: model.id,
	usage: { input: 100, cacheRead: 200, cacheWrite: 50, output: 20, reasoning: 15, totalTokens: 370, cost: { total: 999 } }, ...overrides,
});

test("cost uses local provider prices, all input tokens and output including reasoning once", () => {
	const summary = summarizeCosts([reply("one")], [model]);
	assert.equal(summary.unconfigured, false);
	assert.ok(Math.abs(summary.totals.CNY! - 0.00078) < 1e-12);
	assert.equal(formatCosts(summary), "¥0.00078");
	assert.deepEqual(summarizeCosts([reply("live", { streaming: true })], [model]).totals, {});
});

test("cost formatting adapts without rounding small positive amounts to zero", () => {
	assert.equal(formatCost(0.01234, "USD"), "$0.01");
	assert.equal(formatCost(12.345, "CNY"), "¥12.35");
	assert.equal(formatCost(0.000042345, "USD"), "$0.00004235");
	assert.equal(formatCost(0.0000423, "USD"), "$0.0000423");
	assert.equal(formatCost(1e-12, "USD"), "$0.000000000001");
	assert.equal(formatCost(0, "CNY"), "¥0.00");
});

test("zero or missing prices show a dash with an explanation, never pi's estimate", () => {
	for (const prices of [undefined, { input: 0, output: 0 }, { input: Number.NaN, output: 1 }]) {
		const summary = summarizeCosts([reply("one")], [{ ...model, cost: prices }]);
		assert.equal(formatCosts(summary), "—");
		assert.equal(costTooltip(summary), "未配置单价");
	}
	const freeInput = summarizeCosts([reply("one")], [{ ...model, cost: { input: 0, output: 4 } }]);
	assert.equal(formatCosts(freeInput), "¥0.00008");
});

test("session totals follow historical channels and keep currencies separate", () => {
	const other: ModelInfo = { ...model, provider: "skiff-deepseek-two", currency: "USD", cost: { input: 1, output: 2 } };
	const messages: ChatMessage[] = [
		{ id: "prompt-one", role: "user", blocks: [] }, reply("step"), reply("final"),
		{ id: "prompt-two", role: "user", blocks: [] }, reply("second", { provider: other.provider }),
	];
	const totals = summarizeCosts(messages, [model, other], other);
	assert.equal(formatCosts(totals), "¥0.00156 + $0.00039");
	assert.equal(formatCosts(currentTurnStats(messages, [model, other], other).cost), "$0.00039");
	// A deleted channel cannot be priced using the currently selected channel.
	assert.equal(formatCosts(summarizeCosts(messages, [other], other)), "—");
	assert.equal(formatCosts(summarizeCosts([reply("ambiguous", { provider: undefined })], [model, other], other)), "—");
});

test("models on one channel use independent prices and currencies for historical messages", () => {
	const flash: ModelInfo = { ...model, id: "deepseek-flash", cost: { input: 1, output: 4 } };
	const reasoner: ModelInfo = { ...model, id: "deepseek-reasoner", currency: "USD", cost: { input: 5, output: 20 } };
	const messages = [reply("flash", { model: flash.id }), reply("reasoner", { model: reasoner.id })];
	const summary = summarizeCosts(messages, [flash, reasoner], reasoner);
	assert.equal(summary.unconfigured, false);
	assert.ok(Math.abs(summary.totals.CNY! - 0.00043) < 1e-12);
	assert.ok(Math.abs(summary.totals.USD! - 0.00215) < 1e-12);
});
