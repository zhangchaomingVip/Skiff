import test from "node:test";
import assert from "node:assert/strict";
import { filterSettingsProviders, providerSourceLabel, routeBlockedReason, routeMatchesQuery, routeSummaryModels, settingsModelCandidates, settingsProviderEndpointLabel, settingsProviderEndpointTitle, settingsTestTarget } from "../src/chat/settingsModels.ts";
import { blankModel, blankRelay, blankRoute, type ModelFamily } from "../src/chat/useModelFamilies.ts";
import { routesFromProviderModels } from "../src/chat/providerRoutes.ts";

const model = (modelId: string) => ({ ...blankModel(), modelId });
const relay = { ...blankRelay(), id: "a", name: "Same name", baseUrl: "https://api.example.com/v1", protocol: "anthropic" as const, timeoutSeconds: 123 };
const other = { ...relay, id: "b" };
const catalog = [{ modelId: "deepseek-flash", name: "DeepSeek V4.1 Flash 1017" }];
const route = { ...blankRoute("a"), id: "first", models: [model("vendor/deepseek-v4.1-flash"), model("deepseek-flash"), model("other/deepseek-v4.1-flash")] };
const family: ModelFamily = { id: "deepseek", displayName: "DeepSeek", routes: [route, { ...route, id: "later", relayId: "b", models: [model("deepseek-old")] }] };

test("settings candidate selection follows route order and resolves the exact API ID first", () => {
	const before = structuredClone(family);
	const target = settingsTestTarget(family, [relay, other], "deepseek-flash", catalog)!;
	assert.equal(target.route.id, "first");
	assert.equal(target.model.modelId, "deepseek-flash");
	assert.equal(target.relay.protocol, "anthropic");
	assert.equal(target.relay.timeoutSeconds, 123);
	assert.equal(target.relay.baseUrl, relay.baseUrl);
	const excluded = { ...relay, excludedModelIds: ["deepseek-flash"] };
	assert.equal(settingsTestTarget(family, [excluded, other], "deepseek-flash", catalog)?.model.modelId, "vendor/deepseek-v4.1-flash");
	assert.deepEqual(family, before);
	assert.equal(settingsTestTarget({ ...family, routes: [{ ...route, enabled: false }, { ...route, id: "later", relayId: "b" }] }, [relay, other], "deepseek-flash", catalog)?.route.id, "later");
});

test("available counts and Auto require an enabled provider, enabled route and an included actual model", () => {
	assert.equal(settingsModelCandidates(family, [relay, other], "deepseek-flash", catalog).length, 1);
	assert.equal(settingsModelCandidates(family, [{ ...relay, enabled: false }, other], "deepseek-flash", catalog).length, 0);
	assert.equal(settingsModelCandidates({ ...family, routes: [{ ...route, enabled: false }] }, [relay]).length, 0);
	assert.equal(settingsModelCandidates({ ...family, routes: [{ ...route, models: [] }] }, [relay]).length, 0);
	const excluded = { ...relay, excludedModelIds: route.models.map((item) => item.modelId) };
	assert.equal(settingsModelCandidates({ ...family, routes: [route] }, [excluded]).length, 0);
	assert.equal(routeBlockedReason(route, excluded), "所有模型已剔除");
	assert.equal(route.enabled, true);
	assert.equal(settingsTestTarget({ ...family, routes: [{ ...route, id: "second", relayId: "b" }, route] }, [relay, other], "deepseek-flash", catalog)?.route.id, "second");
});

test("route summaries prefer visible models then retain historical/manual IDs without mutating configuration", () => {
	const historic = { ...route, models: [model("old"), model("manual"), model("deepseek-flash")] };
	assert.deepEqual(routeSummaryModels(historic, ["deepseek-flash"], catalog).map((item) => item.modelId), ["deepseek-flash", "old", "manual"]);
	assert.deepEqual(routeSummaryModels({ ...historic, models: [...historic.models, model("fourth")] }, [], []).map((item) => item.modelId), ["old", "manual", "deepseek-flash"]);
	assert.equal(routeMatchesQuery({ ...historic, models: [{ ...model("old"), alias: "Custom Display" }] }, relay, "DISPLAY"), true);
	assert.equal(routeMatchesQuery(historic, relay, "same NAME"), true);
	assert.equal(historic.models.length, 3);
});

