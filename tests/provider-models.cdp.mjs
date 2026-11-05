import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Real configuration and pi, with the enclosing harness's isolated credentials and storage. */
export async function verifyProviderModels(page, agentDir, requests, modelId, reply, artifacts, runtimeStarts) {
	const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
	const workspace = () => page.evaluate(() => { const value = JSON.parse(localStorage.getItem("skiff.workspace.v1")); return value.chats.find((chat) => chat.id === value.activeId); });
	const selected = async () => (await workspace()).selectedModel;
	const waitIdle = async () => { await page.getByRole("button", { name: "选择模型", exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector(".model-trigger")?.disabled && !document.querySelector(".stop-btn")); };
	const reload = async () => { await page.reload({ waitUntil: "domcontentloaded" }); await page.locator(".composer-input").waitFor(); };
	const choose = async (provider) => {
		await waitIdle();
		await page.getByRole("button", { name: "选择模型", exact: true }).click();
		await page.getByRole("button", { name: "更多模型…", exact: true }).click();
		await page.getByRole("option", { name: new RegExp(`${provider} ${modelId}$`) }).click();
		await page.waitForFunction(({ provider, modelId }) => { const value = JSON.parse(localStorage.getItem("skiff.workspace.v1")); const chat = value.chats.find((item) => item.id === value.activeId); return chat.selectedModel?.provider === provider && chat.selectedModel.id === modelId; }, { provider: provider === "CDP 另一供应商" ? "skiff-relay-local-second" : "skiff-relay-local-mock", modelId });
	};
	const editModel = async (provider, enabled) => {
		await page.keyboard.press("Control+Comma");
		const settings = page.getByRole("dialog", { name: "设置", exact: true });
		await settings.getByRole("button", { name: "供应商", exact: true }).click();
		assert.equal(await settings.getByRole("button", { name: "路线", exact: true }).count(), 0);
		await settings.getByRole("button", { name: `编辑 ${provider}`, exact: true }).click();
		await settings.getByRole("checkbox", { name: `启用模型 ${modelId}`, exact: true }).setChecked(enabled);
		await settings.getByRole("button", { name: "保存", exact: true }).click();
		await settings.getByRole("heading", { name: "供应商", exact: true }).waitFor();
		await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
	};
	const blocked = async (reason, provider) => {
		await page.getByText(reason, { exact: false }).first().waitFor();
		assert.equal((await selected()).provider, provider);
		const count = requests.length;
		await page.fill(".composer-input", "失效选择必须阻止发送");
		assert.equal(await page.getByRole("button", { name: "发送消息", exact: true }).isDisabled(), true);
		await page.locator(".composer-input").press("Enter");
		await page.waitForTimeout(150);
		assert.equal(requests.length, count);
	};
	let config = await invoke("list_model_families");
	assert.equal(config.version, 6);
	assert.ok(config.families.every((family) => !family.routes?.length));
	assert.ok((await readFile(join(agentDir, "skiff-families.pre-v6.bak.json"), "utf8")).includes('"version": 5'));
	await invoke("create_family", { id: "cdp", displayName: "CDP" });
	const first = { ...config.relays[0], models: config.relays[0].models.map((model) => ({ ...model, familyId: "cdp" })) };
	await invoke("save_relay", { relay: first });
	await invoke("save_relay", { relay: { ...first, id: "local-second", name: "CDP 另一供应商", apiKey: "dummy-second-key", models: first.models.map((model) => ({ ...model, tools: false, streaming: false, reasoning: true, vision: true, thinkingLevels: ["low", "high"], maxTokens: 1024, inputCost: 3, outputCost: 6, legacyProviderKeys: [], legacyRouteIds: [] })) } });
	const oldSnapshots = (await workspace()).routeSnapshots;
	await reload();
	assert.equal((await selected()).provider, "skiff-relay-local-mock");
	await choose("CDP 另一供应商");
	const replyCount = await page.locator(".md").filter({ hasText: reply }).count();
	await page.fill(".composer-input", "验证另一供应商的同名模型");
	const count = requests.length;
	await page.click(".send-btn");
	await page.waitForFunction(({ reply, replyCount }) => [...document.querySelectorAll(".md")].filter((node) => node.textContent.includes(reply)).length > replyCount, { reply, replyCount });
	await page.waitForFunction(() => !document.querySelector('[aria-label="停止生成"]'));
	assert.equal(requests.length, count + 1);
	const request = requests.at(-1);
	assert.equal(request.authorization, "Bearer dummy-second-key"); assert.equal(request.model, modelId);
	assert.equal(request.payload.stream, false); assert.equal(request.payload.tools, undefined);
	assert.equal(request.payload.max_tokens ?? request.payload.max_completion_tokens, 1024);
	assert.deepEqual((await workspace()).routeSnapshots.slice(0, oldSnapshots.length), oldSnapshots);
	assert.equal((await selected()).routeId, undefined); assert.equal((await workspace()).routeEvents, undefined);
	// Manual choice wins over the last reply's historical provider on the next open.
	await choose("CDP 本地验证"); await reload();
	assert.equal((await selected()).provider, "skiff-relay-local-mock");
	// Reproduce the settings flicker with real IPC/pi: consecutive switches
	// save immediately, then the latest projection loads once after closing.
	await waitIdle();
	await page.keyboard.press("Control+Comma");
	const toggleSettings = page.getByRole("dialog", { name: "设置", exact: true });
	await toggleSettings.getByRole("button", { name: "供应商", exact: true }).click();
	await toggleSettings.getByRole("button", { name: "启用 2", exact: true }).click();
	const startsBeforeToggle = runtimeStarts();
	await page.evaluate(() => {
		window.providerToggleRestrictions = [];
		window.providerToggleObserver = new MutationObserver(() => {
			for (const node of document.querySelectorAll(".settings-restriction")) window.providerToggleRestrictions.push(node.textContent);
		});
		window.providerToggleObserver.observe(document.querySelector(".settings-dialog"), { subtree: true, childList: true, attributes: true });
	});
	try {
		for (const provider of ["CDP 本地验证", "CDP 另一供应商"]) {
			for (const enabled of [false, true]) {
				await toggleSettings.getByRole("checkbox", { name: `${enabled ? "启用" : "停用"} ${provider}`, exact: true }).locator("..").click();
				await toggleSettings.getByRole("checkbox", { name: `${enabled ? "停用" : "启用"} ${provider}`, exact: true }).waitFor();
				await page.waitForFunction(() => !document.querySelector('[aria-label="关闭设置"]')?.disabled);
				assert.equal((await invoke("list_model_families")).relays.find((relay) => relay.name === provider).enabled, enabled);
				await page.waitForTimeout(100);
				assert.equal(runtimeStarts(), startsBeforeToggle, "Settings switches do not restart real pi");
				assert.deepEqual(await page.evaluate(() => window.providerToggleRestrictions), []);
				assert.equal(await toggleSettings.getByRole("button", { name: "模型", exact: true }).isEnabled(), true);
			}
		}
		await page.screenshot({ path: join(artifacts, "provider-toggle-stable.png") });
		await toggleSettings.getByRole("button", { name: "关闭设置", exact: true }).click();
		await waitIdle();
		assert.equal(runtimeStarts(), startsBeforeToggle + 1, "Closing settings reloads real pi once");
		console.log("供应商开关全链路通过：连续开关无会话重启或设置页加载提示，关闭设置后统一重启一次。");
	} finally {
		await page.evaluate(() => {
			window.providerToggleObserver.disconnect();
		});
	}
	await editModel("CDP 本地验证", false);
	await blocked("模型已停用", "skiff-relay-local-mock");
	await page.screenshot({ path: join(artifacts, "provider-model-blocked.png") });
	await editModel("CDP 本地验证", true);
	await waitIdle();
	config = await invoke("list_model_families"); assert.equal(config.relays.find((item) => item.id === "local-mock").models[0].enabled, true);
	// Provider switches never overwrite the model switch.
	await invoke("set_relay_enabled", { relayId: "local-mock", enabled: false }); await reload();
	await blocked("供应商已停用", "skiff-relay-local-mock");
	config = await invoke("list_model_families"); assert.equal(config.relays.find((item) => item.id === "local-mock").models[0].enabled, true);
	await invoke("set_relay_enabled", { relayId: "local-mock", enabled: true }); await reload();
	await choose("CDP 另一供应商"); await invoke("delete_relay", { relayId: "local-second" }); await reload();
	await blocked("已删除", "skiff-relay-local-second");
	const configPath = join(agentDir, "skiff-families.json"); const original = await readFile(configPath);
	try { await writeFile(configPath, "invalid-json"); await reload(); await blocked("模型配置加载失败", "skiff-relay-local-second"); }
	finally { await writeFile(configPath, original); }
	// Repair and select in place, even when the failed startup left pi disconnected.
	await page.keyboard.press("Control+Comma");
	const settings = page.getByRole("dialog", { name: "设置", exact: true });
	await settings.getByRole("button", { name: "供应商", exact: true }).click();
	await settings.getByRole("button", { name: "重新读取配置", exact: true }).click();
	await settings.getByRole("button", { name: "重新读取配置", exact: true }).waitFor({ state: "hidden" });
	await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
	await choose("CDP 本地验证"); await waitIdle();
	assert.deepEqual((await workspace()).routeSnapshots.slice(0, oldSnapshots.length), oldSnapshots);
	console.log("供应商模型全链路通过：v5 备份迁移、同名模型精确选择、逐模型工具/流式/输出、手动选择重开、停用/恢复、删除及配置加载失败保持选择并阻止发送；历史价格快照未变。");
}
