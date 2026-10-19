import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1423";
const output = new URL("../features/028-settings-information-redesign/screenshots/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const assertNoDisabledFrame = async (element) => {
	const colors = await element.evaluate((node) => {
		const style = getComputedStyle(node);
		return [style.borderTopColor, style.backgroundColor];
	});
	assert.deepEqual(colors, ["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
};
const wait = (fn, arg) => page.waitForFunction(fn, arg);
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`settings-${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
const ready = () => wait(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
const open = async () => { await page.keyboard.press("Control+Comma"); await dialog().waitFor(); };
const close = async () => { await button("关闭设置").click(); await dialog().waitFor({ state: "detached" }); };
const checkLayout = async () => {
	assert.equal(await dialog().evaluate((el) => el.scrollWidth > el.clientWidth), false, "Settings shell must fit");
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Page must fit");
	const rect = await button("关闭设置").boundingBox();
	const viewport = page.viewportSize();
	assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height, "Close must remain visible");
};

try {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`);
	await ready();
	assert.equal(await page.locator(".chat-header button[aria-label='诊断日志']").count(), 0, "Header must not expose the raw log drawer");
	assert.equal(await page.locator(".chat-header button[aria-haspopup='dialog']").count(), 0, "Header must not expose background sessions");
	await page.getByRole("button", { name: "分享对话", exact: true }).click();
	assert.match(await page.getByRole("textbox", { name: "对话分享内容" }).inputValue(), /当前会话/);
	await page.keyboard.press("Control+Comma"); assert.equal(await dialog().count(), 0);
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(".chat-header button[aria-label='系统提示词']").count(), 0, "Prompt entry must live in settings only");
	assert.equal(await page.locator(".chat-header .header-settings").count(), 0);
	assert.equal(await page.locator(".chat-header button[aria-label^='主题']").count(), 0);
	await page.getByRole("button", { name: "设置", exact: true }).click();
	await wait(() => document.activeElement?.textContent === "外观");
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(".settings-trigger").evaluate((el) => el === document.activeElement), true);
	await page.getByRole("button", { name: "设置", exact: true }).click();
	await open();
	assert.equal(await page.locator(".settings-menu").count(), 0, "Shortcut must dismiss the underlying menu");
	await page.keyboard.press("Escape");
	assert.equal(await dialog().count(), 0, "One Escape closes settings after menu handoff");

	const input = page.getByRole("textbox", { name: "聊天消息" });
	await input.fill("切换主题后保留的草稿");
	const before = await page.evaluate(() => ({ ids: [...window.skiffPreview.processes.keys()], workspace: localStorage.getItem("skiff.workspace.v1") }));
	await open();
	await checkLayout();
	await shot("light-default");
	await button("系统提示词").click();
	assert.equal(await dialog().getByRole("textbox", { name: "附加指令" }).count(), 1, "Settings must host the prompt editor");
	assert.equal(await dialog().getByRole("button", { name: "保存并重启" }).count(), 1);
	await checkLayout();
	await shot("prompt");
	await button("外观").click();
	await button("深色").click();
	assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.theme")), "dark");
	await shot("dark-default");
	await button("跟随系统").click();
	await page.emulateMedia({ colorScheme: "light" });
	await wait(() => document.documentElement.dataset.theme === "light");
	await page.emulateMedia({ colorScheme: "dark" });
	await wait(() => document.documentElement.dataset.theme === "dark");
	await button("浅色").click();
	for (const key of ["Control+Comma", "Control+n", "Control+k", "Control+Shift+Backspace"]) await page.keyboard.press(key);
	assert.equal(await page.locator("dialog[open]").count(), 1);
	assert.equal(await dialog().evaluate((el) => el.contains(document.activeElement)), true);
	for (let index = 0; index < 20; index++) {
		await page.keyboard.press(index % 3 === 0 ? "Shift+Tab" : "Tab");
		assert.equal(await dialog().evaluate((el) => el.contains(document.activeElement)), true, "Focus must stay in settings");
	}
	assert.equal(await input.inputValue(), "切换主题后保留的草稿");
	assert.deepEqual(await page.evaluate(() => [...window.skiffPreview.processes.keys()]), before.ids);
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.workspace.v1")), before.workspace);

	await button("供应商").click();
	await button("编辑 官方直连").click();
	assert.equal(await button("编辑 官方直连 的路线").count(), 0, "Providers page must not list routes");
	assert.equal(await button("外观").isDisabled(), true);
	await wait(() => document.activeElement?.id === "relay-name");
	assert.equal(await page.locator(".provider-model-editor-row").count(), 3, "Provider editor must list its configured models");
	// Every model row can be tested on its own against this relay.
	const firstRow = page.locator(".provider-model-editor-row").first();
	await firstRow.getByRole("button", { name: "测试", exact: true }).click();
	await firstRow.locator(".test-result.ok").waitFor();
	await shot("provider-editor");
	await button("获取模型列表").click();
	await page.locator(".provider-model-list-notice").waitFor();
	const discoveredCount = await page.locator(".provider-model-editor-row").count();
	assert.ok(discoveredCount > 3, "Model discovery must add supported models to the provider list");
	await button("添加模型").click();
	assert.equal(await page.locator(".provider-model-editor-row").count(), discoveredCount + 1);
	await page.getByRole("button", { name: `删除模型 ${discoveredCount + 1}`, exact: true }).click();
	assert.equal(await page.locator(".provider-model-editor-row").count(), discoveredCount);
	await page.keyboard.press("Escape");
	assert.equal(await dialog().count(), 1);
	assert.equal(await button("外观").isEnabled(), true);
	assert.equal(await button("编辑 官方直连").evaluate((el) => el === document.activeElement), true, "Return must focus the original provider row");
	await button("编辑 官方直连").click();
	await page.locator('[aria-label="模型 ID 2"]').fill("deepseek-temporary");
	await page.locator('[aria-label="模型 ID 2"]').fill("deepseek-chat");
	await page.locator('[aria-label="模型 2 上下文窗口"]').fill("196000");
	await page.locator('[aria-label="模型 2 显示名"]').fill("编辑器模型名");
	await button("保存").click();
	await page.locator("#relay-name").waitFor({ state: "detached" });
	const savedModel = await page.evaluate(() => {
		const saved = window.skiffPreview.commands.filter((item) => item.command === "save_relay").at(-1);
		return {
			model: saved?.args.routes.find((item) => item.familyId === "deepseek")?.route.models.find((model) => model.modelId === "deepseek-chat"),
			excluded: saved?.args.relay.excludedModelIds ?? [],
		};
	});
	assert.equal(savedModel.model.contextWindow, 196000);
	assert.equal(savedModel.model.alias, "编辑器模型名");
	assert.equal(savedModel.excluded.includes("deepseek-chat"), false, "Restoring a model ID must clear its exclusion");
	await button("路线").click();
	assert.equal(await button("编辑 官方直连").count(), 0, "Route page must not list providers");
	await button("更多 官方直连 的路线操作").first().click();
	await dialog().getByRole("menuitem", { name: "编辑 官方直连 的路线", exact: true }).click();
	await page.keyboard.press("Escape");
	assert.equal(await dialog().count(), 1);
	await button("供应商").click();
	await button("编辑 官方直连").click();

	// Delayed save, failure and retry use the local mock bridge only.
	await page.evaluate(() => {
		const bridge = window.__TAURI_INTERNALS__;
		const invoke = bridge.invoke;
		bridge.invoke = async (command, args) => {
			if (command === "save_relay" && !window.saveIntercepted) {
				window.saveIntercepted = true;
				return new Promise((_, reject) => { window.rejectSave = () => reject(new Error("模拟保存失败")); });
			}
			return invoke(command, args);
		};
	});
	await button("保存").click();
	await wait(() => !!window.rejectSave);
	assert.equal(await button("关闭设置").isDisabled(), true);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Control+Comma");
	assert.equal(await page.locator("#relay-name").count(), 1);
	assert.equal(await dialog().isVisible(), true, "Pending Escape must keep the native dialog open");
	await page.evaluate(() => window.rejectSave());
	await dialog().getByRole("alert").filter({ hasText: "保存失败" }).waitFor();
	assert.equal(await button("关闭设置").isEnabled(), true);
	await button("保存").click();
	await page.locator("#relay-name").waitFor({ state: "detached" });
	await button("供应商").click();
	await button("编辑 官方直连").waitFor();
	await button("编辑 官方直连").click();
	await button("删除").click();
	await page.getByRole("dialog", { name: "删除供应商", exact: true }).waitFor();
	await page.keyboard.press("Escape");
	assert.equal(await page.locator("#relay-name").count(), 1, "Confirmation Escape must not leave editor");
	await button("取消").click();

	// Late test completions must not overwrite another editor.
	await button("编辑 官方直连").click();
	await page.evaluate(() => {
		const bridge = window.__TAURI_INTERNALS__;
		const invoke = bridge.invoke;
		window.lateTests = [];
		bridge.invoke = (command, args) => {
			if (command === "discover_relay_models") return Promise.resolve([{ id: "deepseek-chat" }]);
			if (command === "test_provider_connection") return new Promise((resolve) => window.lateTests.push(resolve));
			return invoke(command, args);
		};
	});
	await button("测试连接").click();
	await wait(() => window.lateTests.length > 0);
	await page.keyboard.press("Escape");
	await button("编辑 硅基低价").click();
	await page.evaluate(() => window.lateTests.forEach((resolve) => resolve({ ok: true, latencyMs: 1, status: 200, error: null })));
	assert.equal(await page.locator("#relay-name").inputValue(), "硅基低价");
	assert.equal(await dialog().locator(".connection-model").count(), 0);
	assert.ok(await page.evaluate(() => window.skiffPreview.commands.some((item) => item.command === "cancel_provider_test")));
	await page.keyboard.press("Escape");
	await button("归档会话").click();
	await shot("archives");
	await dialog().getByRole("button", { name: "查看", exact: true }).first().click();
	await page.getByRole("dialog", { name: /^归档预览/ }).waitFor();
	await page.keyboard.press("Escape");
	assert.equal(await dialog().count(), 1);
	await button("删除归档 已归档会话").click();
	await page.keyboard.press("Escape");
	assert.equal(await dialog().count(), 1);
	await close();
	await page.locator(".settings-trigger").click();
	await page.getByRole("button", { name: "归档会话", exact: true }).click();
	await page.setViewportSize({ width: 600, height: 400 });
	await wait(() => !document.querySelector(".settings-trigger"));
	assert.equal(await page.locator("dialog[open]").count(), 1, "Resize must not open a drawer above settings");
	await close();
	assert.equal(await page.locator(".header-settings").evaluate((el) => el === document.activeElement), true);
	await page.setViewportSize({ width: 1100, height: 750 });
	await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
	await page.keyboard.press("Control+k");
	assert.equal(await input.evaluate((el) => el === document.activeElement), true);
	await input.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, isComposing: true, bubbles: true })));
	assert.equal(await dialog().count(), 0);

	await page.getByRole("button", { name: "选择模型", exact: true }).click();
	await page.getByRole("button", { name: /管理提供商/ }).click();
	await button("编辑 官方直连").waitFor();
	assert.equal(await page.locator("dialog[open]").count(), 1);
	await close();
	await page.goto(`${origin}/tests/preview.html?fixture=empty&theme=light`); await ready();
	await page.getByRole("button", { name: "管理提供商", exact: true }).click();
	await button("编辑 官方直连").waitFor();
	await close();
	await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
	await page.locator(".header-settings").click();
	await button("跟随系统").waitFor();
	await close();
	assert.equal(await page.locator(".header-settings").evaluate((el) => el === document.activeElement), true);

	// Minimum window and the layout equivalent of 200% at 1100x750.
	for (const [width, height, name] of [[600, 400, "minimum"], [550, 375, "zoom-200-layout"]]) {
		await page.setViewportSize({ width, height });
		await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
		await page.locator(".settings-trigger").click();
		await page.getByRole("button", { name: "外观", exact: true }).click();
		assert.equal(await page.locator("dialog[open]").count(), 1, "Drawer must yield before settings");
		for (const theme of ["浅色", "深色"]) {
			await button(theme).click(); await checkLayout(); await shot(`${theme === "浅色" ? "light" : "dark"}-${name}`);
		}
		await button("供应商").click();
		await button("编辑 官方直连").click();
		await button("保存").scrollIntoViewIfNeeded();
		const saveRect = await button("保存").boundingBox();
		assert.ok(saveRect.y >= 0 && saveRect.y + saveRect.height <= height, "Save must remain reachable");
		await checkLayout(); await shot(`editor-${name}`);
		await page.keyboard.press("Escape");
		await button("快捷键").click(); await checkLayout();
		await close();
		assert.equal(await page.locator(".header-settings").evaluate((el) => el === document.activeElement), true, "Narrow return target must be visible header settings");
	}

	// Active generation allows appearance/help while protecting configuration.
	await page.setViewportSize({ width: 1100, height: 750 });
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`); await ready();
	await input.fill("运行中设置验证"); await input.press("Enter");
	await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
	await page.evaluate(() => { for (const process of window.skiffPreview.processes.values()) clearTimeout(process.timer); });
	await page.locator(".settings-trigger").click();
	const menuProvider = page.locator(".settings-menu").getByRole("button", { name: "供应商", exact: true });
	assert.equal(await menuProvider.isDisabled(), true);
	await assertNoDisabledFrame(menuProvider);
	await page.keyboard.press("Escape");
	await open();
	assert.equal(await button("供应商").isDisabled(), true);
	assert.equal(await button("路线").isDisabled(), true);
	assert.equal(await button("系统提示词").isDisabled(), true);
	await assertNoDisabledFrame(button("供应商"));
	await button("深色").click();
	await assertNoDisabledFrame(button("供应商"));
	await button("快捷键").click();
	await page.keyboard.press("Control+Shift+Backspace");
	await close();
	assert.equal(await page.getByRole("button", { name: "停止生成", exact: true }).isVisible(), true);
	// A waits for confirmation in background, B opens settings without replying for A.
	const backgroundId = await page.evaluate(() => [...window.skiffPreview.processes.keys()][0]);
	await page.locator(".project-chats .chat-link[title^='同项目候选']").click({ position: { x: 20, y: 16 } });
	await ready();
	await open();
	await page.evaluate((id) => window.skiffPreview.emit(id, { type: "extension_ui_request", id: "settings-background", method: "confirm", title: "后台设置验证", message: "确认后台任务" }), backgroundId);
	await page.getByRole("status", { name: "需要确认", exact: true }).first().waitFor();
	assert.equal(await button("供应商").isEnabled(), true);
	assert.equal(await button("路线").isEnabled(), true);
	await close();
	assert.equal(await page.evaluate((id) => window.skiffPreview.processes.get(id)?.isStreaming, backgroundId), true);
	assert.equal(await page.evaluate(() => window.skiffPreview.commands.some((item) => item.command === "rpc_send" && JSON.parse(item.args.message).type === "extension_ui_response")), false);
	await page.locator(".project-chats .chat-link[title^='当前会话']").click({ position: { x: 20, y: 16 } });
	await page.getByRole("dialog", { name: "后台设置验证", exact: true }).waitFor();
	await page.keyboard.press("Control+Comma");
	assert.equal(await dialog().count(), 0, "Settings must not preempt a business modal");
	await page.keyboard.press("Escape");

	await page.getByRole("dialog", { name: "后台设置验证", exact: true }).waitFor({ state: "detached" });
	// Reload resolves the stored theme before React, using the same startup script.
	await open(); await button("深色").click(); await close();
	await page.evaluate(() => history.replaceState(null, "", "/tests/preview.html?fixture=archive&persist=1"));
	await page.reload(); await ready();
	assert.equal(await page.locator("html").getAttribute("data-theme-preference"), "dark");
	await open(); assert.equal(await button("深色").getAttribute("aria-pressed"), "true"); await close();
	// Configuration errors keep appearance/help available and expose recovery.
	await page.goto(`${origin}/tests/preview.html?fixture=error&theme=light`); await ready();
	await page.getByRole("button", { name: "管理提供商", exact: true }).click();
	await dialog().getByRole("alert").filter({ hasText: "模型目录暂时不可用" }).waitFor();
	assert.equal(await button("重新读取配置").isEnabled(), true);
	await button("外观").click(); await button("快捷键").click(); await close();
	assert.deepEqual(errors, []);
	await fs.writeFile(new URL("../browser-verification.json", output), JSON.stringify({
		browser: browser.version(), environment: await page.evaluate(() => ({ platform: navigator.platform, userAgent: navigator.userAgent, devicePixelRatio })),
		mode: "Vite development; headless Edge; simulated pi/Tauri only",
		viewports: ["1100x750", "600x400", "550x375 (layout equivalent of 200% at 1100x750; not native WebView zoom)"],
		checks: ["all entries share one settings dialog", "system/light/dark, reload persistence, live system changes, preserved draft and process IDs", "keyboard isolation, IME, Tab cycle, popup handoff", "editor return focus, pending Escape, failure/retry", "nested confirmations and late test cancellation", "archive preview, drawer handoff, resize fallback", "running session and background authorization isolation", "configuration error and recovery access"],
		errors,
	}, null, 2) + "\n");
	console.log("PASS settings entries, themes/system changes, modal shortcuts/focus, edit/Escape, save protection/failure/retry, late test cancellation, archive dialogs, minimum/zoom layout, running/background confirmation isolation");
} catch (error) {
	await shot("failure");
	console.error(errors);
	throw error;
} finally { await browser.close(); }
