// Controlled mock bridge: retained display values never enter accounting or another conversation.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const { chromium } = createRequire(new URL("../.playwright-cli/package.json", import.meta.url))("playwright-core");
const base = process.argv[2] ?? "http://localhost:1421";
const screenshots = new URL("../.playwright-cli/weather-bento/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const render = async (state) => { await page.evaluate((state) => window.voyageHarness.render(state), state); await page.waitForTimeout(40); };
const advance = async (ms) => { await page.evaluate((ms) => window.voyageHarness.advance(ms), ms); await page.waitForTimeout(30); };
const readings = () => page.locator(".voyage-weather-card").evaluateAll((cards) => cards.map((card) => ({ value: card.querySelector("strong").textContent, summary: Array.from(card.querySelectorAll(".voyage-weather-summary > span"), (line) => line.textContent) })));
const model = { id: "model-a", provider: "mock", contextWindow: 200000 };
const first = { sessionId: "retention", model, messages: [
	{ id: "first", role: "user", blocks: [] },
	{ id: "reply", role: "assistant", blocks: [{ kind: "text", text: "上一轮回答" }], usage: { input: 2000, cacheRead: 32000, cacheWrite: 0, output: 2800, reasoning: 0, totalTokens: 36800 }, performance: { fingerprint: "first", ttftMs: 1200, decodeMs: 1000, averageSpeed: 128, averageEstimated: false } },
], isStreaming: false };

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	await render(first);
	const before = await readings();
	assert.equal(before[0].value, "128.0");
	assert.equal(before[1].value, "36.8k");
	const waiting = { ...structuredClone(first), isStreaming: true, activeRun: { startedAt: await page.evaluate(() => Date.now()), promptId: "next", turnId: "turn:next" } };
	// The optimistic interval before the new user message arrives also keeps the readings.
	await render(waiting);
	assert.deepEqual(await readings(), before);
	waiting.messages.push({ id: "next", role: "user", blocks: [{ kind: "text", text: "下一轮问题" }] });
	await render(waiting); await advance(500);
	assert.deepEqual(await readings(), before);
	assert.equal(await page.locator(".voyage-weather-pending").count(), 4);
	assert.equal(await page.locator(".voyage-weather-spark-point").getAttribute("cx"), "50");
	assert(await page.evaluate(() => { const metrics = window.voyageHarness.metrics; return metrics.turn.total === 0 && metrics.turn.input === undefined && metrics.context < 36800; }));
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const width of [240, 260, 300, 480]) {
			await page.evaluate((width) => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", `${width}px`), width);
			assert(await page.locator(".voyage-weather-card h2").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), `${theme} ${width}: pending marker overflows`);
			if (width === 260) await page.locator(".voyage-dashboard").screenshot({ path: fileURLToPath(new URL(`${theme}-waiting-readings.png`, screenshots)), animations: "disabled" });
		}
	}
	await page.getByRole("button", { name: "Token 用量明细", exact: true }).click();
	assert(await page.locator(".voyage-telemetry-pending").isVisible());
	assert.match(await page.locator(".voyage-telemetry-ledger").first().textContent(), /Token 合计0/);
	await page.keyboard.press("Escape");
	assert.deepEqual(await readings(), before);
	// Remounting a waiting chat can recover the previous reading from its own transcript.
	await render({ ...waiting, sessionId: "reopened-retention" });
	assert.deepEqual(await readings(), before);
	assert.equal(await page.locator(".voyage-weather-pending").count(), 4);
	waiting.sessionId = "reopened-retention";
	waiting.messages.push({ id: "next-reply", role: "assistant", streaming: true, blocks: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } });
	await render(waiting);
	assert.deepEqual(await readings(), before);
	delete waiting.messages[3].usage;
	waiting.messages[3].blocks = [{ kind: "text", text: "开" }];
	await render(waiting);
	for (let step = 0; step < 6; step++) {
		await advance(100);
		waiting.messages[3].blocks[0].text += "航".repeat(100);
		await render(waiting);
	}
	assert.equal(await page.locator(".voyage-weather-speed .voyage-weather-pending").count(), 0);
	assert.deepEqual((await readings()).slice(1), before.slice(1));
	assert(await page.evaluate(() => window.voyageHarness.metrics.speed > 0));
	assert.equal(await page.locator(".voyage-weather-tokens .voyage-weather-pending").count(), 1);
	waiting.isStreaming = false; delete waiting.activeRun;
	waiting.messages[3].streaming = false;
	waiting.messages[3].usage = { input: 1000, cacheRead: 9000, cacheWrite: 500, output: 1000, reasoning: 0, totalTokens: 11500 };
	waiting.messages[3].performance = { fingerprint: "next", ttftMs: 500, decodeMs: 1000, averageSpeed: 64, averageEstimated: false };
	await render(waiting);
	const after = await readings();
	assert.equal(after[0].value, "64.0");
	assert.equal(after[1].value, "11.5k");
	assert.deepEqual(after[1].summary, ["输入 10.5k tok", "输出 1k tok"]);
	assert.equal(after[2].value, "5.8%");
	assert.equal(after[3].value, "85.7%");
	assert.equal(await page.locator(".voyage-weather-pending").count(), 0);
	assert(await page.evaluate(() => { const { turn } = window.voyageHarness.metrics; return turn.total === 11500 && turn.input + turn.output === turn.total; }));
	await render({ sessionId: "empty-chat", model, messages: [], isStreaming: false });
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "—");
	assert.equal(await page.locator(".voyage-weather-speed strong").textContent(), "—");
	assert.equal(await page.locator(".voyage-weather-pending").count(), 0);
	assert.deepEqual(errors, []);
	console.log("PASS retained readings: prompt handshake, waiting/reopen, independent speed/usage updates, honest details, arithmetic, chat isolation, light/dark × 4 widths");
} catch (error) {
	await page.screenshot({ path: fileURLToPath(new URL("retention-failure.png", screenshots)), fullPage: true });
	throw error;
} finally { await browser.close(); }
