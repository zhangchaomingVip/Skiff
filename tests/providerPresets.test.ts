import test from "node:test";
import assert from "node:assert/strict";
import { filterPresets, hostOf, matchPreset, PRESET_KINDS, PROVIDER_PRESETS } from "../src/chat/providerPresets.ts";

test("matchPreset resolves relays to their vendor preset by endpoint", () => {
	assert.equal(matchPreset("https://api.deepseek.com/v1")?.id, "deepseek");
	// trailing slashes and a missing /v1 still match
	assert.equal(matchPreset("https://api.deepseek.com")?.id, "deepseek");
	assert.equal(matchPreset("https://api.deepseek.com/v1/")?.id, "deepseek");
	assert.equal(matchPreset("https://api.moonshot.cn/v1")?.id, "kimi");
	assert.equal(matchPreset("https://api.moonshot.ai/v1")?.id, "kimi-global");
	assert.equal(matchPreset("https://open.bigmodel.cn/api/paas/v4")?.id, "glm");
	assert.equal(matchPreset("https://openrouter.ai/api/v1")?.id, "openrouter");
});

test("matchPreset treats localhost and 127.0.0.1 as the same host", () => {
	assert.equal(matchPreset("http://localhost:11434/v1")?.id, "ollama");
	assert.equal(matchPreset("http://127.0.0.1:11434/v1")?.id, "ollama");
});

test("Bailian presets recognise regional and workspace endpoints with host boundaries", () => {
	for (const url of [
		"https://dashscope.aliyuncs.com/compatible-mode/v1",
		"https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		"https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/",
	]) assert.equal(matchPreset(url)?.id, "bailian");
	assert.equal(matchPreset("https://dashscope.aliyuncs.com.evil.example/compatible-mode/v1"), undefined);
	assert.ok(filterPresets("百炼").some((preset) => preset.id === "bailian"));
});

test("matchPreset returns nothing for custom or malformed relays", () => {
	assert.equal(matchPreset("https://api.example.com/v1"), undefined);
	assert.equal(matchPreset("not a url"), undefined);
	assert.equal(matchPreset(""), undefined);
});

test("filterPresets matches name, id and host; empty query returns the catalog", () => {
	assert.equal(filterPresets("").length, PROVIDER_PRESETS.length);
	assert.ok(filterPresets("deepseek").some((preset) => preset.id === "deepseek"));
	assert.ok(filterPresets("硅基").some((preset) => preset.id === "siliconflow"));
	assert.ok(filterPresets("openrouter.ai").some((preset) => preset.id === "openrouter"));
	assert.deepEqual(filterPresets("不存在的供应商"), []);
});

test("every preset has an icon id, links and a known kind", () => {
	const kinds = new Set(PRESET_KINDS.map((entry) => entry.kind));
	for (const preset of PROVIDER_PRESETS) {
		assert.ok(preset.id && preset.name && preset.baseUrl && preset.website && preset.keysUrl, preset.id);
		assert.ok(kinds.has(preset.kind), preset.id);
	}
	// vendor presets name the family they belong to (the three Skiff families)
	const vendors = PROVIDER_PRESETS.filter((preset) => preset.kind === "vendor");
	assert.ok(vendors.every((preset) => ["deepseek", "kimi", "glm"].includes(preset.familyId ?? "")));
});

test("hostOf keeps only the host", () => {
	assert.equal(hostOf("https://platform.deepseek.com/api_keys"), "platform.deepseek.com");
	assert.equal(hostOf("not a url"), "");
});
