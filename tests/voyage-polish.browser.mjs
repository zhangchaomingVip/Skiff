// Simulated bridge and controlled clock; never contacts pi or a provider.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1424";
const screenshots = new URL(process.argv[3] ?? "../features/014-voyage-panel-polish/screenshots/", import.meta.url);
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
	assert.equal((await read()).context, 170);
	assert.equal((await read()).contextEstimated, true);
	assert.equal(await page.locator(".voyage-tool-active li").textContent(), "inspect_repository");
	assert.equal(await page.locator(".voyage-tool-active .voyage-tool-desc").count(), 0);
	state.messages[1].blocks.push(result("first", "完成"));
	state.messages[1].streaming = false;
	state.messages.push({ id: "second", role: "assistant", streaming: true, usage: usage(60, 15, 5, 10, 4), blocks: [{ kind: "thinking", text: "继续思考" }, { kind: "text", text: "完成" }] });
	await render();
	assert.deepEqual([(await read()).context, (await read()).turn.input, (await read()).turn.reasoning, (await read()).turn.output], [90, 230, 9, 30]);
	await render(); assert.equal((await read()).context, 90);
	state.messages[1].usage = usage(0, 0, 0, 0, 0); state.messages[2].usage = usage(0, 0, 0, 0, 0);
	await render(); assert.equal((await read()).context, 90); assert.equal((await read()).turn.input, 230);
	state.messages.push({ id: "third", role: "assistant", streaming: true, usage: usage(20, 5, 5), blocks: [] });
	await render(); assert.equal((await read()).context, 50);
	state.voyageTimeline = { ...(await read()).timeline, contextUsed: 999999, contextLimit: 1000, contextEstimated: false };
	await render(); assert.equal((await read()).context, 50);
	assert((await page.locator(".voyage-progress-caption").textContent()).includes("50"));

	state = { sessionId: "estimate", messages: [{ ...user, blocks: [{ kind: "text", text: "问题" }] }, { id: "first", role: "assistant", blocks: [
		{ kind: "thinking", text: "思考" }, { kind: "text", text: "abcd" }, call("estimate", "read", "abcdefgh"), result("estimate", "工具结果"),
	] }], isStreaming: false, model: state.model };
	await render();
	assert.equal((await read()).context, 11);
	assert.equal((await read()).contextEstimated, true);
	assert((await page.locator(".voyage-progress-caption").textContent()).includes("估算"));
	assert.equal((await record())["思考"], undefined);
	assert.equal((await record())["新增 / 缓存"], "—");
	await page.locator('[aria-label="收起航行台"]').click();
	assert.equal(await page.locator(".voyage-summary").count(), 0);
	await page.getByRole("button", { name: "展开航行台", exact: true }).click();
	state.messages[1].usage = usage(20); await render();
	// The tool result attached after this request adds four estimated context tokens.
	assert.equal((await read()).context, 44); assert.equal((await read()).contextEstimated, true);

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
	assert.deepEqual(await record(), { "累计输入": "230", "新增 / 缓存": "+175 · 23.9%", "思考": "12", "输出": "30", "计费": "未配置定价" });
	assert.equal(await page.locator(".voyage-turn-header span").textContent(), "260 tok");
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
		await page.getByRole("button", { name: "展开航行台", exact: true }).click();
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
	// Historical turns retain their own currency/prices; the current bill excludes older turns.
	await page.setViewportSize({ width: 1200, height: 800 });
	const snapshot = (currency) => ({ currency, inputCost: 10, outputCost: 20, cacheReadCost: 1, cacheWriteCost: 10 });
	state = { sessionId: "billing", isStreaming: false, model: { ...state.model, contextWindow: 128000 }, messages: [
		{ ...user, id: "older-user" },
		{ id: "older", role: "assistant", blocks: [], usage: usage(1000, 0, 0, 100, 0), routeSnapshot: snapshot("USD") },
		user,
		{ id: "billed", role: "assistant", blocks: [], usage: usage(1000, 38000, 0, 2000, 640), durationMs: 6000, routeSnapshot: snapshot("CNY") },
	] };
	await render();
	assert.deepEqual([(await read()).turn.total, (await read()).turn.newInput, (await read()).turn.cacheRead], [41000, 1000, 38000]);
	assert.equal(await page.locator(".voyage-turn-header span").textContent(), "41k tok");
	assert.equal((await record())["本轮耗时"], "6s");
	assert.equal((await record())["思考"], "640");
	assert.equal(await page.locator(".hit-high").textContent(), "97.4%");
	const bills = page.locator(".voyage-turn-cost");
	assert.deepEqual(await bills.allTextContents(), ["¥0.0880", "¥0.0880 + $0.0120"]);
	assert((await bills.first().getAttribute("title")).includes("¥0.088000"));
	await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedVoyageCost = text; } } }));
	await page.getByRole("button", { name: "复制本轮费用", exact: true }).click();
	assert.equal(await page.evaluate(() => window.copiedVoyageCost), "¥0.088000");
	assert.equal(await page.locator(".voyage-turn [role=status]").first().textContent(), "本轮费用已复制");
	await page.getByRole("button", { name: "复制会话累计费用", exact: true }).click();
	assert.equal(await page.evaluate(() => window.copiedVoyageCost), "¥0.088000 + $0.012000");
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		for (const width of [1200, 360]) {
			await page.setViewportSize({ width, height: 900 });
			await page.waitForTimeout(60);
			await page.locator(".voyage-turn").scrollIntoViewIfNeeded();
			assert(await page.locator(".voyage-turn").evaluate((element) => element.scrollWidth <= element.clientWidth));
			await capture(`${theme}-${width}-billing.png`);
		}
	}
	await page.setViewportSize({ width: 1200, height: 900 });
	await page.locator(".voyage-gauge-svg").scrollIntoViewIfNeeded();
	assert(await page.locator(".voyage-rail").evaluate((element) => element.getBoundingClientRect().width === 260));
	assert(await page.locator(".voyage-dashboard-header").evaluate((element) => {
		const title = element.querySelector("h1").getBoundingClientRect();
		const pill = element.querySelector(".voyage-pill").getBoundingClientRect();
		return Math.abs(title.y + title.height / 2 - pill.y - pill.height / 2) < 1;
	}));
	assert(await page.locator(".voyage-gauge-svg").evaluate((svg) => [...svg.querySelectorAll(".voyage-gauge-limit")].every((label) => {
		const box = label.getBBox();
		const outsideArc = label.textContent === "0" ? box.x + box.width < 32 : box.x > 228;
		return box.x >= -6 && box.x + box.width <= 266 && (label.textContent === "150" ? box.y + box.height < 36 : outsideArc && box.y + box.height < 151);
	})));
	await capture("dark-1200-gauge-billing.png");
	state.messages[3].usage = usage(100, 0, 0, 10, 0); await render();
	assert.equal((await record())["思考"], undefined);
	assert.equal(await page.locator(".hit-low").textContent(), "0.0%");
	state.messages[3].usage = usage(0, 0, 0, 10, 0); await render();
	assert.equal(await page.locator(".hit-low, .hit-high").count(), 0);
	delete state.messages[3].routeSnapshot; await render();
	assert.equal(await bills.count(), 0);
	assert.equal((await record())["计费"], "未配置定价");
	// A new pending turn can still show the completed session's bill.
	state.messages[3].routeSnapshot = snapshot("CNY");
	state.messages.push({ ...user, id: "pending" }); await render();
	assert.equal(await bills.first().isDisabled(), true);
	assert.equal(await bills.last().isEnabled(), true);
	await page.evaluate(() => window.voyageHarness.unmount());
	assert.equal(await page.evaluate(() => window.voyageHarness.intervalCount()), 0);
	assert.deepEqual(errors, []);
	console.log("PASS polish: cumulative/cache/streaming usage, estimates, token values, failure states, rail/log toggles, 4 widths x 2 themes, reduced motion, current/session billing, precise copy, mixed currencies, unpriced/pending turns, conditional reasoning, gauge bounds/alignment, cleanup; 23 screenshots");
	console.log(`Browser: ${browser.version()}`);
} catch (error) {
	await capture("failure.png");
	throw error;
} finally { await browser.close(); }
