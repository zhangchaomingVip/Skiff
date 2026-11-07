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
	// Retired view and split-height preferences cannot hide the companion after reload.
	for (const deck of ["billing", "blank"]) {
		await page.evaluate((deck) => { localStorage.setItem("skiff.voyage.deckMode", deck); localStorage.setItem("skiff.voyage.deckSize", "420"); }, deck);
		await page.reload();
		await page.waitForFunction(() => window.voyageHarness?.render);
		assert.equal(await page.locator(".voyage-deck-companion .voyage-companion").count(), 1);
		assert.equal(await page.locator(".voyage-dashboard.split, .voyage-deck-billing, .voyage-deck-blank, .voyage-deck-handle").count(), 0);
	}
	assert.equal(await page.locator(".voyage-dashboard-header h1").textContent(), "Skiff 航行台");
	assert.equal(await page.locator(".voyage-dashboard-header h1 svg, .voyage-badge, .voyage-deck-switch").count(), 0);
	assert.equal(await page.getByRole("group", { name: "甲板视图", exact: true }).count(), 0);
	assert.equal(await page.locator(".voyage-dashboard-header button").count(), 1);
	assert.equal(await page.locator(".voyage-companion-sound").count(), 0);
	assert.equal(await page.locator(".voyage-collapse").count(), 1);
	assert.equal(await page.locator(".voyage-weather-grid > section").count(), 4);
	assert.equal(await page.getByRole("group", { name: "航行台用量范围", exact: true }).count(), 0);
	assert(await page.locator(".voyage-telemetry").evaluate((element) => element.getBoundingClientRect().height === element.querySelector(".voyage-weather-grid").getBoundingClientRect().height));
	assert.deepEqual(await page.locator(".voyage-weather-card h2").allTextContents(), ["推理速率", "Token 用量", "上下文窗口", "缓存"]);
	assert.equal(await page.locator(".voyage-weather-speed strong").textContent(), "—");
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "—");
	assert.deepEqual(await page.locator(".voyage-weather-cache p span").allTextContents(), ["缓存创建 — tok", "缓存读取 — tok"]);
	assert.equal(await page.locator(".voyage-weather-spark-line").count(), 0);
	assert.equal(await page.locator(".voyage-weather-spark-point").count(), 0);
	assert.equal(await page.locator(".voyage-weather-token-bar").count(), 0);
	assert.equal(await page.locator(".voyage-weather-ring.is-unknown").count(), 2);
	assert.equal(await page.locator(".voyage-weather-ring-active").count(), 0);
	await render(state); await advance(380);
	assert.deepEqual(await page.locator(".voyage-weather-speed p span").allTextContents(), ["首字 —", "速率峰值 0 tok/s"]);
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
	assert.equal(await page.locator(".voyage-weather-spark-line").count(), 0);
	assert.deepEqual(await page.evaluate(() => window.voyageHarness.metrics.telemetry.inputTrend), [undefined]);
	state.isStreaming = false; delete state.activeRun;
	state.messages[1].streaming = false;
	state.messages[1].usage = { input: 2000, cacheRead: 32000, cacheWrite: 0, output: 2800, reasoning: 1200, totalTokens: 36800 };
	state.messages[1].routeSnapshot = snapshot;
	await render(state);
	const frozen = await page.locator(".voyage-weather-speed strong").textContent();
	assert.equal(frozen, "1600.0"); // 1600 answer tokens / 1s decode, not total turn time.
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "36.8k");
	assert.deepEqual(await page.locator(".voyage-weather-tokens p span").allTextContents(), ["输入 34k tok", "输出 2.8k tok"]);
	assert.deepEqual(await page.evaluate(() => window.voyageHarness.metrics.telemetry.inputTrend), [2000]);
	assert.equal(await page.locator(".voyage-weather-spark-point").count(), 1);
	assert.equal(await page.locator(".voyage-weather-spark-point").getAttribute("cx"), "50");
	const speedLines = await page.locator(".voyage-weather-speed p span").allTextContents();
	assert.match(speedLines[0], /^首字 /);
	assert.match(speedLines[1], /^速率峰值 \d+ tok\/s$/);
	assert.equal(await page.locator(".voyage-weather-context strong").textContent(), "18.4%");
	assert.deepEqual(await page.locator(".voyage-weather-context p span").allTextContents(), ["当前占用 36.8k tok", "窗口上限 200k tok"]);
	assert.equal(await page.locator(".voyage-weather-context .voyage-weather-ring-active").getAttribute("stroke-dasharray"), "18.4 100");
	assert(Math.abs(parseFloat(await page.locator(".voyage-weather-cache .voyage-weather-ring-active").getAttribute("stroke-dasharray")) - 32000 / 34000 * 100) < .001);
	assert.match(await page.locator(".voyage-weather-cache .voyage-weather-ring-active").getAttribute("stroke"), /^url\(#/);
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "94.1%");
	assert.deepEqual(await page.locator(".voyage-weather-cache p span").allTextContents(), ["缓存创建 0 tok", "缓存读取 32k tok"]);
	assert(await page.evaluate(() => { const { turn } = window.voyageHarness.metrics; return turn.input + turn.output === turn.total; }));
	await advance(10000);
	assert.equal(await page.locator(".voyage-weather-speed strong").textContent(), frozen);
	assert.deepEqual(await page.evaluate(() => window.voyageHarness.metrics.telemetry.inputTrend), [2000]);
	await page.getByRole("button", { name: "Token 用量明细", exact: true }).focus();
	await page.keyboard.press("Enter");
	assert(await page.getByRole("dialog", { name: "本轮进程与用量", exact: true }).isVisible());
	assert.equal(await page.locator(".voyage-telemetry-popover").evaluate((element) => getComputedStyle(element).borderRadius), "16px");
	assert.deepEqual(await page.locator(".voyage-telemetry-popover").evaluate((element) => { const style = getComputedStyle(element); return [style.width, style.padding]; }), ["280px", "12px"]);
	assert.equal(await page.locator(".voyage-telemetry-ledger > div").first().evaluate((element) => getComputedStyle(element).borderBottomWidth), "0px");
	assert.match(await page.locator(".voyage-telemetry-ledger").first().textContent(), /Token 合计36,800/);
	assert.equal(await page.locator(".voyage-telemetry-foot").count(), 0);
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(".voyage-telemetry-popover").count(), 0);
	assert.equal(await page.getByRole("button", { name: "Token 用量明细", exact: true }).getAttribute("aria-expanded"), "false");
	assert(await page.getByRole("button", { name: "Token 用量明细", exact: true }).evaluate((element) => document.activeElement === element));
	await page.keyboard.press("Space");
	assert(await page.getByRole("dialog", { name: "本轮进程与用量", exact: true }).isVisible());
	await page.keyboard.press("Space");
	assert.equal(await page.locator(".voyage-telemetry-popover").count(), 0);
	await page.mouse.move(100, 100);
	const restingBorder = await page.locator(".voyage-weather-cache").evaluate((element) => getComputedStyle(element).borderColor);
	await page.locator(".voyage-weather-cache").hover();
	await page.waitForTimeout(300);
	assert.equal(await page.locator(".voyage-telemetry-popover").count(), 0);
	assert.notEqual(await page.locator(".voyage-weather-cache").evaluate((element) => getComputedStyle(element).borderColor), restingBorder);
	await page.getByRole("button", { name: "缓存明细", exact: true }).click();
	assert(await page.getByRole("dialog", { name: "本轮缓存账单", exact: true }).isVisible());
	await page.locator(".voyage-telemetry-popover").hover();
	await page.waitForTimeout(300);
	assert(await page.locator(".voyage-telemetry-popover").isVisible());
	await page.mouse.move(100, 100);
	await page.waitForTimeout(300);
	assert(await page.locator(".voyage-telemetry-popover").isVisible());
	await page.locator(".voyage-weather-speed").hover();
	await page.waitForTimeout(300);
	assert.equal(await page.locator(".voyage-telemetry-popover").count(), 1);
	assert(await page.getByRole("dialog", { name: "本轮缓存账单", exact: true }).isVisible());
	await page.getByRole("button", { name: "缓存明细", exact: true }).click();
	assert.equal(await page.locator(".voyage-telemetry-popover").count(), 0);
	await page.getByRole("button", { name: "缓存明细", exact: true }).click();
	await page.locator(".voyage-dashboard-header h1").click();
	assert.equal(await page.locator(".voyage-telemetry-popover").count(), 0);
	await page.getByRole("button", { name: "上下文窗口明细", exact: true }).click();
	assert.match(await page.locator(".voyage-telemetry-ledger").textContent(), /系统提示词未独立上报/);
	await page.getByRole("button", { name: "关闭指标明细", exact: true }).click();
	await page.locator(".voyage-dashboard-header h1").click();
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const width of [240, 260, 300, 360, 480]) {
			await page.evaluate((width) => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", `${width}px`), width);
			assert(await page.locator(".voyage-dashboard-header").evaluate((element) => {
				const header = element.getBoundingClientRect();
				const collapse = element.querySelector(".voyage-collapse").getBoundingClientRect();
				return header.height === 36 && element.scrollWidth <= element.clientWidth && Math.abs(collapse.right - header.right) < 1 && Math.abs(header.top + header.height / 2 - collapse.top - collapse.height / 2) < 1;
			}), `Header misaligned at ${width}px (${theme})`);
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
			assert(await page.locator(".voyage-weather-viz").evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().height === 32)));
			assert(await page.locator(".voyage-weather-summary").evaluateAll((elements) => elements.every((element) => element.scrollHeight <= element.clientHeight)), "Summary must fit its two-line grid row");
			assert.equal(await page.locator(".voyage-weather-summary span").count(), 8);
			assert(await page.locator(".voyage-weather-summary span").evaluateAll((elements) => elements.every((element) => element.scrollHeight <= 17 && element.scrollWidth <= element.clientWidth)), "Each summary item must stay on one line within its card");
			const summaryRows = await page.locator(".voyage-weather-card").evaluateAll((elements) => elements.map((element) => Array.from(element.querySelectorAll(".voyage-weather-summary span")).map((row) => { const box = row.getBoundingClientRect(); return { top: box.top - element.getBoundingClientRect().top, height: box.height, lineHeight: getComputedStyle(row).lineHeight }; })));
			assert(summaryRows.every((rows) => rows.length === 2 && rows.every((row, index) => Math.abs(row.top - summaryRows[0][index].top) < 1 && row.height === summaryRows[0][index].height && row.lineHeight === summaryRows[0][index].lineHeight)), JSON.stringify(summaryRows));
			assert(await page.locator(".voyage-weather-ring").evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().width === 32 && element.getBoundingClientRect().height === 32)));
			assert(await page.locator(".voyage-weather-ring-active").evaluateAll((elements) => elements.every((element) => getComputedStyle(element).strokeLinecap === "round")));
			assert(await page.locator(".voyage-weather-ring-track").evaluateAll((elements) => elements.every((element) => getComputedStyle(element).strokeWidth === "4px" && getComputedStyle(element).stroke !== "none" && getComputedStyle(element).stroke !== "rgba(0, 0, 0, 0)")));
			for (const key of ["summaryTop", "summaryBottom", "vizTop"]) assert(Math.max(...cards.map((card) => card[key])) - Math.min(...cards.map((card) => card[key])) < 1, `${key}: ${JSON.stringify(cards)}`);
			await capture(`${theme}-${width}.png`);
			if (width === 360) {
				await page.getByRole("button", { name: "Token 用量明细", exact: true }).click();
				await page.locator(".voyage-telemetry-popover").screenshot({ path: fileURLToPath(new URL(`${theme}-ledger.png`, screenshots)), animations: "disabled" });
				await page.locator(".voyage-dashboard-header h1").click();
			}
		}
	}
	// Low and zero percentages retain a visible complete track in both themes.
	const low = structuredClone(state);
	low.messages[1].usage = { input: 12800, cacheRead: 0, cacheWrite: 0, output: 2800, reasoning: 1200, totalTokens: 15600 };
	await render(low);
	await page.evaluate(() => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", "260px"));
	assert.equal(await page.locator(".voyage-weather-context strong").textContent(), "7.8%");
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "0.0%");
	assert.equal(await page.locator(".voyage-weather-cache .voyage-weather-ring.is-unknown").count(), 0);
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const stroke of await page.locator(".voyage-weather-ring-track").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).stroke))) assert.match(stroke, /0\.4/);
		await page.locator(".voyage-telemetry").screenshot({ path: fileURLToPath(new URL(`${theme}-low-zero.png`, screenshots)), animations: "disabled" });
	}
	// Long TTFT and a three-digit peak must each fit one line, including at 240px.
	const longWait = { sessionId: "long-wait", messages: [user, { id: "long-reply", role: "assistant", streaming: true, blocks: [{ kind: "thinking", text: "思考" }] }], isStreaming: true, activeRun: { startedAt: await page.evaluate(() => Date.now()), promptId: "long-wait", turnId: "turn:user" }, model };
	await render(longWait); await advance(47000);
	longWait.messages[1].blocks.push({ kind: "text", text: "航" });
	await render(longWait);
	for (let step = 0; step < 10; step++) {
		await advance(100);
		longWait.messages[1].blocks[1].text += "航".repeat(85);
		await render(longWait);
	}
	assert((await page.evaluate(() => window.voyageHarness.metrics)).peakSpeed >= 425);
	assert.match(await page.locator(".voyage-weather-speed p span").first().textContent(), /47/);
	for (const width of [240, 260, 300]) {
		await page.evaluate((width) => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", `${width}px`), width);
		assert(await page.locator(".voyage-weather-speed p span").evaluateAll((elements) => elements.every((element) => element.scrollHeight <= 17 && element.scrollWidth <= element.clientWidth)), `Speed summary wraps at ${width}px`);
	}
	const warning = structuredClone(state);
	warning.messages[1].usage = { input: 170000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, totalTokens: 170000 };
	await render(warning);
	assert.deepEqual(await page.locator(".voyage-weather-context p span").allTextContents(), ["当前占用 170k tok", "窗口上限 200k tok"]);
	assert(await page.locator(".voyage-weather-context").evaluate((element) => element.classList.contains("is-warning")));
	assert.equal(await page.locator(".voyage-weather-context .voyage-weather-ring-active").getAttribute("stroke-dasharray"), "85 100");
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		assert(await page.locator(".voyage-weather-context .voyage-weather-ring-active").evaluate((element) => {
			const probe = document.createElement("span");
			probe.style.color = "var(--color-warning)";
			document.body.append(probe);
			const matches = getComputedStyle(element).stroke === getComputedStyle(probe).color;
			probe.remove();
			return matches;
		}));
	}
	assert.equal(await page.locator(".voyage-weather-cache .voyage-weather-ring-active").count(), 0);
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "0.0%");
	assert.deepEqual(await page.locator(".voyage-weather-cache p span").allTextContents(), ["缓存创建 0 tok", "缓存读取 0 tok"]);
	const full = structuredClone(warning);
	full.messages[1].usage.input = full.messages[1].usage.totalTokens = 240000;
	await render(full);
	assert.equal(await page.locator(".voyage-weather-context .voyage-weather-ring-active").getAttribute("stroke-dasharray"), "100 100");
	full.messages[1].usage.input = full.messages[1].usage.totalTokens = 160000;
	await render(full);
	assert.equal(await page.locator(".voyage-weather-context.is-warning").count(), 0);
	assert.equal(await page.locator(".voyage-weather-context .voyage-weather-ring-active").getAttribute("stroke-dasharray"), "80 100");
	// Cache creation and reads both belong to full input; input plus output closes the bill.
	const cached = structuredClone(state);
	cached.model.contextWindow = 1000000;
	cached.messages[1].usage = { input: 3000, cacheRead: 85330, cacheWrite: 300, output: 3670, reasoning: 0, totalTokens: 92300 };
	await render(cached);
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "92.3k");
	assert.deepEqual(await page.locator(".voyage-weather-tokens p span").allTextContents(), ["输入 88.63k tok", "输出 3.67k tok"]);
	assert.deepEqual(await page.locator(".voyage-weather-context p span").allTextContents(), ["当前占用 92.3k tok", "窗口上限 1M tok"]);
	assert.deepEqual(await page.locator(".voyage-weather-cache p span").allTextContents(), ["缓存创建 300 tok", "缓存读取 85.33k tok"]);
	assert(await page.evaluate(() => { const { turn } = window.voyageHarness.metrics; return turn.cacheWrite === 300 && turn.newInput + turn.cacheRead === turn.input && turn.input + turn.output === turn.total; }));
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const width of [240, 260, 300, 480]) {
			await page.evaluate((width) => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", `${width}px`), width);
			assert(await page.locator(".voyage-weather-summary span").evaluateAll((elements) => elements.every((element) => element.scrollHeight <= 17 && element.scrollWidth <= element.clientWidth)), `Full usage summary overflows at ${width}px (${theme})`);
			if (width === 260) await page.locator(".voyage-telemetry").screenshot({ path: fileURLToPath(new URL(`${theme}-aligned-usage.png`, screenshots)), animations: "disabled" });
		}
	}
	const partial = structuredClone(cached);
	partial.isStreaming = true;
	partial.activeRun = { startedAt: await page.evaluate(() => Date.now()), promptId: "partial-accounting", turnId: "turn:user" };
	partial.messages.push({ id: "pending-output", role: "assistant", streaming: true, blocks: [{ kind: "text", text: "实时回答".repeat(20) }] });
	await render(partial);
	assert(await page.evaluate(() => { const { turn } = window.voyageHarness.metrics; return turn.input === 88630 && turn.output > 3670 && turn.input + turn.output === turn.total && turn.cacheWrite === 300; }));
	const zero = structuredClone(state);
	zero.messages[1].usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, totalTokens: 0 };
	await render(zero);
	assert.deepEqual(await page.locator(".voyage-weather-tokens p span").allTextContents(), ["输入 0 tok", "输出 0 tok"]);
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "0");
	assert.deepEqual(await page.locator(".voyage-weather-cache p span").allTextContents(), ["缓存创建 0 tok", "缓存读取 0 tok"]);
	assert.deepEqual(await page.evaluate(() => window.voyageHarness.metrics.telemetry.inputTrend), [0]);
	assert.equal(await page.locator(".voyage-weather-spark-point").count(), 1);
	// Cards stay on the current turn; cumulative usage is available only in details.
	const multi = structuredClone(state);
	multi.messages.push({ id: "u2", role: "user", blocks: [] }, { id: "a2", role: "assistant", blocks: [{ kind: "text", text: "done" }], durationMs: 2000, routeSnapshot: snapshot, usage: { input: 1000, cacheRead: 9000, cacheWrite: 0, output: 1000, reasoning: 0, totalTokens: 11000 } });
	multi.messages[1].performance = { fingerprint: "first", ttftMs: 1000, decodeMs: 1000, averageSpeed: 1600, averageEstimated: false };
	multi.messages[3].performance = { fingerprint: "second", ttftMs: 3000, decodeMs: 1000, averageSpeed: 1000, averageEstimated: false };
	await render(multi);
	assert.equal(await page.locator(".voyage-weather-speed p span").first().textContent(), "首字 3.0s");
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "11k");
	assert.deepEqual(await page.locator(".voyage-weather-tokens p span").allTextContents(), ["输入 10k tok", "输出 1k tok"]);
	assert.deepEqual(await page.evaluate(() => window.voyageHarness.metrics.telemetry.inputTrend), [2000, 1000]);
	const turnPath = await page.locator(".voyage-weather-spark-line").getAttribute("d");
	assert.match(turnPath, / C/);
	assert.equal(await page.locator(".voyage-weather-spark-point").getAttribute("cy"), "17");
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "90.0%");
	assert.equal(await page.locator(".voyage-weather-spark-line").getAttribute("d"), turnPath);
	await page.getByRole("button", { name: "Token 用量明细", exact: true }).click();
	assert.match(await page.locator(".voyage-telemetry-ledger").first().textContent(), /对话轮数 \/ Agent 步数1 \/ 1/);
	assert.match(await page.locator(".voyage-telemetry-ledger").first().textContent(), /本轮较上轮新增输入-1,000 tok/);
	const sessionLedger = await page.locator(".voyage-telemetry-ledger").nth(2).textContent();
	assert.match(sessionLedger, /对话轮数 \/ Agent 步数2 \/ 2/);
	assert.match(sessionLedger, /累计运行耗时/);
	assert.match(sessionLedger, /非缓存输入（含写入）3,000/);
	assert.match(sessionLedger, /输出（含思考）3,800/);
	assert.match(sessionLedger, /Token 合计47,800/);
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "缓存明细", exact: true }).click();
	assert.match(await page.locator(".voyage-telemetry-ledger").first().textContent(), /会话累计费用\$0\.029400/);
	assert.match(await page.locator(".voyage-telemetry-ledger").nth(1).textContent(), /累计缓存读取41,000累计命中率93\.18%/);
	await page.keyboard.press("Escape");
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "11k");
	assert.deepEqual(await page.locator(".voyage-weather-tokens p span").allTextContents(), ["输入 10k tok", "输出 1k tok"]);
	delete multi.messages[1].routeSnapshot;
	delete multi.messages[3].routeSnapshot;
	await render(multi);
	assert.deepEqual(await page.locator(".voyage-weather-cache p span").allTextContents(), ["缓存创建 0 tok", "缓存读取 9k tok"]);
	const unknownUsage = structuredClone(multi);
	for (const message of unknownUsage.messages) delete message.usage;
	await render(unknownUsage);
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "—");
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "—");
	assert.equal(await page.locator(".voyage-weather-cache .voyage-weather-ring.is-unknown").count(), 1);
	assert.equal(await page.locator(".voyage-weather-cache .voyage-weather-ring-active").count(), 0);
	assert.equal(await page.locator(".voyage-weather-spark-line").count(), 0);
	assert.equal(await page.locator(".voyage-weather-spark-point").count(), 0);
	// Restored multi-turn usage produces the same rising/flat/falling curve without a live sampler.
	const trend = { ...structuredClone(state), sessionId: "trend", messages: [2000, 1000, 4000, 4000, 8000, 3000].flatMap((input, index) => [{ id: `trend-u${index}`, role: "user", blocks: [] }, { id: `trend-a${index}`, role: "assistant", blocks: [{ kind: "text", text: "完成" }], usage: { input, cacheWrite: 0, cacheRead: 10000, output: 1000, totalTokens: input + 11000 } }]) };
	await render(trend);
	assert.deepEqual(await page.evaluate(() => window.voyageHarness.metrics.telemetry.inputTrend), [2000, 1000, 4000, 4000, 8000, 3000]);
	const restoredPath = await page.locator(".voyage-weather-spark-line").getAttribute("d");
	assert.equal(restoredPath.match(/C/g)?.length, 5);
	assert.match(await page.locator(".voyage-weather-spark-area").getAttribute("fill"), /^url\(#/);
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		await page.locator(".voyage-telemetry").screenshot({ path: fileURLToPath(new URL(`${theme}-turn-trend.png`, screenshots)), animations: "disabled" });
	}
	await render({ ...trend, sessionId: "restored-trend" });
	assert.equal(await page.locator(".voyage-weather-spark-line").getAttribute("d"), restoredPath);
	await render(multi);
	assert.equal(await page.locator(".voyage-weather-grid > section").count(), 4);
	assert.equal(await page.locator(".voyage-deck-companion .voyage-companion").count(), 1);
	await page.locator(".voyage-companion-stage").click();
	assert.equal(await page.locator(".voyage-companion-art").getAttribute("src"), "/companion/tap.webp");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(await page.locator(".voyage-weather-needle").evaluate((element) => getComputedStyle(element).transitionDuration), "0s");
	assert(await page.locator(".voyage-weather-ring-active").evaluateAll((elements) => elements.every((element) => getComputedStyle(element).transitionDuration === "0s")));
	await page.setViewportSize({ width: 360, height: 640 });
	await page.locator("dialog.voyage-dialog").waitFor();
	assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await page.getByRole("button", { name: "缓存明细", exact: true }).click();
	const panel = await page.locator(".voyage-telemetry-popover").boundingBox();
	assert(panel.x >= 0 && panel.x + panel.width <= 360);
	assert(await page.locator("dialog.voyage-dialog .voyage-telemetry-popover").isVisible());
	await page.keyboard.press("Escape");
	assert(await page.locator("dialog.voyage-dialog").isVisible());
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
	console.log("PASS telemetry bento: streaming/TTFT/decode, per-turn input trend/restoration/zero/unknown, current-turn cards/session ledgers, aligned summaries, ring ratios/tracks/warning/clamping/unknown/zero, click toggle/keyboard/Esc/outside/no hover popup, minimal header/fixed companion/legacy preferences, reduced motion, light/dark × 5 widths, mobile dialog and app previews");
} catch (error) {
	await page.screenshot({ path: fileURLToPath(new URL("failure.png", screenshots)), fullPage: true });
	throw error;
} finally { await browser.close(); }
