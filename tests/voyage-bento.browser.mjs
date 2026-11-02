// Simulated bridge and controlled clock; never contacts pi or a provider.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1424";
const screenshots = new URL(process.argv[3] ?? "../features/014-voyage-panel-polish/screenshots/bento/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const user = { id: "user", role: "user", blocks: [{ kind: "text", text: "检查仪表盘" }], timestamp: 1000 };
const usage = (input, cacheRead = 0, cacheWrite = 0, output = 0) => ({ input, cacheRead, cacheWrite, output, reasoning: 0, totalTokens: 999999 });
const render = async (state) => { await page.evaluate((state) => window.voyageHarness.render(state), state); await page.waitForTimeout(60); };
const advance = async (ms) => { await page.evaluate((ms) => window.voyageHarness.advance(ms), ms); await page.waitForTimeout(40); };
const capture = (name) => page.screenshot({ path: fileURLToPath(new URL(name, screenshots)), fullPage: true, animations: "disabled" });
const mood = () => page.locator(".voyage-mood").getAttribute("data-pose");
const state = { sessionId: "bento", messages: [user, { id: "reply", role: "assistant", streaming: true, blocks: [{ kind: "text", text: "开始" }] }], isStreaming: true,
	activeRun: { startedAt: 1000, promptId: "bento", turnId: "turn:user" }, model: { id: "mock", provider: "mock", contextWindow: 1000 } };

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	// Banner: badge, title, run status pill, and a mood ribbon on its own line.
	await render({ messages: [], isStreaming: false, model: state.model });
	assert.equal(await page.locator(".voyage-badge").count(), 1);
	assert.equal(await page.locator(".voyage-dashboard-header h1").textContent(), "Skiff 航行台");
	assert.equal(await page.locator(".voyage-status-pill").textContent(), "空闲");
	assert.equal(await page.locator(".voyage-mood-text").textContent(), "待机 · 顺风巡航");
	assert.equal(await mood(), "idle");
	// The mood keeps its own line, so the title and status pill still share a centre.
	assert(await page.locator(".voyage-dashboard-header").evaluate((element) => {
		const title = element.querySelector("h1").getBoundingClientRect();
		const pill = element.querySelector(".voyage-pill").getBoundingClientRect();
		return Math.abs(title.y + title.height / 2 - pill.y - pill.height / 2) < 1;
	}));
	assert.equal(await page.locator(".voyage-dial-value").first().textContent(), "—");
	assert.equal(await page.locator(".voyage-dial-quiet").count(), 2);

	// Bento plate: a frosted tray of white blocks beside the compact gauge card.
	assert.equal(await page.locator(".voyage-card-vitals .voyage-dial").count(), 2);
	assert.equal(await page.locator(".voyage-card-dial").count(), 1);
	assert.equal(await page.locator(".voyage-spark").count(), 1);
	assert((await page.locator(".voyage-gauge-fill").evaluate((element) => getComputedStyle(element).stroke)).includes("voyage-speed-gradient"));
	for (const name of ["context", "cache"]) {
		assert.equal(await page.locator(`.voyage-dial-${name} .voyage-dial-meter i`).count(), 1);
		assert.equal(await page.locator(`.voyage-dial-${name} .voyage-dial-meter i`).evaluate((element) => element.style.width), "0%");
	}
	await capture("light-1200-empty.png");

	// A leading reply fills the sparkline; a stopped turn freezes it.
	await render(state); await advance(100);
	for (let step = 0; step < 8; step++) {
		state.messages[1].blocks[0].text += "并刷新航行仪表";
		await render(state); await advance(100);
	}
	const points = await page.locator(".voyage-spark-line").getAttribute("points");
	assert(points.split(" ").length >= 5, `sparkline did not grow: ${points}`);
	assert.equal(await page.locator(".voyage-companion-art").count(), 1);
	state.messages[1].streaming = false;
	state.messages[1].usage = usage(100, 400, 0, 400);
	state.isStreaming = false; delete state.activeRun;
	await render(state); await advance(10000);
	const frozen = await page.locator(".voyage-spark-line").getAttribute("points");
	assert.equal(frozen.split(" ").length, points.split(" ").length);

	// Context 60% fills three fifths of the meter, drives the mood ribbon meta and a
	// warm cache hands the stage back happy.
	state.messages = [user, { id: "reply", role: "assistant", streaming: false, blocks: [{ kind: "text", text: "完成" }], usage: usage(100, 450, 0, 50) }];
	await render(state);
	assert.equal((await page.evaluate(() => window.voyageHarness.metrics)).ratio, .6);
	assert.equal(await page.locator(".voyage-dial-context .voyage-dial-meter i").evaluate((element) => element.style.width), "60%");
	assert.equal(await page.locator(".voyage-mood-meta").textContent(), "60% 上下文");
	assert.equal(await mood(), "happy");

	// The failed tool capsule keeps its round icon and capsule border.
	state.messages = [user, { id: "tools", role: "assistant", streaming: true, blocks: [
		{ kind: "tool", id: "ok", name: "read", argsText: "", done: true },
		{ kind: "tool", id: "bad", name: "inspect_repository_and_permissions", argsText: "D:/workspace/Skiff/", done: true },
	] }];
	state.isStreaming = true; state.activeRun = { startedAt: 9000, promptId: "tools", turnId: "turn:user" };
	await render(state); await advance(100);
	state.messages[1].blocks = [
		{ kind: "tool", id: "ok", name: "read", argsText: "", done: true },
		{ kind: "toolResult", id: "ok", name: "read", text: "完成", isError: false },
		{ kind: "tool", id: "bad", name: "inspect_repository_and_permissions", argsText: "D:/workspace/Skiff/", done: true },
		{ kind: "toolResult", id: "bad", name: "inspect_repository_and_permissions", text: "权限不足", isError: true },
	];
	state.messages[1].streaming = false;
	state.isStreaming = false; delete state.activeRun;
	await render(state);
	await page.locator(".voyage-tool-log summary").click();
	const rows = page.locator(".voyage-tool-log .voyage-tool-row");
	assert.equal(await rows.count(), 2);
	const shapes = await rows.evaluateAll((elements) => elements.map((element) => ({
		radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
		height: element.getBoundingClientRect().height,
		icon: element.querySelector(".voyage-tool-icon").getBoundingClientRect(),
		iconRadius: parseFloat(getComputedStyle(element.querySelector(".voyage-tool-icon")).borderTopLeftRadius),
	})));
	for (const shape of shapes) {
		// radius-full rounds harder than the box, so both corners become a stadium.
		assert(shape.radius > shape.height, JSON.stringify(shape));
		assert.equal(Math.round(shape.icon.width), 20);
		assert.equal(Math.round(shape.icon.height), 20);
		assert(shape.iconRadius > shape.icon.height, JSON.stringify(shape));
	}
	assert.equal(await mood(), "angry");
	assert.equal(await page.locator(".voyage-mood-text").textContent(), "生气 · 急需补给");

	// Both themes and the narrow width keep the plate and capsules inside the rail.
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		for (const [width, height] of [[1200, 900], [360, 780]]) {
			await page.setViewportSize({ width, height }); await page.waitForTimeout(80);
			assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			for (const selector of [".voyage-card-dial", ".voyage-dial-context", ".voyage-dial-cache", ".voyage-mood", ".voyage-tool-row"]) {
				assert(await page.locator(selector).evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${theme} ${width} ${selector}`);
			}
			await page.locator(".voyage-instruments").scrollIntoViewIfNeeded();
			await capture(`${theme}-${width}-plate.png`);
		}
	}
	await page.setViewportSize({ width: 1200, height: 900 });
	await page.waitForTimeout(80);
	assert.deepEqual(errors, []);
	console.log("PASS bento: banner badge/mood pill, gradient gauge card, sparkline growth+freeze, 12-cell batteries, capsule tool rows, 2 themes x 2 widths; 5 screenshots");
	console.log(`Browser: ${browser.version()}`);
} catch (error) {
	await capture("failure.png");
	throw error;
} finally { await browser.close(); }
