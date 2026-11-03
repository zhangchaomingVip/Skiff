// Mock bridge only: checks the portal composition without pi or real credentials.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.argv[2] ?? "http://localhost:1421";
const screenshots = new URL(process.argv[3] ?? "../.playwright-cli/portal/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const render = async (state) => {
	await page.evaluate((state) => window.voyageHarness.render(state), state);
	await page.waitForTimeout(80);
};
const capture = (name) => page.locator(".voyage-dashboard").screenshot({ path: fileURLToPath(new URL(name, screenshots)), animations: "disabled" });
const state = {
	messages: [{ id: "user", role: "user", blocks: [], timestamp: 1000 }, {
		id: "reply", role: "assistant", streaming: true, blocks: [{ kind: "text", text: "航行中" }],
	}],
	isStreaming: true, activeRun: { startedAt: 1000, promptId: "portal", turnId: "turn:user" },
	model: { id: "preview", provider: "mock", contextWindow: 128000 },
};

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	// Missing measurements stay missing and do not create empty detail rows.
	assert.equal(await page.locator(".voyage-portal-trend .voyage-spark.is-ambient").count(), 1);
	assert.equal(await page.locator(".voyage-portal-phases .voyage-phase-bar > span").count(), 0);
	assert.equal(await page.locator(".voyage-portal-phases .voyage-phase-legend").count(), 0);
	assert.equal(await page.locator(".voyage-portal-avatar").count(), 0);
	assert.equal(await page.locator(".voyage-mood-text").textContent(), "顺风巡航 · 空闲");
	assert.equal(await page.locator(".voyage-companion-actions button").count(), 3);
	assert.equal(await page.locator(".voyage-companion-actions .voyage-companion-sound").count(), 0);
	assert.equal(await page.locator(".voyage-dashboard-header .voyage-companion-sound").count(), 1);
	await page.getByRole("button", { name: "开启互动音效", exact: true }).click();
	assert.equal(await page.getByRole("button", { name: "关闭互动音效", exact: true }).getAttribute("aria-pressed"), "true");
	await page.reload();
	await page.waitForFunction(() => window.voyageHarness?.render);
	await page.getByRole("button", { name: "关闭互动音效", exact: true }).click();
	assert.equal(await page.getByRole("button", { name: "开启互动音效", exact: true }).getAttribute("aria-pressed"), "false");
	await render(state);
	for (let step = 0; step < 6; step++) {
		state.messages[1].blocks[0].text += "顺风航行";
		await render(state);
		await page.evaluate(() => window.voyageHarness.advance(100));
	}
	const trail = await page.locator(".voyage-portal-trend .voyage-spark-line").getAttribute("points");
	assert(trail, "live speed samples replace the decorative wave");
	state.messages[1].streaming = false;
	state.messages[1].usage = { input: 4000, cacheRead: 62000, cacheWrite: 0, output: 500, reasoning: 0 };
	state.isStreaming = false;
	delete state.activeRun;
	await render(state);
	assert.equal(await page.locator(".voyage-portal-trend .voyage-spark.is-ambient").count(), 0);
	assert.equal(await page.locator(".voyage-portal-trend .voyage-spark-line").getAttribute("points"), trail);
	assert.equal(await page.locator(".voyage-card-dial .voyage-spark").count(), 0);
	assert.equal(await page.locator(".voyage-portal-trend .voyage-spark-line").count(), 1);
	assert.equal(await page.locator(".voyage-portal-phases .voyage-phase-bar").count(), 1);
	assert.equal(await page.locator(".voyage-orbit-log .voyage-phase-section").count(), 0);

	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		for (const width of [240, 260, 360, 480]) {
			await page.evaluate((width) => document.querySelector(".chat-and-rail").style.setProperty("--voyage-width", `${width}px`), width);
			await page.waitForTimeout(80);
			const layout = await page.evaluate(() => {
				const rect = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
				return {
					header: rect(".voyage-dashboard-header"), left: rect(".voyage-portal-status"),
					centre: rect(".voyage-portal-vitals"), right: rect(".voyage-card-dial"),
					art: rect(".voyage-companion-art"), actions: rect(".voyage-companion-actions"),
					deck: rect(".voyage-deck-companion"),
					trend: rect(".voyage-portal-trend"), phases: rect(".voyage-portal-phases"),
					chips: [...document.querySelectorAll(".voyage-companion-chip")].map((element) => element.getBoundingClientRect().toJSON()),
				};
			});
			const { header, left, centre, right, art, actions, chips, deck, trend, phases } = layout;
			const context = `${theme} / ${width}px: ${JSON.stringify(layout)}`;
			assert(left.top > header.bottom, context);
			assert(Math.abs(left.top - right.top) < 1 && Math.abs(left.height - right.height) < 1, context);
			assert(centre.top >= Math.max(left.bottom, right.bottom), context);
			assert(trend.top >= left.top && trend.bottom <= left.bottom, context);
			assert(phases.top >= right.top && phases.bottom <= right.bottom, context);
			assert(await page.locator(".voyage-portal-status > .voyage-portal-trend").count() === 1, context);
			assert(await page.locator(".voyage-card-dial > .voyage-portal-phases").count() === 1, context);
			assert.equal(await page.locator(".voyage-bento > section").count(), 3, context);
			assert(centre.bottom + 32 <= art.top, context);
			assert(left.height + centre.height < 200, context);
			if (width === 480) assert(art.width >= 352 * 1.2, context);
			assert(actions.top >= art.bottom + 8, context);
			assert(chips.every((chip, index) => Math.abs(chip.top - chips[0].top) < 1 && (index === 0 || chip.left > chips[index - 1].right)), context);
			assert(Math.abs(deck.left + deck.width / 2 - art.left - art.width / 2) < 1, context);
			assert(Math.abs(deck.left + deck.width / 2 - actions.left - actions.width / 2) < 1, context);
			assert(art.bottom <= deck.bottom && actions.bottom <= deck.bottom, context);
			assert(await page.locator(".voyage-dashboard").evaluate((element) => element.querySelector(".voyage-companion-actions").getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom), context);
			assert(await page.locator(".voyage-card-dial").evaluate((element) => element.querySelector(".voyage-gauge-readout").getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom - 4), context);
			assert(await page.locator(".voyage-title").evaluate((element) => element.scrollWidth <= element.clientWidth), context);
			assert(await page.locator(".voyage-portal-card,.voyage-companion-chip").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), context);
			await capture(`${theme}-${width}.png`);
			await render({ ...state, messages: [state.messages[0], { ...state.messages[1], usage: { input: 0, cacheRead: 128000, cacheWrite: 0, output: 0, reasoning: 0 } }] });
			assert(await page.locator(".voyage-dial-value").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)), context);
			await render(state);
		}
	}

	// Phase details are folded into the speed card and expand on demand.
	const timeline = { key: "turn:user", startedAt: 1000, at: 15000, endedAt: 15000, phase: "response", durationMs: 14000,
		thinkingMs: 4000, toolMs: 6000, segments: [
			{ phase: "thinking", startedAt: 1000, endedAt: 5000 },
			{ phase: "tool", startedAt: 5000, endedAt: 11000 },
			{ phase: "response", startedAt: 11000, endedAt: 15000 },
		], tools: [], batches: [], completedCount: 0, seenResults: [] };
	await render({ ...state, voyageTimeline: timeline });
	assert.equal(await page.locator(".voyage-portal-phases").getAttribute("open"), null);
	await page.locator(".voyage-portal-phases > summary").click();
	assert.equal(await page.locator(".voyage-portal-phases").getAttribute("open"), "");
	assert.deepEqual(await page.locator(".voyage-portal-phases .voyage-phase-value").allTextContents(), ["4s", "4s", "6s"]);
	const bars = await page.locator(".voyage-portal-phases .voyage-phase-bar > span").evaluateAll((elements) => elements.map((element) => Number.parseFloat(element.style.width)));
	assert(Math.abs(bars[0] - 4000 / 14000 * 100) < .01 && bars[1] > bars[0]);
	assert(await page.locator(".voyage-companion-art").evaluate((element) => element.getBoundingClientRect().top >= document.querySelector(".voyage-bento").getBoundingClientRect().bottom + 32));
	await render({ ...state, voyageTimeline: { ...timeline, thinkingMs: 0, toolMs: 0, segments: [{ phase: "response", startedAt: 1000, endedAt: 15000 }] } });
	assert.equal(await page.locator(".voyage-portal-phases .voyage-phase-legend").count(), 0);
	assert.equal(await page.locator(".voyage-portal-phases .voyage-phase-bar > span").count(), 1);

	// The mobile drawer and both complete-app previews use the same composition.
	await page.setViewportSize({ width: 360, height: 640 });
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await page.locator(".voyage-companion-actions").scrollIntoViewIfNeeded();
		assert(await page.getByRole("button", { name: "投喂", exact: true }).isVisible());
		await capture(`${theme}-drawer.png`);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${base}/tests/preview.html?theme=${theme}&fixture=voyage-moored`);
		await page.getByRole("button", { name: "航行台", exact: true }).click();
		await page.locator(".voyage-portal-vitals").waitFor();
		assert.equal(await page.locator(".voyage-companion-chip").count(), 3);
		await capture(`${theme}-app.png`);
		await page.getByRole("separator", { name: "调整右侧航行台宽度" }).press("End");
		await page.waitForTimeout(80);
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-workspace.png`, screenshots)), animations: "disabled" });
	}
	assert.deepEqual(errors, []);
	console.log("PASS portal: two instrument rows, embedded trend/duration, enlarged raised character, 32px headroom, Dock and expandable phases; 2 themes × 4 rail widths, drawer and app previews");
} finally {
	await browser.close();
}
