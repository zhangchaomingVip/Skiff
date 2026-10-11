// Exercise the real reducer path and the rendered needle, not just speed numbers.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1424";
const screenshots = new URL("../features/014-voyage-panel-polish/screenshots/needle/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const zeroUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, totalTokens: 0 };
const settle = () => page.waitForTimeout(350);
const send = async (event) => {
	await page.evaluate((event) => {
		window.needleState = window.needleReducer(window.needleState, { ...event, voyageAt: Date.now() });
		window.voyageHarness.render(window.needleState);
	}, event);
	await settle();
};
const advance = async (ms) => { await page.evaluate((ms) => window.voyageHarness.advance(ms), ms); await settle(); };
const needle = () => page.evaluate(() => {
	const element = document.querySelector(".voyage-gauge-needle");
	const matrix = element ? new DOMMatrixReadOnly(getComputedStyle(element).transform) : undefined;
	return { speed: window.voyageHarness.metrics.speed, angle: matrix ? Math.atan2(matrix.b, matrix.a) * 180 / Math.PI : undefined,
		label: document.querySelector(".voyage-gauge-label").textContent, status: document.querySelector(".voyage-status-pill").textContent,
		peak: window.voyageHarness.metrics.peakSpeed, estimated: window.voyageHarness.metrics.speedEstimated };
});
const capture = (name) => page.screenshot({ path: fileURLToPath(new URL(name, screenshots)), fullPage: true, animations: "disabled" });

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	await page.evaluate(async () => {
		const { reduce } = await import("/src/chat/reducer.ts");
		const { initialSessionState } = await import("/src/chat/types.ts");
		window.needleReducer = reduce;
		window.needleState = { ...initialSessionState, model: { id: "mock", provider: "mock", contextWindow: 1000 } };
	});
	await send({ type: "prompt_start", promptId: "needle", startedAt: 1000, message: { id: "user", role: "user", blocks: [] } });
	await send({ type: "message_start", message: { role: "user", content: [{ type: "text", text: "测试指针" }] } });
	await send({ type: "message_start", message: { role: "assistant", content: [], usage: zeroUsage } });
	await send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "思考路线" } });
	assert.deepEqual([(await needle()).angle, (await needle()).label], [undefined, "思考中"]);
	await advance(1000);
	await send({ type: "message_update", usage: zeroUsage, assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "开始输出" } });
	await advance(300);
	await send({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "持续回复".repeat(5), usage: zeroUsage } });
	await advance(100);
	const slow = await needle();
	assert(slow.speed > 0, `zero usage suppressed live speed: ${JSON.stringify(slow)}`);
	assert.equal(slow.estimated, true);
	assert(slow.angle > -90, `needle did not leave zero: ${JSON.stringify(slow)}`);
	assert(Math.abs(slow.angle - (-90 + Math.min(1, slow.speed / 300) * 180)) < .1);
	await capture("live-output.png");
	await send({ type: "message_update", usage: { ...zeroUsage, output: 100000, totalTokens: 100000 }, assistantMessageEvent: { type: "usage" } });
	const corrected = await needle();
	assert.equal(corrected.speed, slow.speed);
	assert.equal(corrected.peak, slow.peak);
	assert.equal(corrected.estimated, true);
	await send({ type: "message_update", usage: zeroUsage, assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "加速输出".repeat(15) } });
	await advance(100);
	const fast = await needle();
	assert(fast.speed > slow.speed);
	assert(fast.angle > slow.angle, `needle did not respond to increasing speed: ${JSON.stringify({ slow, fast })}`);
	assert.equal(fast.status, "航行中");
	await capture("faster-output.png");
	await send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "完成" }], usage: { input: 100, cacheRead: 0, cacheWrite: 0, output: 400, totalTokens: 500 }, stopReason: "stop" } });
	await send({ type: "agent_end", durationMs: 1500 });
	const stopped = await needle();
	assert.equal(stopped.speed, 0);
	assert(Math.abs(stopped.angle + 90) < .1);
	assert.equal(stopped.status, "已停止");
	assert.equal(stopped.estimated, false);
	assert.equal(stopped.peak, fast.peak);
	await capture("stopped-zero.png");
	await page.evaluate(() => window.voyageHarness.unmount());
	assert.equal(await page.evaluate(() => window.voyageHarness.intervalCount()), 0);
	assert.deepEqual(errors, []);
	console.log(`PASS needle: real reducer events, zero/stale streaming usage cannot override live speed, estimated label, thinking timer, live ${slow.speed.toFixed(1)} tok/s at ${slow.angle.toFixed(1)} deg, faster ${fast.speed.toFixed(1)} tok/s at ${fast.angle.toFixed(1)} deg, stopped 0 tok/s at -90 deg, historical peak retained; 3 screenshots`);
} finally { await browser.close(); }
