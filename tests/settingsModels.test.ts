import test from "node:test";
import assert from "node:assert/strict";
import { filterSettingsProviders, providerSourceLabel, settingsProviderEndpointLabel, settingsProviderEndpointTitle } from "../src/chat/settingsModels.ts";
import { blankRelay } from "../src/chat/useModelFamilies.ts";
const relay = { ...blankRelay(), id: "a", name: "Relay" };

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
