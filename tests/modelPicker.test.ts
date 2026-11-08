import test from "node:test";
import assert from "node:assert/strict";
import { pickerGroups, pickerFamilyGroups, pickerModelName, formatPriceMultiplier } from "../src/chat/modelPicker.ts";
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

test("family sections combine suppliers without merging exact model targets", () => {
	const models = [
		{ id: "unassigned", provider: "p1" },
		{ id: "kimi-k3", provider: "p1", familyId: "kimi" },
		{ id: "deepseek-custom", provider: "p2", familyId: "deepseek" },
		{ id: "kimi-k3", provider: "p2", familyId: "kimi" },
		{ id: "also-unassigned", provider: "p2", familyId: "" },
	];
	const familyOf = (model: ModelInfo) => model.familyId === undefined ? undefined : { id: model.familyId, name: model.familyId };
	const groups = pickerFamilyGroups(models, "", familyOf);
	assert.deepEqual(groups.map(({ key, models }) => [key, models.map((model) => `${model.provider}/${model.id}`)]), [
		["kimi", ["p1/kimi-k3", "p2/kimi-k3"]],
		["deepseek", ["p2/deepseek-custom"]],
		["", ["p1/unassigned", "p2/also-unassigned"]],
	]);
	assert.equal(groups[2].name, "其它模型");
	assert.deepEqual(pickerFamilyGroups(models, "", familyOf, undefined, "")[0].models, [models[0], models[4]]);
});

test("family, supplier and search filters intersect while retaining source order", () => {
	const models = [
		{ id: "private-flash", provider: "pi-a", relayId: "a", providerName: "渠道 A", familyId: "deepseek", alias: "闪电" },
		{ id: "kimi-k3", provider: "pi-a", relayId: "a", familyId: "kimi" },
		{ id: "private-flash", provider: "pi-b", relayId: "b", familyId: "deepseek" },
	];
	const familyOf = (model: ModelInfo) => model.familyId ? { id: model.familyId, name: model.familyId === "deepseek" ? "DeepSeek" : "Kimi" } : undefined;
	for (const query of [" FLASH ", "DeepSeek", "闪电", "渠道 A"]) {
		assert.deepEqual(pickerFamilyGroups(models, query, familyOf, "a", "deepseek")[0].models, [models[0]]);
	}
	assert.equal(pickerFamilyGroups(models, "flash", familyOf, "a", "kimi").length, 0);
	assert.equal(pickerFamilyGroups(models, "", familyOf, "missing").length, 0);
	assert.equal(pickerFamilyGroups([], "", familyOf).length, 0);
	assert.deepEqual(pickerFamilyGroups(models, "", familyOf).map((group) => group.name), ["DeepSeek", "Kimi"]);
});
