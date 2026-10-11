// NODE_PATH may point at the bundled Playwright package directory.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1423";
const screenshots = new URL(process.argv[3] ?? "../features/012-voyage-experience/screenshots/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const usage = (output, input = 0) => ({ input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output });
const user = { id: "user", role: "user", blocks: [], timestamp: 1000 };
const reply = (text, extra = {}) => ({ id: "reply", role: "assistant", blocks: [{ kind: "text", text }], streaming: true, ...extra });
let state = { messages: [user, reply("旧轮", { streaming: false, usage: usage(99), durationMs: 1000 })], isStreaming: false, model: { id: "preview", provider: "mock", contextWindow: 1000 } };
const read = () => page.evaluate(() => window.voyageHarness.metrics);
const render = async () => { await page.evaluate((state) => window.voyageHarness.render(state), state); await page.waitForTimeout(30); };
const advance = async (ms) => { await page.evaluate((ms) => window.voyageHarness.advance(ms), ms); await page.waitForTimeout(30); };
try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	await render();
	assert.equal((await read()).averageSpeed, 99);
	assert.equal((await read()).peakSpeed, undefined);
	state = { ...state, isStreaming: true, activeRun: { startedAt: 1000, promptId: "next", turnId: "turn:next" } };
	await render(); await advance(100);
	assert.equal((await read()).activity, "fishing");
	assert.equal((await read()).averageSpeed, 0);
	assert.equal((await read()).peakSpeed, 0);
	state.messages = [...state.messages, { ...user, id: "next", timestamp: 1100 }, reply("")];
	await render(); await advance(100);
	state.messages[state.messages.length - 1] = reply("思考", { blocks: [{ kind: "thinking", text: "思考" }] }); await render();
	assert.equal((await read()).activity, "fishing");
	assert.equal((await read()).status, "思考中");
	assert((await page.locator(".voyage-pill").textContent()).includes("思考中 · 0s"));
	await advance(100);
	assert.equal((await read()).speed, 0);
	await advance(699); assert.equal((await read()).activity, "fishing");
	await advance(1); assert.equal((await read()).activity, "fishing"); assert.equal((await read()).speed, 0);
	state.messages[state.messages.length - 1] = reply("思考回复"); await render();
	assert.equal((await read()).activity, "sailing");
	const peak = (await read()).peakSpeed;
	state.messages[state.messages.length - 1] = reply("思考回复", { streaming: false, usage: usage(100, 900), durationMs: 1000 });
	state.isStreaming = false; delete state.activeRun; await render();
	assert.equal((await read()).activity, "moored");
	assert.equal((await read()).averageSpeed, 100);
	assert.equal((await read()).averageEstimated, false);
	assert.equal((await read()).peakSpeed, peak);
	assert.equal(await page.evaluate(() => window.voyageHarness.intervalCount()), 0);
	await advance(10000); assert.equal((await read()).averageSpeed, 100);
	assert((await read()).reminder.includes("90.0%"));
	await page.screenshot({ path: new URL("context-with-model-notice.png", screenshots).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true, animations: "disabled" });
	await page.setViewportSize({ width: 600, height: 400 });
	await page.waitForTimeout(60);
	await page.locator('.voyage-dialog [aria-label="收起航行台"]').click();
	await page.screenshot({ path: new URL("context-with-model-notice-narrow.png", screenshots).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true, animations: "disabled" });
	assert(await page.locator(".voyage-context-reminder").first().evaluate((element) => element.scrollWidth <= element.clientWidth));
	await page.setViewportSize({ width: 1200, height: 800 });
	await page.waitForTimeout(60);
	await page.locator('[aria-label="展开航行台"]').click();
	state.model.contextWindow = 900; await render(); assert((await read()).reminder.includes("达到上限"));
	state.model.contextWindow = 800; await render(); assert((await read()).reminder.includes("超出上限"));
	state.model.contextWindow = 2000; await render(); assert.equal((await read()).reminder, undefined);
	state.model.contextWindow = NaN; await render(); assert.equal((await read()).reminder, undefined);
	state.model.contextWindow = 1000;
	state.messages = []; await render(); assert.equal((await read()).peakSpeed, undefined); assert.equal((await read()).averageSpeed, undefined);
	state.messages = [{ ...user, id: "restored" }, reply("历史思考".repeat(100))];
	state.isStreaming = true; state.activeRun = { startedAt: 1000, turnId: "turn:restored" }; await render();
	assert.equal((await read()).activity, "fishing"); assert.equal((await read()).peakSpeed, 0);
	await advance(100); state.messages[state.messages.length - 1] = reply("历史思考".repeat(100) + "新文字"); await render();
	assert.equal((await read()).activity, "sailing");
	state.messages[state.messages.length - 1] = { ...reply("历史思考".repeat(100) + "新文字"), streaming: false, blocks: [{ kind: "thinking", text: "历史思考".repeat(100) + "新文字" }, { kind: "tool", id: "call", name: "read", argsText: "", done: true }] };
	await render(); await advance(800); assert.equal((await read()).status, "工具执行中");
	assert(/工具执行中 · \d+s/.test(await page.locator(".voyage-summary").textContent()));
	await advance(1000);
	state.messages[state.messages.length - 1] = { ...state.messages[state.messages.length - 1], blocks: [
		{ kind: "thinking", text: "历史思考".repeat(100) + "新文字" },
		{ kind: "tool", id: "call", name: "read", argsText: "", done: true },
		{ kind: "toolResult", id: "call", name: "read", text: "done", isError: false },
		{ kind: "tool", id: "next-call", name: "sleep", argsText: "", done: true },
	] };
	await render(); await advance(100);
	assert.equal((await read()).status, "工具执行中");
	assert.equal((await read()).timeline.toolMs, 1900);
	assert.equal((await read()).activeTools[0].durationMs, 100);
	assert.equal(await page.locator(".voyage-tool-active time").count(), 0);
	await advance(1000);
	assert.equal((await read()).timeline.toolMs, 2900);
	assert.equal((await read()).activeTools[0].durationMs, 1100);
	const restoredPeak = (await read()).peakSpeed;
	state.messages[state.messages.length - 1] = { ...state.messages[state.messages.length - 1], blocks: [...state.messages[state.messages.length - 1].blocks, { kind: "toolResult", id: "next-call", name: "sleep", text: "done", isError: false }] };
	state.messages = [...state.messages, reply("新阶段", { id: "step2" })]; await render(); assert.equal((await read()).activity, "sailing");
	assert((await read()).peakSpeed >= restoredPeak);
	state.messages[state.messages.length - 1] = reply("新阶段", { id: "step2", streaming: false, usage: usage(5000), durationMs: 14000 });
	state.isStreaming = false; delete state.activeRun; await render();
	assert.equal((await read()).averageEstimated, true);
	assert.equal((await read()).averageSpeed, 406 * 1000 / 14000);
	state.messages = []; await render();
	for (const end of ["cancel", "failure"]) {
		state.isStreaming = true; state.activeRun = { startedAt: 12000, promptId: end, turnId: `turn:${end}` }; await render(); await advance(100);
		state.isStreaming = false; delete state.activeRun; await render();
		assert.equal((await read()).activity, "moored"); assert.equal(await page.evaluate(() => window.voyageHarness.intervalCount()), 0);
	}
	state.isStreaming = true; state.activeRun = { startedAt: 12200, promptId: "unmount", turnId: "turn:unmount" }; await render();
	await page.evaluate(() => window.voyageHarness.unmount()); assert.equal(await page.evaluate(() => window.voyageHarness.intervalCount()), 0);
	console.log("PASS controlled hook: isolation, low speed, 800ms, usage correction, history, context, cancellation/failure, unmount");
	for (const theme of ["light", "dark"]) for (const [width, height] of [[1200, 800], [900, 700], [600, 400]]) {
		await page.setViewportSize({ width, height });
		await page.goto(`${base}/tests/preview.html?fixture=voyage-high&theme=${theme}`);
		await page.locator(".voyage-summary").waitFor();
		await page.locator(".voyage-context-reminder").first().waitFor();
		assert.equal(await page.locator('.voyage-context-reminder[role="status"]').count(), 1);
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await page.screenshot({ path: new URL(`${theme}-${width}-context.png`, screenshots).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true, animations: "disabled" });
		if (width < 1200) await page.locator(".voyage-summary").click();
		await page.locator(".voyage-rail.expanded .voyage-speed-stats").waitFor();
		await page.waitForTimeout(200);
		assert(await page.locator(".voyage-rail.expanded .voyage-speed-stats").evaluate((element) => element.scrollWidth <= element.clientWidth));
		if (width === 600) {
			assert(await page.locator(".voyage-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth));
			await page.locator(".voyage-dialog .voyage-turn").scrollIntoViewIfNeeded();
			await page.screenshot({ path: new URL(`${theme}-${width}-details.png`, screenshots).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true, animations: "disabled" });
			await page.locator(".voyage-rail-header").scrollIntoViewIfNeeded();
		}
		await page.screenshot({ path: new URL(`${theme}-${width}-expanded.png`, screenshots).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true, animations: "disabled" });
	}
	for (const fixture of ["voyage-fishing", "voyage-tool", "voyage-thinking", "voyage-output"]) {
		await page.setViewportSize({ width: 1200, height: 800 });
		await page.goto(`${base}/tests/preview.html?fixture=${fixture}&theme=dark`);
		await page.locator('[aria-label="聊天消息"]').fill("航行台预览");
		await page.locator('[aria-label="聊天消息"]').press("Enter");
		const activity = fixture === "voyage-output" ? "sailing" : "fishing";
		await page.locator(`.voyage-rail.voyage-${activity}`).waitFor();
		await page.waitForTimeout(350);
		if (fixture === "voyage-tool") assert((await page.locator(".voyage-pill").textContent()).includes("工具执行中"));
		if (fixture === "voyage-thinking") assert((await page.locator(".voyage-pill").textContent()).includes("思考中"));
		await page.screenshot({ path: new URL(`${fixture}.png`, screenshots).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true, animations: "disabled" });
		if (activity === "fishing") {
			assert.equal(await page.locator(".voyage-wake").evaluate((element) => getComputedStyle(element).opacity), "0");
			assert.equal(await page.locator(".voyage-wave").first().evaluate((element) => getComputedStyle(element).animationName), "none");
			await page.emulateMedia({ reducedMotion: "reduce" });
			for (const selector of [".voyage-scene-boat", ".voyage-float", ".voyage-wave"]) assert.equal(await page.locator(selector).first().evaluate((element) => getComputedStyle(element).animationName), "none");
			await page.screenshot({ path: new URL(`${fixture}-reduced.png`, screenshots).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true, animations: "disabled" });
			await page.emulateMedia({ reducedMotion: "no-preference" });
		}
		if (activity === "sailing") {
			assert.notEqual(await page.locator(".voyage-wave").first().evaluate((element) => getComputedStyle(element).animationName), "none");
			await page.emulateMedia({ reducedMotion: "reduce" });
			for (const selector of [".voyage-scene-boat", ".voyage-wake", ".voyage-wave"]) assert.equal(await page.locator(selector).first().evaluate((element) => getComputedStyle(element).animationName), "none");
			await page.emulateMedia({ reducedMotion: "no-preference" });
		}
	}
	assert.deepEqual(errors, []);
	console.log("PASS preview: 3 viewports × 2 themes, collapsed/expanded warning, fishing/tool/thinking/output, reduced motion; screenshots saved");
	await page.goto(`${base}/tests/timing.html`);
	await page.waitForFunction(() => document.querySelector("#results")?.dataset.status, { timeout: 30000 });
	assert.equal(await page.locator("#results").getAttribute("data-status"), "passed", await page.locator("#results").textContent());
	console.log("PASS existing timing preview: " + (await page.locator("#results").textContent()).split("\n").length + " scenarios");
} finally { await browser.close(); }
