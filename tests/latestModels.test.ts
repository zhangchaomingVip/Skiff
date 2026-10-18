import test from "node:test";
import assert from "node:assert/strict";
import { baseVersion, catalogModelIdsMatch, modelIdMatchesCatalog, parseOfficialPage, familyLatest, familyUpdates, mergeFamilyModels, pickRecommendedIds, pickVisibleIds, sameModelId, seedFamilyModels, FALLBACK_LATEST, type FamilyLatest } from "../src/chat/latestModels.ts";
import type { OfficialPage } from "../src/rpc/officialPages.ts";
import type { CatalogEntry } from "../src/rpc/pricingPage.ts";

const page = (familyId: string, body: string): OfficialPage => ({ familyId, url: `https://docs.example/${familyId}`, body, fetchedAt: 0 });

test("baseVersion strips variant suffixes and keeps bare IDs", () => {
	assert.equal(baseVersion("glm-5.3-flash"), "glm-5.3");
	assert.equal(baseVersion("glm-5.3-flashx"), "glm-5.3");
	assert.equal(baseVersion("glm-4.1v-thinking-flash"), "glm-4.1v");
	assert.equal(baseVersion("glm-5.3"), "glm-5.3");
	assert.equal(baseVersion("kimi/kimi-k2.7-code-highspeed"), "kimi-k2.7-code");
	assert.equal(baseVersion("deepseek-flash"), "deepseek");
	assert.equal(baseVersion("ZHIPU/GLM-5.3-FlashX"), "glm-5.3");
});

test("parseOfficialPage reads the GLM overview table layout", () => {
	const html = `<table><tr><th>模型</th><th>特点</th><th>上下文</th></tr>
<tr><td>GLM-5.3</td><td>旗舰</td><td>1M</td></tr>
<tr><td>GLM-5.3-Flash</td><td>多模态</td><td>1M</td></tr>
<tr><td>GLM-4.7</td><td>旧</td><td>200K</td></tr></table>`;
	const models = parseOfficialPage(page("glm", html));
	assert.ok(models.has("glm-5.3"));
	assert.ok(models.has("glm-5.3-flash"));
	assert.ok(models.has("glm-4.7"));
});

test("parseOfficialPage reads the DeepSeek header-as-model layout", () => {
	const html = `<table><tr><th>模型</th><th>deepseek-flash</th><th>deepseek-v4-pro</th></tr>
<tr><td>BASE URL</td><td>https://api.deepseek.com</td><td></td></tr></table>`;
	const models = parseOfficialPage(page("deepseek", html));
	assert.ok(models.has("deepseek-flash"));
	assert.ok(models.has("deepseek-v4-pro"));
});

test("parseOfficialPage reads Kimi embedded rows data", () => {
	const body = "const t = _jsx(T, {cols:[],rows:[[`kimi-k3`,`1M tokens`,`¥20.00`],[`kimi-k2.7-code`,`1M tokens`,`¥1.30`]]})";
	const models = parseOfficialPage(page("kimi", body));
	assert.ok(models.has("kimi-k3"));
	assert.ok(models.has("kimi-k2.7-code"));
});

test("familyLatest picks the newest on-sale version group and skips retired", () => {
	const catalog: CatalogEntry[] = [
		{ provider: "glm", modelId: "glm-5.2", name: "", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: null, updated: "2026-06-13" },
		{ provider: "glm", modelId: "glm-5.3-flash", name: "", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: null, updated: "2026-08-26" },
		{ provider: "glm", modelId: "glm-old", name: "", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: "deprecated", updated: "2026-01-01" },
	];
	const html = `<table><tr><th>模型</th><th>状态</th></tr><tr><td>GLM-5.3</td><td></td></tr></table>`;
	const latest = familyLatest([page("glm", html)], catalog);
	const glm = latest.get("glm")!;
	assert.deepEqual(glm.latestGroup.sort(), ["glm-5.3", "glm-5.3-flash"]);
	assert.equal(glm.latestVersion, "glm-5.3");
	assert.ok(!glm.modelIds.includes("glm-old") === false); // listed but filtered from groups
	assert.ok(!glm.latestGroup.includes("glm-old"));
});

test("familyUpdates flags only fully-uncovered latest groups", () => {
	const latest = new Map<string, FamilyLatest>([
		["glm", { familyId: "glm", modelIds: ["glm-5.3", "glm-5.4"], latestGroup: ["glm-5.4"], latestVersion: "glm-5.4", updated: new Map() }],
		["kimi", { familyId: "kimi", modelIds: ["kimi-k3"], latestGroup: ["kimi-k3"], latestVersion: "kimi-k3", updated: new Map() }],
	]);
	// Configured 5.3 only → glm has news; kimi configured via its flash variant → covered.
	const updates = familyUpdates(latest, new Map([
		["glm", new Set(["glm-5.3"])],
		["kimi", new Set(["kimi-k3-flash"])],
	]));
	assert.deepEqual(updates.map((item) => item.familyId), ["glm"]);
	assert.deepEqual(updates[0].newIds, ["glm-5.4"]);
});

