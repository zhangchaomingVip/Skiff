import test from "node:test";
import assert from "node:assert/strict";
import { pickerGroups, pickerModelName, formatPriceMultiplier, visiblePickerModels } from "../src/chat/modelPicker.ts";
import { modelsFromOffers } from "../src/chat/modelFamilies.ts";
import type { ModelInfo } from "../src/chat/types.ts";

test("picker follows the settings flagship/flash list and hides legacy versions", () => {
	const models = ["glm-5.1", "glm-5.2", "glm-5.3", "glm-5.3-flash"].map((id) => ({ id, provider: "r1-glm", familyId: "glm" }));
	const config = { glm: [{ modelId: "glm-5.3", origin: "auto" as const }, { modelId: "glm-5.3-flash", origin: "auto" as const }] };
	assert.deepEqual(visiblePickerModels(models, config, [], () => undefined).map((model) => model.id), ["glm-5.3", "glm-5.3-flash"]);
	assert.deepEqual(visiblePickerModels(models, { glm: [] }, [], () => undefined), []);
	assert.deepEqual(visiblePickerModels(models.slice(0, 2), config, [], () => undefined), [], "a provider without configured display models must not fall back to old versions");
	assert.deepEqual(visiblePickerModels(models, { glm: [{ modelId: "glm-5.2", origin: "manual" }] }, [], () => undefined), [models[1]], "manual settings entries stay selectable");
});

test("picker resolves catalog aliases once per route and preserves the real selection IDs", () => {
	const models = [
		{ id: "deepseek-v4.1-flash-1017", provider: "r1", familyId: "deepseek" },
		{ id: "deepseek-flash", provider: "r1", familyId: "deepseek" },
		{ id: "deepseek-v4.1-flash", provider: "r2", familyId: "deepseek" },
		{ id: "deepseek-v4-pro", provider: "r2", familyId: "deepseek" },
	];
	const catalog = [{ modelId: "deepseek-flash", name: "DeepSeek V4.1 Flash 1017" }];
	const config = { deepseek: [{ modelId: "deepseek-v4-pro", origin: "auto" as const }, { modelId: "deepseek-flash", origin: "auto" as const }] };
	assert.deepEqual(visiblePickerModels(models, config, catalog, () => undefined), [models[1], models[3], models[2]]);
});

test("picker keeps Auto and unknown provider models available", () => {
	const models = [{ id: "auto", provider: "r1", familyId: "auto" }, { id: "custom-model", provider: "custom" }];
	assert.deepEqual(visiblePickerModels(models, {}, [], () => undefined), models);
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
