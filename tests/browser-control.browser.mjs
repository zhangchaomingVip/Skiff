import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(join(process.cwd(), ".playwright-cli/node_modules/playwright-core"));
const origin = process.argv[2] ?? "http://localhost:1421";
const output = join(process.cwd(), "dist/browser-control"); await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
		await page.goto(`${origin}/tests/preview.html?fixture=browser&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => { window.skiffPreview.browser.setEnabled(true); window.skiffPreview.browser.set("browser-a"); window.releaseControl = window.skiffPreview.browser.deferControl(); });
		const screen = page.locator(".browser-screen");
		const canvas = page.locator(".browser-screen canvas");
		await page.locator('.browser-screen[data-phase="live"]').waitFor();
		const input = page.getByRole("textbox", { name: "浏览器键盘输入", exact: true });
		assert.equal(await page.getByRole("button", { name: "刷新网页", exact: true }).isDisabled(), false, "A human gesture may interrupt the AI through navigation");
		// The panel re-requests its page viewport after layout; take the first gesture only
		// once the captured bitmap has stopped changing shape so the replay maps that picture.
		await page.waitForTimeout(700);
		let lastSize = "";
		for (let attempt = 0; attempt < 8; attempt += 1) {
			const size = await canvas.evaluate((element) => `${element.width}x${element.height}`);
			if (size === lastSize) break;
			lastSize = size;
			await page.waitForTimeout(120);
		}
		// The old third row is gone: a click on the canvas is the takeover.
		assert.equal(await page.locator(".browser-actions").count(), 0);
		await page.evaluate(() => window.skiffPreview.browser.failControl("模拟控制权确认失败"));
		const pagePoint = async (x, y) => {
			const box = await canvas.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, imageWidth: element.width, imageHeight: element.height };
			});
			// Inverse of browserPoint: the picture is contained in the canvas box at its own
			// density, so page CSS pixels map through the displayed bitmap, not the box aspect.
			const scale = Math.min(box.width / box.imageWidth, box.height / box.imageHeight);
			return { x: box.left + (box.width - box.imageWidth * scale) / 2 + x * 2 * scale, y: box.top + (box.height - box.imageHeight * scale) / 2 + y * 2 * scale };
		};
		const firstClick = await pagePoint(200, 320);
		await page.mouse.click(firstClick.x, firstClick.y);
		await page.getByRole("alert").filter({ hasText: "模拟控制权确认失败" }).waitFor();
		assert.equal(await input.count(), 0, "Failed takeover cannot claim human control");
		await page.mouse.click(firstClick.x, firstClick.y);
		await page.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").control === "takingOver");
		assert.equal(await input.count(), 0, "No input until native drain confirms");
		assert.equal(await page.locator(".browser-takeover").count(), 0, "The takeover layer pauses while the request is in flight");
		await page.evaluate(() => window.releaseControl());
		await input.waitFor();
		// The gesture that interrupted the AI is replayed into the page instead of being lost.
		await page.waitForFunction(() => window.skiffPreview.browser.sent.some((message) => message.type === "input_mouse" && message.eventType === "mousePressed"));
		assert.equal(await input.evaluate((element) => getComputedStyle(element).cursor), "default", "The page keeps a normal cursor instead of a text caret");
		await page.waitForTimeout(500);
		const start = await pagePoint(300, 340);
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		for (let step = 1; step <= 4; step += 1) {
			const point = await pagePoint(300 + step * 20, 340);
			await page.mouse.move(point.x, point.y);
			await page.waitForTimeout(60);
		}
		await page.mouse.up();
		const reloads = await page.evaluate(() => window.skiffPreview.browser.sent.filter((message) => message.type === "reload").length);
		await page.getByRole("button", { name: "刷新网页", exact: true }).click();
		await page.waitForFunction((count) => window.skiffPreview.browser.sent.filter((message) => message.type === "reload").length > count, reloads);
		const click = await pagePoint(220, 320);
		await page.mouse.click(click.x, click.y);
		await page.mouse.wheel(0, 180);
		await page.keyboard.type("hello");
		await input.evaluate((element) => {
			element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
			element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文输入" }));
			const data = new DataTransfer(); data.setData("text/plain", "粘贴文本");
			element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
		});
		await page.keyboard.down("Shift");
		await page.getByRole("button", { name: "交还 AI", exact: true }).focus();
		const messages = await page.evaluate(() => window.skiffPreview.browser.sent.filter((message) => message.type.startsWith("input_")));
		const presses = messages.filter((message) => message.eventType === "mousePressed");
		// The first gesture races the panel's initial viewport settle, so allow the picture
		// geometry a small tolerance; later drag coordinates below are exact.
		assert.ok(presses.some((message) => Math.abs(message.x - 200) < 8 && Math.abs(message.y - 320) < 32), `Coordinates remove contain padding: ${JSON.stringify(presses)}`);
		const drags = messages.filter((message) => message.eventType === "mouseMoved" && message.buttons === 1);
		assert.ok(drags.length >= 2, "A dragged slider keeps receiving move events with the held button");
		assert.ok(drags.every((message) => message.button === "none"), "Drag moves never claim a fresh button press");
		const dragPath = drags.map((message) => message.x);
		assert.ok(drags.every((message) => message.x >= 298 && message.x <= 382), `Drag moves follow the cursor: ${dragPath.join(",")}`);
		assert.ok(drags.at(-1).x > 340, "The newest drag position is never dropped");
		assert.ok(messages.some((message) => message.eventType === "char" && message.text === "中文输入"));
		assert.ok(messages.some((message) => message.eventType === "char" && message.text === "粘贴文本"));
		assert.ok(messages.some((message) => message.eventType === "mouseWheel" && message.deltaY === 180));
		assert.ok(messages.some((message) => message.eventType === "keyUp" && message.key === "Shift"), "Blur releases held key");
		await page.keyboard.up("Shift");
		await page.screenshot({ path: join(output, `${theme}-human.png`), animations: "disabled" });

		// Handing the page back flushes held input, and the AI continues with a fresh snapshot.
		await page.getByRole("button", { name: "交还 AI", exact: true }).click();
		await page.getByRole("button", { name: "继续浏览任务", exact: true }).waitFor();
		assert.equal(await input.count(), 0);
		assert.ok(await page.evaluate(() => window.skiffPreview.browser.sent.some((message) => message.type === "input_flush")));
		const before = await page.evaluate(() => window.skiffPreview.commands.filter((call) => call.command === "rpc_send" && JSON.parse(call.args.message).type === "prompt").length);
		await page.getByRole("button", { name: "继续浏览任务", exact: true }).click();
		await page.waitForFunction((before) => window.skiffPreview.commands.filter((call) => call.command === "rpc_send" && JSON.parse(call.args.message).type === "prompt").length > before, before);
		const prompt = await page.evaluate(() => window.skiffPreview.commands.filter((call) => call.command === "rpc_send" && JSON.parse(call.args.message).type === "prompt").at(-1));
		assert.match(JSON.parse(prompt.args.message).message, /第一步必须调用 browser snapshot/);
		await page.waitForTimeout(150);

		// Navigation is a takeover gesture: clicking back while the AI owns the page interrupts it.
		await page.evaluate(() => window.skiffPreview.browser.set("browser-a", { canGoBack: true, canGoForward: false }));
		const back = page.getByRole("button", { name: "后退", exact: true });
		const forward = page.getByRole("button", { name: "前进", exact: true });
		assert.equal(await back.isDisabled(), false);
		assert.equal(await forward.isDisabled(), true);
		await back.click();
		await page.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").control === "human");
		await page.waitForFunction(() => window.skiffPreview.browser.sent.some((message) => message.type === "history"));
		await input.waitFor();
		assert.equal(await forward.isDisabled(), false, "History state drives the forward button");
		const histories = await page.evaluate(() => window.skiffPreview.browser.sent.filter((message) => message.type === "history").length);
		await forward.click();
		await page.waitForFunction((count) => window.skiffPreview.browser.sent.filter((message) => message.type === "history").length > count, histories);
		await page.locator(".browser-address-display").click();
		await page.locator(".browser-address-input").waitFor();
		assert.match(await page.locator(".browser-address-input").inputValue(), /^https:\/\/example\.test/);
		await page.locator(".browser-address-input").fill("example.test/typed");
		await page.locator(".browser-address-input").press("Enter");
		await page.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").url === "https://example.test/typed");
		assert.ok(await page.evaluate(() => window.skiffPreview.browser.sent.some((message) => message.type === "navigate" && message.url === "https://example.test/typed")));
		await page.locator(".browser-address-display").click();
		await page.locator(".browser-address-input").waitFor();
		await page.locator(".browser-address-input").press("Escape");
		assert.equal(await page.locator(".browser-address-input").count(), 0, "Escape cancels address editing");
		assert.equal(await page.locator(".browser-panel").count(), 1, "Escape in the address bar never collapses the panel");

		// Low-frequency controls moved into the ••• menu.
		await page.getByRole("button", { name: "更多浏览器操作", exact: true }).click();
		await page.getByRole("menu", { name: "浏览器菜单", exact: true }).waitFor();
		assert.equal(await page.getByRole("menuitem", { name: "交还 AI 继续任务", exact: true }).count(), 1);
		await page.getByRole("button", { name: "缩小网页", exact: true }).click();
		assert.equal(await page.locator(".browser-zoom-value").textContent(), "90%");
		await page.keyboard.press("Escape");
		assert.equal(await page.locator(".browser-panel").count(), 1, "Closing the menu with Escape keeps the panel");

		// Tabs: while the AI still owns the page, + also interrupts before creating the tab.
		const tabs = page.locator(".browser-tab");
		assert.equal(await tabs.count(), 1);
		await page.evaluate(() => window.skiffPreview.browser.set("browser-a", { control: "ai", controlVersion: 9 }));
		await page.getByRole("button", { name: "新建标签页", exact: true }).click();
		await page.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").tabs.length === 2);
		await page.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").control === "human");
		assert.equal(await tabs.count(), 2);
		assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("browser-address-input")), true, "A new tab focuses the address bar");
		await page.locator(".browser-address-input").fill("https://example.test/second");
		await page.locator(".browser-address-input").press("Enter");
		await page.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").tabs.length === 2 && window.skiffPreview.browser.entries.get("browser-a").url === "https://example.test/second");
		const first = page.getByRole("tab", { name: "示例页面", exact: true });
		await first.click();
		await page.waitForFunction(() => window.skiffPreview.browser.calls.some((call) => call.command === "browser_tab" && call.args.action.type === "select"));
		assert.equal(await page.locator(".browser-tab.is-active").getAttribute("aria-label"), "示例页面");
		await page.locator(".browser-tab.is-active .browser-tab-close").click();
		await page.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").tabs.length === 1);
		assert.equal(await tabs.count(), 1);

		// The last tab is the browser instance: closing it goes through browser_close.
		const closesBefore = await page.evaluate(() => window.skiffPreview.browser.calls.filter((call) => call.command === "browser_close").length);
		await page.locator(".browser-tab.is-active .browser-tab-close").click();
		await page.getByText("浏览器已关闭", { exact: true }).waitFor();
		assert.equal(await page.evaluate(() => window.skiffPreview.browser.calls.filter((call) => call.command === "browser_close").length), closesBefore + 1);
		assert.equal(await input.count(), 0, "Closing the last tab ends human input");

		// A replacement instance still offers the total close entry from the menu.
		await page.evaluate(() => window.skiffPreview.browser.set("browser-a", { generation: "replacement-ui", control: "ai", controlVersion: 1 }));
		await page.locator('.browser-screen[data-phase="live"]').waitFor();
		await page.getByRole("button", { name: "更多浏览器操作", exact: true }).click();
		await page.getByRole("menuitem", { name: "关闭浏览器", exact: true }).click();
		await page.getByText("浏览器已关闭", { exact: true }).waitFor();
		assert.equal(await page.evaluate(() => window.skiffPreview.browser.calls.filter((call) => call.command === "browser_close").length), closesBefore + 2);

		// Widening then narrowing keeps the two-layer header intact.
		await page.evaluate(() => window.skiffPreview.browser.set("browser-a", { generation: "replacement-narrow", url: "https://example.test/typed", control: "human", controlVersion: 3 }));
		await page.setViewportSize({ width: 600, height: 400 });
		await page.getByRole("button", { name: "返回聊天", exact: true }).waitFor();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.screenshot({ path: join(output, `${theme}-narrow.png`), animations: "disabled" });
		await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		assert.equal(await page.evaluate(() => window.skiffPreview.browser.entries.get("browser-a").control), "human", "Collapse preserves ownership");
		await page.getByRole("button", { name: "浏览器", exact: true }).click();
		await page.locator('.browser-screen[data-phase="live"]').waitFor();
		assert.deepEqual(errors, []);
		await page.close();
	}
	console.log("PASS browser control: auto takeover on canvas/nav/tabs, gesture replay, coordinates, drag, reload, navigation/address, tabs, return/continue, menu, last-tab close and themes/narrow");

	// A chat with no browser is still a browser surface: the user can open it first,
	// type an address, and only hand the current page to the AI when they choose to.
	const manualPage = await browser.newPage({ viewport: { width: 1200, height: 820 } });
	const manualErrors = []; manualPage.on("pageerror", (error) => manualErrors.push(String(error)));
	await manualPage.goto(`${origin}/tests/preview.html?fixture=browser&theme=light`);
	await manualPage.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	await manualPage.evaluate(() => window.skiffPreview.browser.setEnabled(true));
	await manualPage.getByRole("button", { name: "浏览器", exact: true }).click();
	await manualPage.getByText("打开浏览器开始浏览", { exact: true }).waitFor();
	await manualPage.getByRole("button", { name: "打开浏览器", exact: true }).click();
	await manualPage.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a")?.control === "human");
	await manualPage.locator('.browser-screen[data-phase="live"]').waitFor();
	assert.equal(await manualPage.locator(".browser-address-input").count(), 1, "Manual start focuses the address bar");
	const firstGeneration = await manualPage.evaluate(() => window.skiffPreview.browser.entries.get("browser-a").generation);
	await manualPage.locator(".browser-address-input").pressSequentially("example.test/manual");
	assert.equal(await manualPage.locator(".browser-address-input").inputValue(), "example.test/manual", "Typing keeps every character instead of reselecting the address");
	await manualPage.locator(".browser-address-input").press("Enter");
	await manualPage.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").url === "https://example.test/manual");
	await manualPage.locator(".browser-address-display").waitFor();
	assert.equal(await manualPage.locator(".browser-address-display").textContent(), "example.test");
	await manualPage.getByRole("button", { name: "更多浏览器操作", exact: true }).click();
	await manualPage.getByRole("menuitem", { name: "让 AI 读取当前页", exact: true }).click();
	await manualPage.waitForFunction(() => window.skiffPreview.browser.entries.get("browser-a").control === "ai" && window.skiffPreview.browser.entries.get("browser-a").requiresSnapshot === true);
	const prompts = await manualPage.evaluate(() => window.skiffPreview.commands.filter((call) => call.command === "rpc_send" && JSON.parse(call.args.message).type === "prompt").map((call) => JSON.parse(call.args.message).message));
	assert.ok(prompts.at(-1).includes("browser snapshot") && prompts.at(-1).includes("不要使用 open"), "The AI is told to read this page, not open another");
	assert.equal(await manualPage.locator(".browser-address-input").count(), 0, "Handing to AI leaves address display mode");
	// A faulted instance is recoverable by the same user-facing action, without asking AI to open.
	await manualPage.evaluate(() => window.skiffPreview.browser.set("browser-a", { control: "faulted", error: "无法确认浏览器输入已送达", controlVersion: 20 }));
	await manualPage.getByText("浏览器故障", { exact: true }).first().waitFor();
	await manualPage.getByRole("button", { name: "重新打开浏览器", exact: true }).click();
	await manualPage.waitForFunction((generation) => {
		const entry = window.skiffPreview.browser.entries.get("browser-a");
		return entry.control === "human" && entry.generation !== generation;
	}, firstGeneration);
	await manualPage.locator('.browser-screen[data-phase="live"]').waitFor();
	assert.equal(await manualPage.evaluate(() => window.skiffPreview.browser.calls.filter((call) => call.command === "browser_start" && call.args.manual === true).length), 2);
	assert.deepEqual(manualErrors, []);
	await manualPage.close();
	console.log("PASS browser manual: user-first start, address navigation, AI reads current page, fault recovery");
} finally { await browser.close(); }
