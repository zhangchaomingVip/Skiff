// Simulated bridge and controlled clock; never contacts pi or a provider.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1424";
const screenshots = new URL("../features/014-voyage-panel-polish/screenshots/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const user = { id: "user", role: "user", blocks: [], timestamp: 1000 };
const usage = (input, cacheRead = 0, cacheWrite = 0, output = 20, reasoning = 5) => ({ input, cacheRead, cacheWrite, output, reasoning, totalTokens: 999999 });
const call = (id, name = "read", argsText = "") => ({ kind: "tool", id, name, argsText, done: true });
const result = (id, text, isError = false) => ({ kind: "toolResult", id, name: "read", text, isError });
let state;
const read = () => page.evaluate(() => window.voyageHarness.metrics);
const render = async () => { await page.evaluate((state) => window.voyageHarness.render(state), state); await page.waitForTimeout(30); };
const advance = async (ms) => { await page.evaluate((ms) => window.voyageHarness.advance(ms), ms); await page.waitForTimeout(30); };
const record = async () => page.locator(".voyage-turn dl > div").evaluateAll((rows) => Object.fromEntries(rows.map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent])));
const capture = (name) => page.screenshot({ path: fileURLToPath(new URL(name, screenshots)), fullPage: true, animations: "disabled" });

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	state = { messages: [user, { id: "first", role: "assistant", streaming: true, usage: usage(100, 40, 10), blocks: [call("first", "inspect_repository")] }], isStreaming: true,
		activeRun: { startedAt: 1000, promptId: "prompt", turnId: "turn:user" }, model: { id: "mock", provider: "mock", contextWindow: 1000 } };
	await render();
	assert.equal((await read()).context, 150);
	assert.equal((await read()).contextEstimated, false);
	assert.equal(await page.locator(".voyage-tool-active li").textContent(), "inspect_repository");
	assert.equal(await page.locator(".voyage-tool-active .voyage-tool-desc").count(), 0);
	state.messages[1].blocks.push(result("first", "完成"));
	state.messages[1].streaming = false;
	state.messages.push({ id: "second", role: "assistant", streaming: true, usage: usage(60, 15, 5, 10, 4), blocks: [{ kind: "thinking", text: "继续思考" }, { kind: "text", text: "完成" }] });
	await render();
	assert.deepEqual([(await read()).context, (await read()).turn.input, (await read()).turn.reasoning, (await read()).turn.output], [230, 230, 9, 30]);
	await render(); assert.equal((await read()).context, 230);
	state.messages[1].usage = usage(0); state.messages[2].usage = usage(0);
	await render(); assert.equal((await read()).context, 230); assert.equal((await read()).turn.input, 230);
	state.messages.push({ id: "third", role: "assistant", streaming: true, usage: usage(20, 5, 5), blocks: [] });
	await render(); assert.equal((await read()).context, 260);
	state.voyageTimeline = { ...(await read()).timeline, contextUsed: 999999, contextLimit: 1000, contextEstimated: false };
	await render(); assert.equal((await read()).context, 260);
	assert((await page.locator(".voyage-progress-caption").textContent()).includes("260"));

	state = { sessionId: "estimate", messages: [{ ...user, blocks: [{ kind: "text", text: "问题" }] }, { id: "first", role: "assistant", blocks: [
		{ kind: "thinking", text: "思考" }, { kind: "text", text: "abcd" }, call("estimate", "read", "abcdefgh"), result("estimate", "工具结果"),
	] }], isStreaming: false, model: state.model };
	await render();
	assert.equal((await read()).context, 11);
	assert.equal((await read()).contextEstimated, true);
	assert((await page.locator(".voyage-progress-caption").textContent()).includes("估算"));
	assert.equal((await record())["思考 tokens"], "—");
	await page.locator('[aria-label="收起航行台"]').click();
	assert((await page.locator(".voyage-distance").textContent()).includes("估算"));
	await page.locator(".voyage-summary").click();
	state.messages[1].usage = usage(20); await render();
	assert.equal((await read()).context, 20); assert.equal((await read()).contextEstimated, false);

	state = { sessionId: "statuses", messages: [user, { id: "tools", role: "assistant", streaming: true, usage: usage(100, 40, 10, 20, 8), blocks: [
		call("failed", "inspect_repository_and_permissions", "D:/workspace/Skiff/".repeat(10)),
		call("timeout", "bash", "运行工具并检查超时"), call("missing", "read"), call("completed", "read"),
	] }], isStreaming: true, activeRun: { startedAt: 1000, promptId: "statuses", turnId: "turn:user" }, model: state.model };
	await render(); await advance(6000);
	state.messages[1].blocks.push(result("failed", "权限不足", true), result("timeout", "timeout: expired", true), result("completed", "已完成"));
	state.messages[1].streaming = false;
	state.messages.push({ id: "answer", role: "assistant", streaming: false, usage: usage(60, 15, 5, 10, 4), blocks: [{ kind: "text", text: "完成" }], durationMs: 6000 });
	state.isStreaming = false; delete state.activeRun; await render();
	assert.equal(await page.locator(".voyage-tool-log summary").textContent(), "航海日志 · 4 项已入日志（3 次失败）");
	const timeline = (await read()).timeline;
	// A terminal event ledger can include all four non-success states together.
	state.voyageTimeline = { ...timeline, tools: [...timeline.tools, { ...timeline.tools[2], id: "interrupted", name: "cancelled_tool", summary: "", status: "interrupted", completionOrder: 5 }], completedCount: 5 };
	await render();
	assert.equal(await page.locator(".voyage-tool-log summary").textContent(), "航海日志 · 5 项已入日志（4 次失败）");
	assert.deepEqual(await record(), { "本轮耗时": "6s", "输入 tokens": "230", "思考 tokens": "12", "输出 tokens": "30" });
	await page.locator(".voyage-tool-log summary").click();
	for (const [status, label] of [["failed", "失败"], ["timeout", "超时"], ["missing", "缺少结果"], ["interrupted", "已中止"]]) {
		await page.locator(`.tool-${status} .voyage-tool-state`).waitFor({ state: "visible" });
		assert.equal(await page.locator(`.tool-${status} .voyage-tool-state`).textContent(), label);
	}
	assert.equal(await page.locator(".tool-completed .voyage-tool-state").count(), 0);
	assert(!(await page.locator("body").textContent()).includes("等待参数"));
	for (const theme of ["light", "dark"]) for (const [width, height] of [[1200, 800], [900, 700], [600, 400], [360, 640]]) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		await page.setViewportSize({ width, height }); await page.waitForTimeout(60);
		if (!await page.locator(".voyage-tool-log").evaluate((element) => element.open)) await page.locator(".voyage-tool-log summary").click();
		await page.locator(".voyage-tool-log").scrollIntoViewIfNeeded();
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		for (const selector of [".voyage-dashboard", ".voyage-tool-log", ".voyage-tool-log ol", ".voyage-tool-row", ".voyage-turn"]) {
			assert(await page.locator(selector).evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${theme} ${width} ${selector}`);
		}
		await capture(`${theme}-${width}-failure-log.png`);
		if (theme === "dark" && width === 360) {
			await page.locator(".tool-interrupted").scrollIntoViewIfNeeded(); await capture("dark-360-terminal-states.png");
		}
		await page.locator(".voyage-turn").scrollIntoViewIfNeeded(); await capture(`${theme}-${width}-tokens.png`);
		await page.locator('[aria-label="收起航行台"]').click();
		assert.equal(await page.locator(".voyage-rail.expanded").count(), 0);
		await page.locator(".voyage-summary").click();
		await page.locator(".voyage-rail.expanded").waitFor();
	}
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.locator(".voyage-tool-log summary").click();
	await page.locator(".voyage-tool-log").scrollIntoViewIfNeeded();
	for (const selector of [".voyage-tool-row", ".voyage-scene-boat"]) assert.equal(await page.locator(selector).first().evaluate((element) => getComputedStyle(element).animationName), "none");
	await capture("dark-360-reduced.png");
	state = { sessionId: "success", messages: [user, { id: "success", role: "assistant", blocks: [call("success")] }], isStreaming: true, model: state.model };
	await render(); state.messages[1].blocks.push(result("success", "完成")); await render();
	assert.equal(await page.locator(".voyage-tool-log summary").textContent(), "航海日志 · 1 项已入日志");
	await page.evaluate(() => window.voyageHarness.unmount());
	assert.equal(await page.evaluate(() => window.voyageHarness.intervalCount()), 0);
	assert.deepEqual(errors, []);
	console.log("PASS polish: cumulative/cache/streaming usage, repeated/regressed input, event total isolation, estimates, token values, all four failure states, zero-failure summary, rail/log toggles, 4 widths x 2 themes, reduced motion, cleanup; 18 screenshots");
	console.log(`Browser: ${browser.version()}`);
} finally { await browser.close(); }