test("pickRecommendedIds serves flagship + flash from the latest group", () => {
	const latest = new Map<string, FamilyLatest>([
		["glm", { familyId: "glm", modelIds: [], latestGroup: ["glm-5.4", "glm-5.4-flash", "glm-5.4-flashx"], latestVersion: "glm-5.4", updated: new Map() }],
	]);
	const result = pickRecommendedIds(["glm-5.4-flashx", "glm-5.4-flash", "glm-5.4", "glm-5.2"], latest, "glm");
	assert.deepEqual(result, { recommended: ["glm-5.4", "glm-5.4-flash"], reason: "latest" });
});

test("models.dev display names match relay IDs while preserving the relay ID", () => {
	const catalog: CatalogEntry[] = [{
		provider: "deepseek", modelId: "deepseek-flash", name: "DeepSeek V4.1 Flash 1017",
		inputCost: 0.15, outputCost: 0.6, contextWindow: 1000000, maxTokens: 393216,
		vision: true, tools: true, reasoning: true, status: null, updated: "2026-10-17",
	}];
	const latest = familyLatest([], catalog);
	assert.ok(modelIdMatchesCatalog("deepseek-v4.1-flash", catalog[0]));
	assert.ok(modelIdMatchesCatalog("deepseek-v4-flash-0731", { modelId: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }));
	assert.ok(modelIdMatchesCatalog("deepseek-ai/DeepSeek-V4.1-Flash", catalog[0]));
	assert.ok(catalogModelIdsMatch("deepseek-flash", "deepseek-v4.1-flash", catalog));
	assert.deepEqual(pickRecommendedIds(["deepseek-v4.1-flash"], latest, "deepseek"), {
		recommended: ["deepseek-v4.1-flash"], reason: "latest",
	});
});

test("pickRecommendedIds falls back to newest served IDs, then offline", () => {
	const latest = new Map<string, FamilyLatest>([
		["glm", { familyId: "glm", modelIds: ["glm-5.4"], latestGroup: ["glm-5.4"], latestVersion: "glm-5.4", updated: new Map([["glm-5.3-flash", "2026-08-26"], ["glm-5.2", "2026-06-13"], ["glm-5.3", "2026-08-14"]]) }],
	]);
	// Relay predates the latest group → rank served IDs by catalog freshness.
	const fallback = pickRecommendedIds(["glm-5.2", "glm-5.3-flash", "glm-5.3", "glm-4.6"], latest, "glm");
	assert.deepEqual(fallback, { recommended: ["glm-5.3-flash", "glm-5.3"], reason: "fallback-available" });
	// No catalog at all → empty, UI keeps current behaviour.
	assert.deepEqual(pickRecommendedIds(["glm-5.3"], undefined, "glm"), { recommended: [], reason: "offline" });
});

test("pickVisibleIds caps the family view at the two newest models", () => {
	const latest = new Map<string, FamilyLatest>([
		["glm", { familyId: "glm", modelIds: ["glm-5.4", "glm-5.4-flash", "glm-5.4-flashx"], latestGroup: ["glm-5.4", "glm-5.4-flash", "glm-5.4-flashx"], latestVersion: "glm-5.4", updated: new Map() }],
	]);
	// Latest group wins and is trimmed to two.
	assert.deepEqual(pickVisibleIds("glm", latest, []), ["glm-5.4", "glm-5.4-flash"]);
	const deepseekLatest = new Map<string, FamilyLatest>([
		["deepseek", { familyId: "deepseek", modelIds: ["deepseek-flash", "deepseek-v4-pro"], latestGroup: ["deepseek-flash"], latestVersion: "deepseek", updated: new Map() }],
	]);
	const deepseekCatalog: CatalogEntry[] = [
		{ provider: "deepseek", modelId: "deepseek-flash", name: "DeepSeek V4.1 Flash 1017", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: true, tools: true, reasoning: true, status: null, updated: "2026-10-17" },
		{ provider: "deepseek", modelId: "deepseek-v4-pro", name: "DeepSeek V4 Pro", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: null, updated: "2026-08-22" },
	];
	assert.deepEqual(pickVisibleIds("deepseek", deepseekLatest, deepseekCatalog), ["deepseek-flash", "deepseek-v4-pro"]);
	// Without latest data, the two freshest catalog entries stand in.
	const catalog: CatalogEntry[] = [
		{ provider: "glm", modelId: "glm-5.2", name: "", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: null, updated: "2026-06-13" },
		{ provider: "glm", modelId: "glm-5.3", name: "", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: null, updated: "2026-08-14" },
		{ provider: "glm", modelId: "glm-4.6", name: "", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: null, updated: "2026-01-01" },
		{ provider: "kimi", modelId: "kimi-k3", name: "", inputCost: 1, outputCost: 1, contextWindow: 0, maxTokens: 0, vision: false, tools: true, reasoning: true, status: null, updated: "2026-09-01" },
	];
	assert.deepEqual(pickVisibleIds("glm", undefined, catalog), ["glm-5.3", "glm-5.2"]);
	// Kimi reads both its own and the moonshotai catalog scope.
	const kimiCatalog = [{ ...catalog[3], provider: "moonshotai" }];
	assert.deepEqual(pickVisibleIds("kimi", undefined, kimiCatalog), ["kimi-k3"]);
	// No data at all → nothing to show for the family.
	assert.deepEqual(pickVisibleIds("deepseek", undefined, []), []);
});

