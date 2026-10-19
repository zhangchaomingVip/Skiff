import test from "node:test";
import assert from "node:assert/strict";
import { latestSettingsTest, providerBatchImpact, settingsTestSummary, sortSettingsProviders, type SettingsTestRecord } from "../src/chat/settingsManagement.ts";
import { blankRelay, type ModelFamily } from "../src/chat/useModelFamilies.ts";

test("provider display sorting and grouping are stable and leave configuration untouched", () => {
	const relays = ["b", "a", "c", "d"].map((id) => ({ ...blankRelay(), id, name: id === "c" ? "a" : id, baseUrl: id === "d" ? "https://api.deepseek.com/v1" : "https://unknown.test/v1", enabled: id !== "b" }));
	const original = structuredClone(relays);
	assert.deepEqual(sortSettingsProviders(relays, "name", []).map((r) => r.id), ["a", "c", "b", "d"]);
	assert.deepEqual(sortSettingsProviders(relays, "status", []).map((r) => r.id), ["a", "c", "d", "b"]);
	const usage = [{ relayId: "a", routeId: "1", usedAt: 5 }, { relayId: "b", routeId: "2", usedAt: 10 }, { relayId: "a", routeId: "3", usedAt: 10 }];
	assert.deepEqual(sortSettingsProviders(relays, "recent", usage).map((r) => r.id), ["b", "a", "c", "d"]);
	assert.deepEqual(sortSettingsProviders(relays, "recent", usage, true).map((r) => r.id), ["d", "b", "a", "c"]);
	assert.deepEqual(relays, original);
});

test("history selects the exact provider and actual model and reports failure, changed and expired results", () => {
	const record: SettingsTestRecord = { relayId: "a", modelId: "actual/model", completedAt: 100, ok: true, latencyMs: 12, status: 200, errorCategory: null, configVersion: "v1", configChanged: false };
	const failed = { ...record, modelId: "another", completedAt: 200, ok: false, status: 401 };
	const tests = [record, failed, { ...record, relayId: "b", completedAt: 300 }];
	assert.equal(latestSettingsTest(tests, "a"), failed);
	assert.equal(latestSettingsTest(tests, "a", ["actual/model"]), record);
	assert.equal(latestSettingsTest(tests, "a", ["actual"]), undefined);
	assert.equal(settingsTestSummary(undefined), "未测试");
	assert.match(settingsTestSummary(failed, 201), /失败.*HTTP 401.*another/);
	assert.doesNotMatch(settingsTestSummary(record, 100 + 7 * 86400000), /过期/);
	assert.match(settingsTestSummary(record, 101 + 7 * 86400000), /记录已过期，建议复测/);
	assert.match(settingsTestSummary({ ...record, configChanged: true }, 101), /配置已变化/);
});

test("batch impact includes disabled, empty and default routes without changing their switches", () => {
	const relays = ["a", "b"].map((id) => ({ ...blankRelay(), id, name: id }));
	const families = [{ id: "deepseek", defaultRouteId: "1", routes: [{ id: "1", relayId: "a", enabled: false, models: [] }, { id: "2", relayId: "a", enabled: true, models: [] }, { id: "3", relayId: "b", models: [] }] }] as unknown as ModelFamily[];
	assert.deepEqual(providerBatchImpact(relays, families, ["a"]), { names: ["a"], routeCount: 2, defaultFamilies: ["deepseek"] });
	assert.equal(families[0].routes[0].enabled, false);
});
