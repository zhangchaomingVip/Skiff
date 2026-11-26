import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "../.playwright-cli/node_modules/playwright-core");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] || "http://localhost:1421";
await mkdir("dist", { recursive: true });

try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, reducedMotion: "reduce" });
		page.setDefaultTimeout(10000);
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript(() => {
			const fixture = window.webSearchFixture = { validationCalls: 0, installCalls: 0, validationError: undefined };
			let provider = "tavily";
			let configured = false;
			let installed = false;
			let enabled = false;
			const status = () => ({
				provider, configured, enabled, extensionInstalled: installed, validated: null,
				keyHint: configured ? "…6d93" : null, configuredProviders: configured ? [provider] : [],
			});
			// Install the mock before React mounts so status loading and verification can be counted independently.
			Object.defineProperty(window, "__TAURI_INTERNALS__", {
				configurable: true,
				set(bridge) {
					Object.defineProperty(window, "__TAURI_INTERNALS__", { value: bridge, writable: true, configurable: true });
					const invoke = bridge.invoke;
					bridge.invoke = async (command, args, ...rest) => {
						switch (command) {
							case "get_web_search_status": return status();
							case "set_web_search_provider": provider = args.provider; return;
							case "save_web_search_key": configured = true; return;
							case "clear_web_search_key": configured = false; return;
							case "install_web_search_extension": fixture.installCalls++; installed = true; return true;
							case "validate_web_search": {
								fixture.validationCalls++;
								await new Promise((resolve) => { fixture.finishValidation = resolve; });
								return { ...status(), validated: !fixture.validationError, validationMessage: fixture.validationError };
							}
							case "rpc_send": {
								const request = JSON.parse(args.message);
								const respond = (data) => window.skiffPreview.emit(args.instanceId, { type: "response", id: request.id, success: true, data });
								if (installed && request.type === "get_commands") { respond({ commands: [{ name: "web", source: "extension" }] }); return; }
								if (request.type === "prompt" && ["/web on", "/web off"].includes(request.message)) {
									enabled = request.message === "/web on";
									respond({ disposition: "handled" });
									return;
								}
								break;
							}
						}
						return invoke(command, args, ...rest);
					};
				},
			});
		});
		await page.goto(`${base}/tests/preview.html?theme=${theme}`, { waitUntil: "domcontentloaded" });
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		const open = async () => {
			await page.locator(".settings-trigger").click();
			await page.getByRole("button", { name: "联网搜索", exact: true }).click();
		};
		await open();

		const settings = page.locator(".web-search-settings");
		const groups = settings.locator(".settings-group");
		const key = settings.locator("#web-search-key");
		const setup = settings.getByRole("button", { name: "保存", exact: true });
		const cancel = settings.getByRole("button", { name: "取消", exact: true });
		const test = settings.getByRole("button", { name: "测试已保存的 Key", exact: true });
		const clear = settings.locator(".web-search-key-field").getByRole("button", { name: "清除已保存的 Key" });
		const toggle = settings.getByRole("checkbox", { name: "联网搜索" });
		const engine = settings.getByRole("group", { name: "搜索引擎" });
		const chip = groups.first().locator(".web-search-chip");
		const link = settings.getByRole("link", { name: "获取 Key（含免费额度）↗" });
		const install = groups.first().getByRole("button", { name: "安装扩展", exact: true });
		const validationCalls = () => page.evaluate(() => window.webSearchFixture.validationCalls);
		const finishValidation = () => page.evaluate(() => window.webSearchFixture.finishValidation());

		await install.waitFor();
		assert.equal(await groups.count(), 2);
		assert.equal(await groups.first().getByRole("button").count(), 1);
		assert.equal(await chip.innerText(), "扩展未安装");
		assert.equal(await chip.getAttribute("data-state"), "missing");
		assert.equal(await toggle.isChecked(), false);
		assert.doesNotMatch(await settings.innerText(), /诊断|允许模型在回答时检索网页|按量计费|X 原帖|待验证|刷新状态/);
		assert.equal(await settings.locator("details, select").count(), 0);
		assert.deepEqual(await engine.getByRole("button").allTextContents(), ["Tavily · 通用检索", "Exa · 语义检索"]);
		assert.equal(await link.getAttribute("href"), "https://app.tavily.com");
		assert.equal(await link.getAttribute("target"), "_blank");
		assert.equal(await link.getAttribute("rel"), "noreferrer");
		assert.equal(await key.getAttribute("placeholder"), "tvly-…");
		assert.equal(await validationCalls(), 0, "Mounting only reads saved status");
		await engine.getByRole("button", { name: "Exa · 语义检索" }).click();
		await settings.getByText("Exa API Key", { exact: true }).waitFor();
		assert.equal(await key.getAttribute("placeholder"), "exa-…");
		assert.equal(await link.getAttribute("href"), "https://dashboard.exa.ai/api-keys");
		assert.equal(await setup.count(), 1);
		assert.equal(await setup.isDisabled(), true);
		assert.equal(await clear.count(), 0);
		assert.equal(await test.count(), 0);
		assert.equal(await validationCalls(), 0, "Changing engines does not validate");
		await page.screenshot({ path: `dist/web-search-setup-${theme}.png` });

		await install.click();
		await page.waitForFunction(() => window.webSearchFixture.installCalls === 1);
		if (!await settings.isVisible()) {
			await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
			await open();
		}
		await chip.getByText("运行正常", { exact: true }).waitFor();
		assert.equal(await groups.first().getByRole("button").count(), 0);
		assert.equal(await validationCalls(), 0, "Installing the extension does not validate");

		await key.fill("exa-placeholder-for-tests");
		await setup.click();
		await settings.getByRole("button", { name: "保存中…", exact: true }).waitFor();
		assert.equal(await validationCalls(), 1, "Saving validates exactly once");
		await finishValidation();
		await engine.waitFor({ state: "detached" });
		assert.equal(await groups.count(), 1, "The saved configuration collapses while search is off");
		assert.equal(await key.count(), 0);
		await toggle.check();
		await settings.getByText("✓ 有效", { exact: true }).waitFor();
		assert.equal(await key.getAttribute("readonly"), "");
		assert.equal(await key.inputValue(), "••••••••••••6d93");
		await test.waitFor();
		await clear.waitFor();
		assert.equal(await settings.getByRole("button", { name: /修改|重新测试/ }).count(), 0);
		const positions = await settings.evaluate((node) => {
			const toggleRect = node.querySelector(".switch").getBoundingClientRect();
			const chipRect = node.querySelector(".web-search-chip").getBoundingClientRect();
			const keyRect = node.querySelector("#web-search-key").getBoundingClientRect();
			const clearRect = node.querySelector(".web-search-key-clear").getBoundingClientRect();
			return { chipBeforeToggle: chipRect.right <= toggleRect.left, clearInsideKey: clearRect.left > keyRect.left && clearRect.right < keyRect.right };
		});
		assert.deepEqual(positions, { chipBeforeToggle: true, clearInsideKey: true });
		await page.screenshot({ path: `dist/web-search-settings-${theme}.png` });

		await key.click();
		assert.equal(await key.getAttribute("readonly"), null);
		assert.equal(await key.inputValue(), "");
		assert.equal(await key.evaluate((input) => input === document.activeElement), true);
		await setup.waitFor();
		await cancel.click();
		await settings.locator("#web-search-key[readonly]").waitFor();
		assert.equal(await key.inputValue(), "••••••••••••6d93");
		await key.focus();
		await cancel.waitFor();
		await cancel.click();
		assert.equal(await validationCalls(), 1, "Editing and cancelling do not validate");

		await page.evaluate(() => { window.webSearchFixture.validationError = "API Key 无效"; });
		await test.click();
		await settings.locator('button[aria-busy="true"]').getByText("测试中…", { exact: true }).waitFor();
		assert.equal(await validationCalls(), 2);
		await finishValidation();
		await settings.getByText("✗ API Key 无效", { exact: true }).waitFor();
		assert.equal(await chip.innerText(), "当前对话未生效");
		await groups.first().getByRole("button", { name: "重新加载扩展", exact: true }).waitFor();
		await page.evaluate(() => { window.webSearchFixture.validationError = undefined; });
		await test.click();
		await page.waitForFunction(() => window.webSearchFixture.validationCalls === 3);
		await finishValidation();
		await chip.getByText("运行正常", { exact: true }).waitFor();
		assert.equal(await groups.first().getByRole("button").count(), 0);

		await toggle.uncheck();
		await engine.waitFor({ state: "detached" });
		assert.equal(await key.count(), 0);
		await toggle.check();
		await clear.click();
		await setup.waitFor();
		assert.equal(await key.inputValue(), "");
		assert.equal(await clear.count(), 0);
		assert.equal(await test.count(), 0);
		assert.equal(await settings.locator(".web-search-message").count(), 0);
		assert.equal(await validationCalls(), 3, "Toggling and clearing do not validate");

		await page.setViewportSize({ width: 600, height: 400 });
		assert.equal(await settings.evaluate((node) => node.scrollWidth > node.clientWidth), false);
		assert.deepEqual(errors, [], `${theme}: no browser errors`);
		console.log(`PASS ${theme}: switch and repair, segmented engine, inline key actions, validation count and collapsed configuration`);
		await page.close();
	}
} finally {
	await browser.close();
}