test("seedFamilyModels fills missing families from the built-in defaults", () => {
	const seeded = seedFamilyModels(undefined);
	for (const familyId of Object.keys(FALLBACK_LATEST)) {
		const entries = seeded[familyId]!;
		assert.equal(entries.length, 2);
		assert.deepEqual(entries.map((entry) => entry.modelId), [...FALLBACK_LATEST[familyId]!]);
		assert.ok(entries.every((entry) => entry.origin === "auto"));
	}
	// Existing user data wins; families the user removed stay removed.
	const custom = { deepseek: [{ modelId: "deepseek-x", origin: "manual" as const }] };
	assert.deepEqual(seedFamilyModels(custom).deepseek, custom.deepseek);
	assert.deepEqual(seedFamilyModels({ deepseek: [{ modelId: "deepseek-flash", origin: "auto" }] }).deepseek, [
		{ modelId: "deepseek-flash", origin: "auto" }, { modelId: "deepseek-v4-pro", origin: "auto" },
	]);
});

test("mergeFamilyModels keeps manual entries and replaces auto ones", () => {
	const current = [
		{ modelId: "deepseek-mine", origin: "manual" as const },
		{ modelId: "deepseek-v3", origin: "auto" as const },
		{ modelId: "deepseek-flash", origin: "auto" as const },
	];
	// Manual stays first; old auto pair is replaced by the fresh one.
	const merged = mergeFamilyModels(current, ["deepseek-v4-pro", "deepseek-flash"]);
	assert.deepEqual(merged, [
		{ modelId: "deepseek-mine", origin: "manual" },
		{ modelId: "deepseek-v4-pro", origin: "auto" },
		{ modelId: "deepseek-flash", origin: "auto" },
	]);
	// A manual entry duplicating a fresh auto ID suppresses the duplicate.
	const deduped = mergeFamilyModels([
		{ modelId: "DeepSeek-V4-Pro", origin: "manual" as const },
		{ modelId: "deepseek-v3", origin: "auto" as const },
	], ["deepseek-v4-pro", "deepseek-flash"]);
	assert.deepEqual(deduped, [
		{ modelId: "DeepSeek-V4-Pro", origin: "manual" },
		{ modelId: "deepseek-flash", origin: "auto" },
	]);
	// Auto entries are capped at two even when the group is larger.
	const capped = mergeFamilyModels(undefined, ["glm-5.4", "glm-5.4-flash", "glm-5.4-flashx"]);
	assert.deepEqual(capped.map((entry) => entry.modelId), ["glm-5.4", "glm-5.4-flash"]);
	// Whitespace-only or empty IDs are dropped.
	assert.deepEqual(mergeFamilyModels(undefined, ["  ", "glm-5.4"]), [{ modelId: "glm-5.4", origin: "auto" }]);
});

test("sameModelId tolerates case and vendor prefixes but not variants", () => {
	assert.ok(sameModelId("deepseek-v4.1-flash", "DeepSeek-V4.1-Flash"));
	assert.ok(sameModelId("deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-v4.1-flash"));
	assert.ok(sameModelId("kimi/kimi-k3", "KIMI-K3"));
	assert.ok(!sameModelId("deepseek-v4.1-flash", "deepseek-flash"), "Distinct variants must not merge");
	assert.ok(!sameModelId("deepseek-v4.1-flash", ""));
	assert.ok(!sameModelId("", "deepseek-v4.1-flash"));
});
