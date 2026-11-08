// Mock bridge only. Run with the isolated preview server on port 1421.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const settings = page.getByRole("dialog", { name: "设置", exact: true });
const config = page.locator(".provider-model-config-dialog");
const button = (name) => settings.getByRole("button", { name, exact: true });
const modelRow = (modelId) => settings.locator(`[data-model-id="${modelId}"]`);
const saved = () => page.evaluate(() => structuredClone(window.skiffPreview.relays.find((relay) => relay.id === "r1").models));
const saveCount = () => page.evaluate(() => window.skiffPreview.commands.filter((entry) => entry.command === "save_relay").length);
const openConfig = async (modelId) => {
	const trigger = modelRow(modelId).getByRole("button", { name: `配置模型 ${modelId}`, exact: true });
	await trigger.scrollIntoViewIfNeeded();
	const scrollTop = await settings.locator(".provider-editor-scroll").evaluate((element) => element.scrollTop);
	await trigger.click();
	await config.waitFor();
	assert.equal(await settings.locator(".provider-editor-scroll").evaluate((element) => getComputedStyle(element).overflowY), "hidden", "The background editor hides its scrollbar while model config is open");
	assert.equal(await settings.locator(".provider-editor-scroll").evaluate((element) => element.scrollTop), scrollTop, "Locking the background keeps its scroll position");
};
const done = async () => {
	await config.getByRole("button", { name: "完成", exact: true }).click();
	await config.waitFor({ state: "detached" });
	assert.equal(await settings.locator(".provider-editor-scroll").evaluate((element) => getComputedStyle(element).overflowY), "auto", "Closing model config restores background scrolling");
};
const checkVisibleLayout = async () => {
	const dialogBox = await config.boundingBox();
	assert.ok(Math.abs(dialogBox.width - dialogBox.height) <= 1, `Model config keeps a square aspect ratio: ${dialogBox.width} × ${dialogBox.height}`);
	assert.equal(await config.evaluate((element) => element.scrollWidth <= element.clientWidth), true, "Dialog must not overflow horizontally");
	assert.equal(await config.locator(".provider-model-config-body").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "Form body must not overflow horizontally");
	const footer = await config.locator("footer").boundingBox();
	assert.ok(footer.y >= 0 && footer.y + footer.height <= page.viewportSize().height, "Completion stays in the viewport while the body scrolls");
	const body = config.locator(".provider-model-config-body");
	const scrollTop = await body.evaluate((element) => { const before = element.scrollTop; element.scrollTop = element.scrollHeight; return before; });
	const lastPrice = await config.getByRole("spinbutton", { name: "缓存写入单价 / 百万 token", exact: true }).boundingBox();
	const bodyBox = await body.boundingBox();
	assert.ok(lastPrice.y >= bodyBox.y && lastPrice.y + lastPrice.height <= footer.y, "The final pricing field is fully reachable above the footer");
	assert.deepEqual(await config.locator("footer").boundingBox(), footer, "Scrolling the body leaves the footer fixed");
	await body.evaluate((element, position) => { element.scrollTop = position; }, scrollTop);
};

