import test from "node:test";
import assert from "node:assert/strict";
import { pickerGroups, pickerModelName, formatPriceMultiplier } from "../src/chat/modelPicker.ts";
import { modelsFromOffers } from "../src/chat/modelFamilies.ts";
import type { ModelInfo } from "../src/chat/types.ts";

test("picker retains distinct custom IDs with the same alias across all families", () => {
	const models = [
		{ id: "deepseek-v4-1-flash-1017-uncensored", provider: "r1", familyId: "deepseek", alias: "Flash" },
		{ id: "deepseek-v4.1-flash-uncensored", provider: "r1", familyId: "deepseek", alias: "Flash" },
		{ id: "personal-model", provider: "r1", familyId: "community" },
		{ id: "unlisted-model", provider: "r1", familyId: "" },
		{ id: "auto", provider: "r2", familyId: "auto" },
	];
	assert.deepEqual(pickerGroups(models, "", () => undefined).flatMap((group) => group.models), models);
	assert.deepEqual(pickerGroups(models, "uncensored", () => undefined)[0].models, models.slice(0, 2));
});

test("picker combines a provider's families while retaining exact route identities", () => {
	const models = [
		{ provider: "r1-deepseek", relayId: "r1", providerName: "中转 A", id: "deepseek-chat", familyId: "deepseek", familyName: "DeepSeek" },
		{ provider: "r2-deepseek", relayId: "r2", providerName: "中转 B", id: "deepseek-chat", familyId: "deepseek", familyName: "DeepSeek" },
		{ provider: "r1-kimi", relayId: "r1", providerName: "中转 A", id: "kimi-k3", familyId: "kimi", familyName: "Kimi", alias: "月之暗面" },
	];
	const familyOf = (model: ModelInfo) => model.familyId ? { id: model.familyId, name: model.familyName ?? model.familyId } : undefined;
	assert.deepEqual(pickerGroups(models, "", familyOf).map((group) => group.models.map((model) => model.provider)), [["r1-deepseek", "r1-kimi"], ["r2-deepseek"]]);
	for (const query of ["kimi", "月之暗面", " KIMI "]) assert.equal(pickerGroups(models, query, familyOf)[0].models[0], models[2]);
	assert.equal(pickerGroups(models, "中转 B", familyOf)[0].models[0], models[1]);
	assert.equal(pickerGroups(models, "不存在", familyOf).length, 0);
});

test("picker keeps aliases compact and preserves multiplier precision", () => {
	const model = modelsFromOffers([{ familyId: "kimi", familyName: "Kimi", relayId: "r1", relayName: "中转 A", providerKey: "r1-kimi", modelId: "kimi-k3", alias: "月之暗面", priceMultiplier: 0.25, inputCost: 1, outputCost: 4, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }])[0];
	assert.equal(pickerModelName(model), "月之暗面");
	assert.equal(model.priceMultiplier, 0.25);
	assert.equal(model.cost?.input, 1, "runtime costs are already scaled and must not be discounted twice");
	assert.equal(formatPriceMultiplier(0.25), "0.25x");
	assert.equal(formatPriceMultiplier(0), "0x");
	assert.equal(formatPriceMultiplier(1.5), "1.5x");
	for (const multiplier of [undefined, 1, -1, NaN, Infinity]) assert.equal(formatPriceMultiplier(multiplier), undefined);
});