test("provider search uses only name and masked endpoint, source tags safely fall back", () => {
	const configured = { ...relay, name: "Relay", baseUrl: "https://api.example.com/private-path?token=hidden", apiKey: "secret-key" };
	assert.deepEqual(filterSettingsProviders([configured], "SECRET"), []);
	assert.deepEqual(filterSettingsProviders([configured], "private-path"), []);
	assert.equal(filterSettingsProviders([configured], "EXAMPLE.COM").length, 1);
	assert.equal(providerSourceLabel(configured.baseUrl), "自定义");
	assert.equal(providerSourceLabel("https://api.deepseek.co"), "自定义");
	assert.equal(providerSourceLabel("https://api.deepseek.com/v1"), "官方直连");
	assert.equal(providerSourceLabel("https://api.siliconflow.cn/v1"), "中转");
	assert.equal(providerSourceLabel("http://localhost:11434/v1"), "本机");
});

test("provider endpoint labels keep Aliyun recognizable without crowding list details", () => {
	assert.equal(settingsProviderEndpointLabel("https://ws-u4rxmkejbrrkfhif.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"), "ws-u4rxmke…aliyuncs.com");
	assert.equal(settingsProviderEndpointLabel("https://dashscope.aliyuncs.com/compatible-mode/v1"), "dashscope.aliyuncs.com");
	assert.equal(settingsProviderEndpointLabel("https://relay.example.com/customer-secret/v1"), "relay.example.com/…");
	assert.equal(settingsProviderEndpointLabel("https://user:password@relay.example.com/private-path?token=hidden"), "relay.example.com/…");
	assert.equal(settingsProviderEndpointTitle("https://ws-u4rxmkejbrrkfhif.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"), "https://ws-u4rxmkejbrrkfhif.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
	assert.equal(settingsProviderEndpointTitle("https://user:password@ws-u4rxmkejbrrkfhif.cn-beijing.maas.aliyuncs.com/compatible-mode/v1?token=hidden"), "https://ws-u4rxmkejbrrkfhif.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
	assert.equal(settingsProviderEndpointTitle("https://user:password@relay.example.com/private-path?token=hidden"), "relay.example.com/…");
});

test("a prefixed alias before the full exact ID does not steal the settings test target", () => {
	const prefixed = { ...route, models: [model("vendor/deepseek-flash"), model("deepseek-flash")] };
	assert.equal(settingsTestTarget({ ...family, routes: [prefixed] }, [relay], "deepseek-flash", [])?.model.modelId, "deepseek-flash");
});

test("provider saves preserve excluded model positions, prices, capabilities and route priority", () => {
	const original = { ...route, thinkingLevels: ["high"], models: [{ ...model("old"), currency: "USD" as const, inputCost: 0, outputCost: 9, vision: true, thinkingLevels: ["low"] }, model("excluded"), model("third")] };
	const config = [{ ...family, routes: [original] }];
	const saved = routesFromProviderModels({ ...relay, excludedModelIds: ["excluded"] }, config, [{ familyId: "deepseek", model: { ...original.models[0], alias: "Changed", contextWindow: 64000 } }, { familyId: "deepseek", model: original.models[2] }])[0].route;
	assert.deepEqual(saved.models.map((item) => item.modelId), ["old", "excluded", "third"]);
	assert.deepEqual(saved.models[0], { ...original.models[0], alias: "Changed", contextWindow: 64000 });
	assert.deepEqual({ ...saved, models: [] }, { ...original, models: [] });
	assert.deepEqual(saved.models.slice(1), original.models.slice(1));
	assert.deepEqual(config[0].routes.map((item) => item.id), [original.id]);
});
