// Controlled mock bridge; no pi, credentials or user workspace storage.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(new URL("../.playwright-cli/package.json", import.meta.url))("playwright-core");
const base = process.argv[2] ?? "http://localhost:1421";
const screenshots = new URL(process.argv[3] ?? "../.playwright-cli/weather-bento/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const render = async (state) => { await page.evaluate((state) => window.voyageHarness.render(state), state); await page.waitForTimeout(50); };
const advance = async (ms) => { await page.evaluate((ms) => window.voyageHarness.advance(ms), ms); await page.waitForTimeout(30); };
const capture = (name) => page.locator(".voyage-dashboard").screenshot({ path: fileURLToPath(new URL(name, screenshots)), animations: "disabled" });
const user = { id: "user", role: "user", blocks: [], timestamp: 1000 };
const model = { id: "mock", provider: "mock", contextWindow: 200000 };
const state = { sessionId: "weather", messages: [user, { id: "reply", role: "assistant", streaming: true, blocks: [{ kind: "thinking", text: "思考" }] }], isStreaming: true, activeRun: { startedAt: 1000, promptId: "weather", turnId: "turn:user" }, model };
const snapshot = { routeId: "mock", providerKey: "mock", familyId: "mock", familyName: "Mock", modelId: "mock", relayId: "mock", relayName: "Mock", currency: "USD", inputCost: 2, outputCost: 4, cacheReadCost: .2 };

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	assert.equal(await page.locator(".voyage-weather-grid > section").count(), 4);
	assert.deepEqual(await page.locator(".voyage-weather-card h2").allTextContents(), ["输出航速", "本轮消耗", "上下文容量", "缓存命中"]);
	assert.equal(await page.locator(".voyage-weather-speed strong").textContent(), "—");
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "—");
	assert.equal(await page.locator(".voyage-weather-spark-line").count(), 0);
	await render(state); await advance(380);
	assert.match(await page.locator(".voyage-weather-speed p").textContent(), /等待模型首字/);
	state.messages[1].blocks.push({ kind: "text", text: "开始" });
	await render(state);
	for (let step = 0; step < 10; step++) {
		await advance(100);
		state.messages[1].blocks[1].text += "顺风航行";
		await render(state);
	}
	assert.equal((await page.evaluate(() => window.voyageHarness.metrics)).ttftMs, 380);
	assert(Number(await page.locator(".voyage-weather-speed strong").textContent()) > 0);
	assert(Number(await page.evaluate(() => window.voyageHarness.metrics.turn.total)) > 0);
	assert.match(await page.locator(".voyage-weather-spark-line").getAttribute("d"), / Q/);
	const trail = await page.locator(".voyage-weather-spark-line").getAttribute("d");
	state.isStreaming = false; delete state.activeRun;
	state.messages[1].streaming = false;
	state.messages[1].usage = { input: 2000, cacheRead: 32000, cacheWrite: 0, output: 2800, reasoning: 1200, totalTokens: 36800 };
	state.messages[1].routeSnapshot = snapshot;
	await render(state);
	const frozen = await page.locator(".voyage-weather-speed strong").textContent();
	assert.equal(frozen, "1600.0"); // 1600 answer tokens / 1s decode, not total turn time.
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "36.8k");
	assert.equal(await page.locator(".voyage-weather-tokens p").textContent(), "思考 1.2k · 新增 3.6k");
	assert.equal(await page.locator(".voyage-weather-context strong").textContent(), "18.4%");
	assert.match(await page.locator(".voyage-weather-context p").textContent(), /36.8k \/ 200k · 空间极其充裕/);
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "94.1%");
	assert.match(await page.locator(".voyage-weather-cache p").textContent(), /节省约 73% 费用 · 复用 32k/);
	await advance(10000);
	assert.equal(await page.locator(".voyage-weather-speed strong").textContent(), frozen);
	assert.equal(await page.locator(".voyage-weather-spark-line").getAttribute("d"), trail);
	await page.locator(".voyage-weather-tokens").focus();
	assert(await page.locator(".voyage-weather-tokens [role=tooltip]").isVisible());
	assert.match(await page.locator(".voyage-weather-tokens [role=tooltip]").textContent(), /会话累计 36.8k Token；本轮预估费用/);
	await page.locator(".voyage-weather-cache").hover();
	assert(await page.locator(".voyage-weather-cache [role=tooltip]").isVisible());
	await page.locator(".voyage-dashboard-header h1").click();
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const width of [240, 260, 360, 480]) {
			await page.evaluate((width) => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", `${width}px`), width);
			const cards = await page.locator(".voyage-weather-card").evaluateAll((elements) => elements.map((element) => {
				const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
				const summary = element.querySelector(".voyage-weather-summary").getBoundingClientRect();
				const viz = element.querySelector(".voyage-weather-viz").getBoundingClientRect();
				return { x: box.x, y: box.y, width: box.width, height: box.height, summaryTop: summary.top - box.top, summaryBottom: summary.bottom - box.top, summaryHeight: summary.height, vizTop: viz.top - box.top, overflow: element.scrollWidth > element.clientWidth, radius: style.borderRadius, blur: style.backdropFilter };
			}));
			assert.equal(cards.length, 4);
			assert(Math.abs(cards[0].y - cards[1].y) < 1 && cards[2].y > cards[0].y);
			assert(Math.max(...cards.map((card) => card.height)) - Math.min(...cards.map((card) => card.height)) < 1, JSON.stringify(cards));
			assert(cards.every((card) => !card.overflow && card.radius === "16px" && card.blur === "blur(16px)"), JSON.stringify(cards));
			assert(cards.every((card) => card.summaryHeight === 33), JSON.stringify(cards));
			for (const key of ["summaryTop", "summaryBottom", "vizTop"]) assert(Math.max(...cards.map((card) => card[key])) - Math.min(...cards.map((card) => card[key])) < 1, `${key}: ${JSON.stringify(cards)}`);
			await capture(`${theme}-${width}.png`);
		}
	}
	const warning = structuredClone(state);
	warning.messages[1].usage = { input: 170000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, totalTokens: 170000 };
	await render(warning);
	assert.match(await page.locator(".voyage-weather-context p").textContent(), /已消耗 85% · 建议开启新话题/);
	assert(await page.locator(".voyage-weather-context").evaluate((element) => element.classList.contains("is-warning")));
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "0.0%");
	assert.equal(await page.locator(".voyage-weather-cache p").textContent(), "本次全量传输 · 未命中缓存");
	for (const name of ["账单明细", "纯净星空", "领航员"]) {
		await page.getByRole("button", { name, exact: true }).click();
		assert.equal(await page.locator(".voyage-weather-grid > section").count(), 4);
	}
	await page.locator(".voyage-companion-stage").click();
	assert.equal(await page.locator(".voyage-companion-art").getAttribute("src"), "/companion/tap.webp");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(await page.locator(".voyage-weather-needle").evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
	await page.setViewportSize({ width: 360, height: 640 });
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await capture("mobile.png");
	// Full application previews run on the isolated Vite origin.
	await page.setViewportSize({ width: 1440, height: 900 });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${base}/tests/preview.html?theme=${theme}&fixture=voyage-moored`);
		await page.getByRole("button", { name: "航行台", exact: true }).click();
		await page.locator(".voyage-weather-grid").waitFor();
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-app.png`, screenshots)), animations: "disabled" });
	}
	assert.deepEqual(errors, []);
	console.log("PASS weather bento: streaming/TTFT/decode, token growth/freeze, priced cache savings, warning/empty states, tooltip keyboard access, 3 decks, companion, reduced motion, light/dark × 4 widths, mobile and app previews");
} catch (error) {
	await page.screenshot({ path: fileURLToPath(new URL("failure.png", screenshots)), fullPage: true });
	throw error;
} finally { await browser.close(); }