try {
	await mkdir("dist/provider-model-config", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1200, height: 900 });
		await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}&static=1`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.keyboard.press("Control+Comma");
		await button("供应商").click();
		await button("编辑 官方直连").click();
		const before = await saved();
		const saves = await saveCount();
		assert.equal(await settings.locator(".provider-model-details, .provider-model-family-select").count(), 0);
		const heights = await settings.locator(".provider-model-editor-row").evaluateAll((rows) => rows.map((element) => element.getBoundingClientRect().height));
		assert.ok(heights.every((height) => height < 90), `Rows remain compact: ${heights}`);
		const alignment = await settings.locator(".provider-model-editor-row").evaluateAll((rows) => {
			const headings = [...document.querySelectorAll(".provider-model-editor-columns > span")].slice(4);
			const center = (element) => { const rect = element.getBoundingClientRect(); return rect.x + rect.width / 2; };
			return rows.flatMap((row) => [...row.querySelectorAll(":scope > .switch, :scope > .ui-icon-button")].map((control, index) => Math.abs(center(control) - center(headings[index]))));
		});
		assert.ok(alignment.every((offset) => offset <= 1), `Switch and action icons center under their headings: ${alignment}`);
		await settings.locator('details[data-section="models"]').screenshot({ path: `dist/provider-model-config/list-${theme}.png` });

		await modelRow("deepseek-chat").getByRole("textbox", { name: /上下文窗口/ }).fill("1M");
		await modelRow("deepseek-chat").getByRole("textbox", { name: /显示名/ }).fill("配置测试模型");
		await openConfig("deepseek-chat");
		await config.getByRole("heading", { name: "配置模型 · 配置测试模型", exact: true }).waitFor();
		assert.equal(await config.locator(".provider-model-config-header p").textContent(), "deepseek-chat");
		assert.equal(await config.locator(".provider-model-config-context strong").textContent(), "1M");
		assert.equal(await config.getByRole("spinbutton", { name: /上下文/ }).count(), 0, "There is only one editable context field");
		assert.equal(await config.locator("fieldset, legend").count(), 0);
		const family = config.getByRole("combobox", { name: "模型家族", exact: true });
		assert.equal(await family.evaluate((element) => element === document.activeElement), true);
		await family.selectOption("kimi");
		await config.getByRole("spinbutton", { name: /^最大输出 Token/ }).fill("16000");
		for (const [name, checked] of [["图片输入", true], ["工具调用", false], ["流式输出", false]]) {
			const toggle = config.getByRole("switch", { name, exact: true });
			const card = config.locator(".provider-model-config-capability").filter({ hasText: name });
			if (await toggle.isChecked() !== checked) await card.click({ position: { x: 8, y: 8 } });
			assert.equal(await toggle.isChecked(), checked, "Clicking card padding toggles the capability");
		}
		for (const level of ["minimal", "low", "medium", "high", "xhigh", "max"]) {
			await config.getByRole("checkbox", { name: level, exact: true }).setChecked(["low", "xhigh", "max"].includes(level));
		}
		await config.getByRole("switch", { name: "推理支持", exact: true }).uncheck();
		assert.equal(await config.getByRole("checkbox").count(), 0, "Thinking levels hide when reasoning is off");
		await config.getByRole("switch", { name: "推理支持", exact: true }).check();
		assert.equal(await config.getByRole("checkbox", { name: "xhigh", exact: true }).isChecked(), true, "Toggling reasoning retains levels");
		await config.getByRole("combobox", { name: "币种", exact: true }).selectOption("USD");
		for (const [name, value] of [["输入单价", "2.25"], ["输出单价", "4.5"], ["缓存读取单价", "0.125"], ["缓存写入单价", "0.75"]]) {
			await config.getByRole("spinbutton", { name: `${name} / 百万 token`, exact: true }).fill(value);
		}
		assert.equal(await saveCount(), saves, "Editing advanced fields does not save to the backend");
		assert.deepEqual(await saved(), before, "Saved config stays unchanged until provider save");
		await checkVisibleLayout();
		await config.locator(".provider-model-config-body").evaluate((element) => { element.scrollTop = 0; });
		await config.screenshot({ path: `dist/provider-model-config/dialog-${theme}.png` });
		await page.screenshot({ path: `dist/provider-model-config/overlay-${theme}.png` });
		const backgroundScrollTop = await settings.locator(".provider-editor-scroll").evaluate((element) => element.scrollTop);
		const finish = config.getByRole("button", { name: "完成", exact: true });
		const close = config.getByRole("button", { name: "关闭模型配置", exact: true });
		await finish.focus(); await page.keyboard.press("Tab");
		assert.equal(await close.evaluate((element) => element === document.activeElement), true, "Tab wraps inside the child dialog");
		await page.keyboard.press("Shift+Tab");
		assert.equal(await finish.evaluate((element) => element === document.activeElement), true, "Shift+Tab wraps inside the child dialog");
		await page.keyboard.press("Escape");
		await config.waitFor({ state: "detached" });
		assert.equal(await settings.locator(".provider-editor-scroll").evaluate((element) => getComputedStyle(element).overflowY), "auto");
		assert.equal(await settings.locator(".provider-editor-scroll").evaluate((element) => element.scrollTop), backgroundScrollTop, "Escape restores the editor at its previous scroll position");
		assert.equal(await button("保存").count(), 1, "Escape leaves the provider editor open");
		assert.equal(await modelRow("deepseek-chat").getByRole("button", { name: "配置模型 deepseek-chat", exact: true }).evaluate((element) => element === document.activeElement), true, "Focus returns to the configuration button");
		await settings.getByText("有未保存的更改", { exact: true }).waitFor();
		assert.equal(await modelRow("deepseek-chat").getByText("视觉", { exact: true }).count(), 1);
		assert.equal(await modelRow("deepseek-chat").getByText("工具", { exact: true }).count(), 0);

		// Delete the preceding row, append a manual model, then discover more models.
		// Reopening must still target the same model, even though its index changed.
		await modelRow("deepseek-flash").getByRole("button", { name: /^删除模型 / }).click();
		await button("添加模型").click();
		await settings.locator(".provider-model-editor-row").last().getByRole("button", { name: /^配置模型/ }).click();
		await config.getByRole("heading", { name: "配置模型", exact: true }).waitFor();
		await done();
		await settings.getByRole("textbox", { name: /^模型 ID / }).last().fill("manual-model");
		await openConfig("manual-model");
		await config.getByRole("combobox", { name: "模型家族", exact: true }).selectOption("");
		await config.getByRole("switch", { name: "推理支持", exact: true }).uncheck();
		await config.getByRole("spinbutton", { name: "输入单价 / 百万 token", exact: true }).fill("");
		await done();
		await page.evaluate(() => {
			window.skiffPreview.discovery.models = [{ id: "discovered-model", vision: true, reasoning: false }];
			const invoke = window.__TAURI_INTERNALS__.invoke;
			window.__TAURI_INTERNALS__.invoke = (command, ...args) => {
				if (command !== "discover_relay_models") return invoke(command, ...args);
				return new Promise((resolve, reject) => {
					window.finishModelDiscovery = async () => {
						window.__TAURI_INTERNALS__.invoke = invoke;
						try { resolve(await invoke(command, ...args)); } catch (error) { reject(error); }
					};
				});
			};
		});
		await button("获取模型列表").click();
		await page.waitForFunction(() => !!window.finishModelDiscovery);
		await openConfig("deepseek-chat");
		assert.equal(await family.inputValue(), "kimi");
		await config.getByRole("spinbutton", { name: /^最大输出 Token/ }).fill("15000");
		await page.evaluate(() => window.finishModelDiscovery());
		await page.waitForFunction(() => !!document.querySelector('[data-model-id="discovered-model"]'));
		assert.equal(await config.getByRole("spinbutton", { name: /^最大输出 Token/ }).inputValue(), "15000", "An in-flight discovery preserves the open model and its current edits");
		await config.getByRole("spinbutton", { name: /^最大输出 Token/ }).fill("16000");
		assert.equal(await config.getByRole("spinbutton", { name: /^最大输出 Token/ }).inputValue(), "16000");
		await done();
		assert.equal(await saveCount(), saves, "Done only updates the provider draft");
		await button("保存").click();
		await button("编辑 官方直连").waitFor();
		const persisted = await saved();
		const edited = persisted.find((model) => model.modelId === "deepseek-chat");
		for (const [key, value] of Object.entries({ familyId: "kimi", alias: "配置测试模型", contextWindow: 1000000, maxTokens: 16000, vision: true, reasoning: true, tools: false, streaming: false, currency: "USD", inputCost: 2.25, outputCost: 4.5, cacheReadCost: 0.125, cacheWriteCost: 0.75 })) assert.equal(edited[key], value, `${key} survives save`);
		assert.deepEqual(edited.thinkingLevels, ["low", "xhigh", "max"]);
		assert.equal(persisted.find((model) => model.modelId === "manual-model").inputCost, 0, "Blank pricing stores zero");
		assert.equal(persisted.find((model) => model.modelId === "manual-model").reasoning, false);
		assert.equal(persisted.some((model) => model.modelId === "deepseek-flash"), false);
		assert.deepEqual(persisted.find((model) => model.modelId === "deepseek-reasoner"), before.find((model) => model.modelId === "deepseek-reasoner"), "Neighboring model stays intact");

		await button("编辑 官方直连").click();
		assert.equal(await config.count(), 0, "Reopening a provider clears the child dialog");
		await openConfig("deepseek-chat");
		assert.equal(await config.getByRole("switch", { name: "图片输入", exact: true }).isChecked(), true);
		await config.getByRole("spinbutton", { name: /^最大输出 Token/ }).fill("1000001");
		await finish.click();
		assert.equal(await config.count(), 1, "An output limit exceeding context cannot complete");
		await page.keyboard.press("Escape");
		await button("保存").click();
		await settings.getByText("默认最大输出不能超过上下文窗口", { exact: true }).waitFor();
		assert.deepEqual(await saved(), persisted, "Escape cannot bypass model validation at provider save");
		await openConfig("deepseek-chat");
		await config.getByRole("spinbutton", { name: /^最大输出 Token/ }).fill("16000");
		for (const [width, height] of [[600, 740], [390, 740], [1200, 500]]) {
			await page.setViewportSize({ width, height });
			await checkVisibleLayout();
			await config.screenshot({ path: `dist/provider-model-config/dialog-${theme}-${width}.png` });
		}
		await config.getByRole("spinbutton", { name: "输入单价 / 百万 token", exact: true }).fill("99");
		await done();
		await button("取消").click();
		await button("编辑 官方直连").waitFor();
		assert.deepEqual(await saved(), persisted, "Canceling the provider discards child edits");
		await button("编辑 硅基低价").click();
		assert.equal(await config.count(), 0, "Switching providers leaves no stale model dialog");
		await openConfig("deepseek-ai/DeepSeek-V3");
		assert.equal(await config.locator(".provider-model-config-header p").textContent(), "deepseek-ai/DeepSeek-V3");
		await page.keyboard.press("Escape");
	}
	assert.deepEqual(errors, []);
	console.log("Model config passed: compact rows, every advanced field round-trips, draft/save/cancel, deletion/add/discovery targeting, validation, keyboard/focus and both themes at desktop and narrow widths.");
} finally {
	await browser.close();
}
