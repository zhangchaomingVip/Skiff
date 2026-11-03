// Simulated bridge and controlled clock; never contacts pi or a provider.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1424";
const screenshots = new URL(process.argv[3] ?? "../features/014-voyage-panel-polish/screenshots/companion/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const user = { id: "user", role: "user", blocks: [], timestamp: 1000 };
const usage = (input, cacheRead = 0, cacheWrite = 0, output = 0) => ({ input, cacheRead, cacheWrite, output, reasoning: 0, totalTokens: 999999 });
const call = (id, name = "read") => ({ kind: "tool", id, name, argsText: "", done: true });
const result = (id, isError = false) => ({ kind: "toolResult", id, name: "read", text: "结果", isError });
const reply = (blocks, extra = {}) => ({ id: "reply", role: "assistant", blocks, streaming: true, ...extra });
const render = async (state) => { await page.evaluate((state) => window.voyageHarness.render(state), state); await page.waitForTimeout(60); };
const advance = async (ms) => { await page.evaluate((ms) => window.voyageHarness.advance(ms), ms); await page.waitForTimeout(40); };
const pose = () => page.locator(".voyage-companion").getAttribute("class");
const art = () => page.locator(".voyage-companion-art").getAttribute("src");
const capture = (name) => page.screenshot({ path: fileURLToPath(new URL(name, screenshots)), fullPage: true, animations: "disabled" });
const POSE = async (name) => assert.match(await pose(), new RegExp(`pose-${name}\\b`), `expected pose-${name}`);
let state = { messages: [], isStreaming: false, model: { id: "mock", provider: "mock", contextWindow: 1000 } };

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	// The stand-by loop is the default, on the light-weight 286 KB webp.
	await POSE("idle");
	assert((await art()).endsWith("/companion/idle.webp"));
	assert.equal(await page.locator(".voyage-companion-bubble").count(), 0);
	assert.equal(await page.locator(".voyage-companion-sound").getAttribute("aria-pressed"), "false");
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.voyage.sound.v1")), null);
	// The three action chips stay inside the 260px rail; sound lives in the header.
	assert.equal(await page.locator(".voyage-companion-chip").count(), 3);
	assert(await page.locator(".voyage-companion-chip").evaluateAll((elements) => elements.every((element) => element.scrollWidth <= element.clientWidth)));
	assert(await page.locator(".voyage-companion-actions").evaluate((element) => element.getBoundingClientRect().width <= element.parentElement.getBoundingClientRect().width));

	// A click pets the navigator: the tap frame plays, the pose stays put, then the
	// pose art returns on its own.
	await page.locator(".voyage-companion-stage").click();
	await page.waitForTimeout(120);
	await POSE("idle");
	assert((await art()).endsWith("/companion/tap.webp"));
	await page.waitForTimeout(700);
	await POSE("idle");
	assert((await art()).endsWith("/companion/idle.webp"));

	// Waiting for the first token is a nap with drifting z's.
	state = { ...state, isStreaming: true, activeRun: { startedAt: 1000, promptId: "pose", turnId: "turn:user" }, messages: [user, reply([{ kind: "thinking", text: "思考" }])] };
	await render(state); await advance(100);
	await POSE("sleep");
	assert((await art()).endsWith("/companion/sleep.webp"));
	assert.equal(await page.locator(".voyage-companion-bubble").count(), 1);
	assert.equal(await page.locator(".voyage-companion-bubble").textContent(), "z z");
	await capture("light-1200-sleep.png");

	// Flowing reply text is a happy hop.
	state.messages[1] = reply([{ kind: "text", text: "思考回复" }]);
	await render(state); await advance(100);
	await POSE("happy");
	assert((await art()).endsWith("/companion/happy.webp"));
	assert.equal(await page.locator(".voyage-companion-bubble").count(), 0);

	// A running tool means eating context.
	state.messages[1] = reply([{ kind: "text", text: "思考回复" }, call("pose-tool")]);
	await render(state); await advance(100);
	await POSE("eat");
	assert((await art()).endsWith("/companion/eat.webp"));
	assert.equal(await page.locator(".voyage-tool-active").count(), 1);

	// A failed tool is a reason to stomp.
	state.messages[1] = reply([{ kind: "text", text: "思考回复" }, call("pose-tool"), result("pose-tool", true)], { streaming: false });
	state.messages.push(reply([{ kind: "text", text: "失败" }], { id: "after-failure", streaming: false, usage: usage(100, 40, 10, 20) }));
	state.isStreaming = false; delete state.activeRun;
	await render(state);
	await POSE("angry");
	assert((await art()).endsWith("/companion/angry.webp"));
	assert.equal(await page.locator(".voyage-tool-log summary").textContent(), "航海日志 · 1 项已入日志（1 次失败）");
	await capture("light-1200-angry.png");

	// An overloaded context frowns even mid-sail.
	state = { ...state, isStreaming: true, model: { ...state.model, contextWindow: 100 }, activeRun: { startedAt: 1000, promptId: "overload", turnId: "turn:user" },
		messages: [user, reply([{ kind: "text", text: "很长的回复" }], { usage: usage(90, 0, 0, 5) })] };
	await render(state); await advance(100);
	assert.equal((await page.evaluate(() => window.voyageHarness.metrics)).ratio, .95);
	await POSE("angry");

	// A warm cache earns a happy rest, a cold one keeps the plain standby.
	state = { ...state, isStreaming: false, model: { ...state.model, contextWindow: 1000 }, messages: [user, reply([{ kind: "text", text: "完成" }], { streaming: false, usage: usage(20, 80, 0, 20) })] };
	delete state.activeRun;
	await render(state);
	await POSE("happy");
	state.messages = []; await render(state);
	await POSE("idle");

	// Chips borrow the stage for four seconds, then live progress wins it back.
	await page.getByRole("button", { name: "投喂", exact: true }).click();
	await page.waitForTimeout(80);
	await POSE("eat");
	assert.equal(await page.locator(".voyage-companion-chip.chip-eat").evaluate((element) => element.classList.contains("is-active")), true);
	assert.equal(await page.locator(".voyage-companion [role=status]").textContent(), "投喂小鱼 · 专注 · 吞噬数据");
	await page.waitForTimeout(4200);
	await POSE("idle");
	assert.equal(await page.locator(".voyage-companion-chip.is-active").count(), 1);

	// A double click squashes the body, then three seconds of stomping.
	await page.locator(".voyage-companion-stage").dblclick();
	await page.waitForTimeout(120);
	await POSE("angry");
	assert.equal(await page.locator(".voyage-companion [role=status]").textContent(), "领航员被捏扁了，正在跺脚");
	await page.waitForTimeout(3200);
	await POSE("idle");

	// Sound is opt-in, remembered, and never needed for the deck to work.
	const sound = page.locator(".voyage-companion-sound");
	await sound.click();
	assert.equal(await sound.getAttribute("aria-pressed"), "true");
	assert.equal(await sound.getAttribute("aria-label"), "关闭互动音效");
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.voyage.sound.v1")), "on");
	await page.reload();
	await page.waitForFunction(() => window.voyageHarness?.render);
	assert.equal(await page.locator(".voyage-companion-sound").getAttribute("aria-pressed"), "true");
	await page.locator(".voyage-companion-sound").click();
	assert.equal(await page.evaluate(() => localStorage.getItem("skiff.voyage.sound.v1")), "off");

	// Reduced motion keeps a still navigator and drops the drifting bubbles.
	await page.emulateMedia({ reducedMotion: "reduce" });
	state = { ...state, messages: [user, reply([{ kind: "thinking", text: "思考" }])], isStreaming: true, activeRun: { startedAt: 1000, promptId: "calm", turnId: "turn:user" } };
	await render(state); await advance(100);
	await POSE("still");
	assert((await art()).endsWith("/companion/idle.png"));
	assert.equal(await page.locator(".voyage-companion-bubble").count(), 0);
	await page.getByRole("button", { name: "鼓励", exact: true }).click();
	await page.waitForTimeout(80);
	await POSE("still");
	await capture("light-1200-reduced.png");
	await page.emulateMedia({ reducedMotion: "no-preference" });

	// Both themes and the narrow dialog keep the stage and chips inside.
	state = { ...state, isStreaming: false, messages: [] }; delete state.activeRun; await render(state);
	for (const theme of ["light", "dark"]) {
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		for (const [width, height] of [[1200, 800], [360, 640]]) {
			await page.setViewportSize({ width, height }); await page.waitForTimeout(80);
			assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			assert(await page.locator(".voyage-deck").evaluate((element) => element.scrollWidth <= element.clientWidth));
			assert(await page.locator(".voyage-companion").evaluate((element) => element.scrollWidth <= element.clientWidth));
			// The chips stay inside the deck floor at every width: no clipping, no scrollbar.
			const deck = await page.locator(".voyage-deck").boundingBox();
			const chips = await page.locator(".voyage-companion-actions").boundingBox();
			assert(chips.y + chips.height <= deck.y + deck.height + 1, `${theme} ${width}: chips overflow the deck (${chips.y + chips.height} > ${deck.y + deck.height})`);
			await page.locator(".voyage-companion-actions").scrollIntoViewIfNeeded();
			await capture(`${theme}-${width}-stage.png`);
		}
	}
	assert.deepEqual(errors, []);
	console.log("PASS companion: idle/sleep/happy/eat/failure/overload poses, cache-hit rest, chips, squash, opt-in sound persistence, reduced motion, 2 themes x 2 widths; 6 screenshots");
	console.log(`Browser: ${browser.version()}`);
} catch (error) {
	await capture("failure.png");
	throw error;
} finally { await browser.close(); }
