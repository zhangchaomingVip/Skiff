// Sample animation time directly so horizontal drift cannot hide between screenshots.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1424";
const screenshots = new URL("../features/014-voyage-panel-polish/screenshots/boat/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const sampleBoat = () => page.locator(".voyage-gauge-svg .voyage-scene-boat").evaluate((boat) => {
	const animation = boat.getAnimations()[0];
	if (!animation) throw new Error("Boat animation missing");
	animation.pause();
	return [0, .25, .5, .75, 1].map((fraction) => {
		animation.currentTime = Number(animation.effect.getTiming().duration) * fraction;
		const bounds = boat.getBoundingClientRect();
		const scene = boat.ownerSVGElement.getBoundingClientRect();
		return { x: bounds.x, y: bounds.y, width: bounds.width, sceneLeft: scene.left, sceneRight: scene.right };
	});
});

try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	for (const theme of ["light", "dark"]) for (const [width, height] of [[1200, 800], [360, 640]]) {
		await page.setViewportSize({ width, height });
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		let previousX;
		for (const phase of ["moored", "waiting", "thinking", "tool", "sailing"]) {
			const blocks = phase === "thinking" ? [{ kind: "thinking", text: "思考" }] : phase === "tool" ? [{ kind: "tool", id: "read", name: "read", argsText: "", done: true }] : phase === "sailing" ? [{ kind: "text", text: "正在输出" }] : [];
			const state = { sessionId: `${theme}-${width}-${phase}`, messages: [{ id: "user", role: "user", blocks: [] }, { id: "assistant", role: "assistant", streaming: phase !== "moored", blocks }],
				isStreaming: phase !== "moored", activeRun: phase === "moored" ? undefined : { startedAt: 1000, promptId: phase, turnId: "turn:user" } };
			await page.evaluate((state) => window.voyageHarness.render(state), state);
			await page.waitForTimeout(50);
			await page.locator(".voyage-gauge-svg").scrollIntoViewIfNeeded();
			const activity = phase === "moored" ? "moored" : phase === "sailing" ? "sailing" : "fishing";
			assert.equal(await page.evaluate(() => window.voyageHarness.metrics.activity), activity);
			assert.equal(await page.locator(".voyage-status-pill").textContent(), phase === "moored" ? "已停止" : "航行中");
			assert.equal(await page.locator(".voyage-status-pill .voyage-status-dot").getAttribute("class"), `voyage-status-dot ${phase === "moored" ? "stopped" : "running"}`);
			const samples = await sampleBoat();
			const drift = Math.max(...samples.map((sample) => sample.x)) - Math.min(...samples.map((sample) => sample.x));
			assert(drift < .1, `${theme} ${width} ${phase}: horizontal drift ${drift}px`);
			assert(samples.every((sample) => sample.x >= sample.sceneLeft && sample.x + sample.width <= sample.sceneRight), `${theme} ${width} ${phase}: boat outside gauge`);
			const bob = Math.max(...samples.map((sample) => sample.y)) - Math.min(...samples.map((sample) => sample.y));
			assert(bob > 0 && bob <= 3.1, `${theme} ${width} ${phase}: invalid vertical motion ${bob}px`);
			if (previousX !== undefined) assert(Math.abs(samples[0].x - previousX) < .1, `${theme} ${width}: phase change shifted boat`);
			previousX = samples[0].x;
			if (phase === "moored") await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}-moored.png`, screenshots)), fullPage: true, animations: "disabled" });
		}
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(await page.locator(".voyage-scene-boat").evaluate((boat) => getComputedStyle(boat).animationName), "none");
		assert.equal(await page.locator(".voyage-scene-boat").evaluate((boat) => getComputedStyle(boat).transform), "none");
		await page.emulateMedia({ reducedMotion: "no-preference" });
	}
	await page.evaluate(() => window.voyageHarness.unmount());
	assert.equal(await page.evaluate(() => window.voyageHarness.intervalCount()), 0);
	assert.deepEqual(errors, []);
	console.log("PASS boat: five animation samples x five states x two widths x two themes; fixed horizontal position, bounded vertical bob, stable phase transitions, reduced motion, cleanup; 4 screenshots");
} finally { await browser.close(); }
