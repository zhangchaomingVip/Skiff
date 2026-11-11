// Presentation regressions use synthetic usage and an isolated Vite origin only.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const { chromium } = createRequire(new URL("../.playwright-cli/package.json", import.meta.url))("playwright-core");
const base = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../.playwright-cli/voyage-bento-ux/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const render = async (state) => {
	await page.evaluate((state) => window.voyageHarness.render(state), state);
	await page.waitForTimeout(50);
};
const user = (id) => ({ id, role: "user", blocks: [] });
const reply = (id, input, cacheRead, cacheWrite = 0) => ({ id, role: "assistant", blocks: [{ kind: "text", text: "已完成" }], usage: { input, cacheRead, cacheWrite, output: 100, totalTokens: input + cacheRead + cacheWrite + 100 } });
const state = { sessionId: "multi-step", model: { id: "mock", provider: "mock", contextWindow: 128000 }, isStreaming: false, messages: [
	user("first"), reply("a1", 0, 8000), user("next"), reply("step1", 1000, 100000), reply("step2", 2000, 102000), reply("step3", 3000, 104000),
] };

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	await render(state);
	assert.equal(await page.locator(".voyage-weather-tokens strong").textContent(), "+6.3k");
	assert.deepEqual(await page.locator(".voyage-weather-tokens p > span").allTextContents(), ["输出 300 · 新增输入 6k", "总吞吐 312.3k (含缓存)"]);
	const tokenButton = page.getByRole("button", { name: "Token 用量明细", exact: true });
	assert.match(await tokenButton.getAttribute("title"), /含 3 步往返.*非缓存输入（含写入）6k tok/);
	assert.match(await tokenButton.getAttribute("title"), /当前标记为第 2 轮/);
	await tokenButton.focus();
	await page.keyboard.press("Enter");
	assert.equal(await page.locator(".voyage-telemetry-input-highlight strong").textContent(), "6k tok");
	assert.match(await page.getByRole("dialog", { name: "本轮进程与用量" }).textContent(), /本轮含 3 步模型往返/);
	assert.match(await page.locator(".voyage-telemetry-note").first().textContent(), /缓存读取也可能计费/);
	await page.keyboard.press("Escape");
	assert(await tokenButton.evaluate((element) => element === document.activeElement));
	assert.equal(await page.locator(".voyage-weather-speed p > span").last().textContent(), "峰值暂无");
	assert.equal(await page.locator(".voyage-weather-ring").count(), 1);
	assert.equal(await page.locator(".voyage-weather-capacity").count(), 1);
	assert(await page.locator(".voyage-weather-ring").evaluate((element) => element.getBoundingClientRect().width === 54 && element.getBoundingClientRect().height === 54));
	assert(await page.locator(".voyage-weather-capacity").evaluate((element) => {
		const style = getComputedStyle(element);
		return element.getBoundingClientRect().height === 8 && parseFloat(style.borderRadius) >= 100 && style.outlineStyle === "none" && element.tabIndex === -1 && !element.querySelector("svg, path, rect");
	}));
	assert.equal(await page.locator(".voyage-weather-spark-point.is-current").count(), 1);
	assert.equal(await page.locator(".voyage-weather-spark-halo").count(), 1);
	assert.equal(await page.locator(".voyage-weather-trend-caption").count(), 0);
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const [width, height] of [[600, 400], [900, 700], [1200, 800]]) {
			await page.setViewportSize({ width, height });
			await page.waitForTimeout(100);
			assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			assert(await page.locator(".voyage-weather-card").evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth)));
			assert(await page.locator(".voyage-weather-grid").evaluate((element) => {
				const grid = element.getBoundingClientRect();
				const rail = element.closest(".voyage-rail").getBoundingClientRect();
				return grid.top >= rail.top && grid.bottom <= rail.bottom;
			}), "All four cards must be visible without scrolling");
			const geometry = await page.evaluate(() => {
				const center = (element) => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; };
				const tokens = document.querySelector(".voyage-weather-tokens");
				const context = document.querySelector(".voyage-weather-context");
				const cache = document.querySelector(".voyage-weather-cache");
				const chart = tokens.querySelector(".voyage-weather-spark");
				// A zero-to-peak fixture spans the chart's complete value range.
				const line = chart.querySelector(".voyage-weather-spark-line");
				const bounds = line.getBBox();
				const plotCenter = new DOMPoint(50, bounds.y + bounds.height / 2).matrixTransform(chart.getScreenCTM()).y;
				const cacheReading = cache.querySelector(".voyage-weather-reading");
				const ring = cache.querySelector(".voyage-weather-ring");
				const isSideBySide = getComputedStyle(cacheReading).gridColumnStart === "1";
				return {
					unitGap: parseFloat(getComputedStyle(tokens.querySelector(".voyage-weather-reading")).columnGap),
					cacheGap: parseFloat(getComputedStyle(cacheReading).columnGap),
					ringWidth: ring.getBoundingClientRect().width,
					ringHeight: ring.getBoundingClientRect().height,
					isSideBySide,
					opticalOffset: center(ring) - center(cacheReading.querySelector("strong")),
					plotBaseline: plotCenter - tokens.getBoundingClientRect().top,
					capacityBaseline: center(context.querySelector(".voyage-weather-capacity")) - context.getBoundingClientRect().top,
				};
			});
			assert.equal(geometry.unitGap, 3);
			assert.equal(geometry.cacheGap, 4);
			assert(Math.abs(geometry.ringWidth - 54) < .01);
			assert(Math.abs(geometry.ringHeight - 54) < .01);
			assert(Math.abs(geometry.plotBaseline - geometry.capacityBaseline) < .5, JSON.stringify(geometry));
			if (geometry.isSideBySide) assert(Math.abs(geometry.opticalOffset + 2) < .5, JSON.stringify(geometry));
			await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}x${height}.png`, output)), animations: "disabled" });
			await tokenButton.click();
			const box = await page.getByRole("dialog", { name: "本轮进程与用量" }).boundingBox();
			assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, JSON.stringify(box));
			await page.keyboard.press("Escape");
		}
	}
	// Waiting on another turn must not relabel a retained three-step reading as one step.
	const pending = { ...structuredClone(state), isStreaming: true, activeRun: { startedAt: 1000, promptId: "waiting", turnId: "turn:pending" } };
	pending.messages.push(user("pending"));
	await render(pending);
	assert.match(await tokenButton.getAttribute("title"), /最近一轮.*含 3 步往返.*第 2 轮/);
	await render({ ...pending, sessionId: "reopen" });
	assert.match(await tokenButton.getAttribute("title"), /最近一轮.*含 3 步往返.*非缓存输入（含写入）6k tok/);
	// A preparation ring is descriptive, never a fabricated hit percentage.
	const preparing = { ...structuredClone(state), sessionId: "preparing", messages: [user("first"), reply("write", 1000, 0, 150000)] };
	await render(preparing);
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "写入准备");
	assert.equal(await page.locator(".voyage-weather-cache .voyage-weather-reading small").count(), 0);
	assert.equal(await page.locator(".voyage-weather-ring.is-building").count(), 1);
	assert.equal(await page.locator(".voyage-weather-ring-active").count(), 0);
	assert.equal(await page.locator(".voyage-weather-ring.is-preparing").count(), 0);
	preparing.isStreaming = true;
	preparing.activeRun = { startedAt: 1000, promptId: "write", turnId: "turn:first" };
	preparing.messages.push({ id: "pending-step", role: "assistant", streaming: true, blocks: [] });
	await render(preparing);
	assert.equal(await page.locator(".voyage-weather-ring.is-preparing").count(), 1);
	assert.equal(await page.locator(".voyage-weather-ring-preparation").evaluate((element) => getComputedStyle(element).animationName), "voyage-cache-prepare");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(await page.locator(".voyage-weather-ring-preparation").evaluate((element) => getComputedStyle(element).animationName), "none");
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		await page.locator(".voyage-telemetry").screenshot({ path: fileURLToPath(new URL(`${theme}-preparation.png`, output)), animations: "disabled" });
	}
	await render({ ...preparing, sessionId: "read-and-write", isStreaming: false, messages: [user("first"), reply("read-write", 1000, 9000, 500)] });
	assert.equal(await page.locator(".voyage-weather-cache strong").textContent(), "85.7%");
	assert.equal(await page.locator(".voyage-weather-ring.is-building").count(), 0);
	// Verify real app layout and its narrow-screen dialog at the requested sizes too.
	for (const theme of ["light", "dark"]) for (const [width, height] of [[600, 400], [900, 700], [1200, 800]]) {
		await page.setViewportSize({ width, height });
		await page.goto(`${base}/tests/preview.html?theme=${theme}&fixture=voyage-moored`);
		await page.getByRole("button", { name: "航行台", exact: true }).click();
		await page.locator(".voyage-weather-grid").waitFor();
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		assert(await page.locator(".voyage-weather-card").evaluateAll((cards) => cards.every((card) => card.scrollWidth <= card.clientWidth)));
		assert(await page.locator(".voyage-weather-grid").evaluate((element) => element.getBoundingClientRect().bottom <= element.closest(".voyage-rail").getBoundingClientRect().bottom));
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-app-${width}x${height}.png`, output)), animations: "disabled" });
	}
	assert.deepEqual(errors, []);
	console.log("PASS bento UX: multi-step/non-cached explanation, retained/reopened scope, peak fallback, capacity + donut, current-turn halo, preparation/read transition, reduced motion, keyboard/popover bounds, app and harness light/dark × 600×400/900×700/1200×800");
} catch (error) {
	await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)), fullPage: true });
	throw error;
} finally { await browser.close(); }
