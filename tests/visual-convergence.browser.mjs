// Feature 020: actual SVG geometry and real app layout, using only simulated pi.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { contrast } from "../scripts/check-styles.mjs";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://127.0.0.1:1424";
const screenshots = new URL("../features/020-voyage-visual-convergence/screenshots/", import.meta.url);
await fs.mkdir(screenshots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
const errors = [];
const evidence = { browser: browser.version(), geometry: [], layouts: [], controls: [] };
page.on("pageerror", (error) => errors.push(error.message));
try {
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	await page.evaluate(() => document.fonts.ready);
	let samples = 0;
	for (const theme of ["dark", "light"]) for (const width of [240, 260, 480]) {
		await page.evaluate(({ theme, width }) => {
			document.documentElement.dataset.theme = theme;
			document.querySelector(".chat-and-rail").style.gridTemplateColumns = `minmax(0, 1fr) ${width}px`;
		}, { theme, width });
		const result = await page.evaluate(() => {
			const failures = [];
			const appearance = [];
			const fonts = [];
			const hex = (color) => "#" + color.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
			const background = hex(getComputedStyle(document.querySelector(".voyage-rail")).backgroundColor);
			const needle = document.querySelector(".voyage-gauge-needle");
			const svg = document.querySelector(".voyage-gauge-svg");
			const boat = document.querySelector(".voyage-scene-boat");
			const point = (matrix, x, y) => new DOMPoint(x, y).matrixTransform(matrix);
			const box = (el) => {
				if (!(el instanceof SVGGraphicsElement)) return el.getBoundingClientRect();
				const b = el.getBBox(), m = el.getScreenCTM();
				const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => point(m, x, y));
				return { left: Math.min(...corners.map((p) => p.x)), right: Math.max(...corners.map((p) => p.x)), top: Math.min(...corners.map((p) => p.y)), bottom: Math.max(...corners.map((p) => p.y)) };
			};
			// Liang–Barsky: test the segment itself, with half-stroke clearance.
			const intersects = (a, b, rect, padding = 0) => {
				let low = 0, high = 1;
				const dx = b.x - a.x, dy = b.y - a.y;
				for (const [p, q] of [[-dx, a.x - rect.left + padding], [dx, rect.right - a.x + padding], [-dy, a.y - rect.top + padding], [dy, rect.bottom - a.y + padding]]) {
					if (Math.abs(p) < 1e-8) { if (q < 0) return false; }
					else { const t = q / p; if (p < 0) low = Math.max(low, t); else high = Math.min(high, t); if (low > high) return false; }
				}
				return true;
			};
			const inTriangle = (p, [a, b, c]) => {
				const cross = (u, v, w) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
				const signs = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
				return signs.every((v) => v >= 0) || signs.every((v) => v <= 0);
			};
			const triangleHits = (triangle, rect) => triangle.some((a, i) => intersects(a, triangle[(i + 1) % 3], rect)) || [[rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]].some(([x, y]) => inTriangle({ x, y }, triangle));
			const text = [...document.querySelectorAll(".voyage-gauge-label, .voyage-gauge-number, .voyage-gauge-unit, .voyage-gauge-limit")];
			for (const el of text) {
				let opacity = 1;
				for (let parent = el; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
				if (opacity !== 1) failures.push(`text opacity ${opacity}`);
				const m = el instanceof SVGGraphicsElement ? el.getScreenCTM() : { a: 1, b: 0 };
				const size = parseFloat(getComputedStyle(el).fontSize) * Math.hypot(m.a, m.b);
				fonts.push(size);
				appearance.push({ foreground: hex(el instanceof SVGGraphicsElement ? getComputedStyle(el).fill : getComputedStyle(el).color), background, minimum: 4.5 });
				if (size < 11) failures.push(`rendered font ${size}`);
			}
			for (const selector of [".voyage-gauge-track", ".voyage-gauge-ticks"]) {
				appearance.push({ foreground: hex(getComputedStyle(document.querySelector(selector)).stroke), background, minimum: 3 });
				for (let el = document.querySelector(selector); el; el = el.parentElement) if (Number(getComputedStyle(el).opacity) !== 1) failures.push(`track/ticks opacity: ${selector}`);
			}
			if (getComputedStyle(needle).transformOrigin !== "130px 130px") failures.push("needle origin");
			let count = 0;
			for (const bob of [0, -3]) {
				boat.style.transform = `translateY(${bob}px)`;
				for (let step = 0; step <= 20; step++) {
					needle.style.transform = `rotate(${-90 + step / 20 * 180}deg)`;
					const m = needle.getScreenCTM(), line = needle.querySelector("line");
					const start = point(m, line.x1.baseVal.value, line.y1.baseVal.value), end = point(m, line.x2.baseVal.value, line.y2.baseVal.value);
					const hub = point(svg.getScreenCTM(), 130, 130);
					if (Math.hypot(start.x - hub.x, start.y - hub.y) > .01) failures.push(`hub detached ${step}`);
					const local = end.matrixTransform(svg.getScreenCTM().inverse());
					if (Math.abs(Math.hypot(local.x - 130, local.y - 130) - 80) > .01) failures.push(`tip radius ${step}`);
					if ([0, 10, 20].includes(step)) {
						const expected = { 0: [50, 130], 10: [130, 50], 20: [210, 130] }[step];
						if (Math.hypot(local.x - expected[0], local.y - expected[1]) > .01) failures.push(`tip endpoint ${step}`);
					}
					const coords = needle.querySelector("path").getAttribute("d").match(/-?\d+(?:\.\d+)?/g).map(Number);
					const triangle = [0, 2, 4].map((i) => point(m, coords[i], coords[i + 1]));
					const halfStroke = parseFloat(getComputedStyle(line).strokeWidth) * Math.hypot(m.a, m.b) / 2;
					for (const el of [...text, boat]) if (intersects(start, end, box(el), halfStroke) || triangleHits(triangle, box(el))) failures.push(`collision ${step}: ${el.getAttribute("class")}`);
					const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
					if (!intersects(start, end, { left: mid.x - 1, right: mid.x + 1, top: mid.y - 1, bottom: mid.y + 1 })) failures.push("broken collision detector");
					count++;
				}
			}
			boat.style.removeProperty("transform");
			return { failures, count, width: document.querySelector(".voyage-rail").getBoundingClientRect().width, appearance, minimumFont: Math.min(...fonts) };
		});
		assert.deepEqual(result.failures, [], `${theme}/${width}: ${result.failures.join(", ")}`);
		assert.equal(result.width, width);
		for (const row of result.appearance) assert(contrast(row.foreground, row.background) >= row.minimum, JSON.stringify(row));
		evidence.geometry.push({ theme, width, samples: result.count, minimumFont: result.minimumFont, appearance: result.appearance });
		samples += result.count;
	}
	// Inspect the real animation at its greatest displacement, separately from reduced motion.
	await page.emulateMedia({ reducedMotion: "no-preference" });
	const animation = await page.locator(".voyage-scene-boat").evaluate((el) => {
		const animation = el.getAnimations().find((a) => a.animationName === "voyage-boat-bob");
		animation.pause(); animation.currentTime = 900;
		return { dy: new DOMMatrix(getComputedStyle(el).transform).f, layout: el.parentElement.getAttribute("transform") };
	});
	assert.equal(animation.dy, -3);
	assert.equal(animation.layout, "translate(22 12)");
	await page.emulateMedia({ reducedMotion: "reduce" });
	assert.equal(await page.locator(".voyage-scene-boat").evaluate((el) => el.getAnimations().length), 0);

	for (const theme of ["dark", "light"]) for (const width of [1200, 360, 2200]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`${base}/tests/preview.html?fixture=visual&theme=${theme}&static=1`);
		await page.locator(".composer").waitFor();
		await page.locator(".msg.assistant").first().waitFor();
		await page.evaluate(() => document.fonts.ready);
		await page.waitForFunction(() => {
			const header = document.querySelector(".chat-header"), composer = document.querySelector(".composer");
			return Math.abs(header.getBoundingClientRect().left + parseFloat(getComputedStyle(header).paddingLeft) - composer.getBoundingClientRect().left) < 1;
		});
		const layout = await page.evaluate(() => {
			const header = document.querySelector(".chat-header"), composer = document.querySelector(".composer"), message = document.querySelector(".msg.assistant");
			return { header: header.getBoundingClientRect().left + parseFloat(getComputedStyle(header).paddingLeft), composer: composer.getBoundingClientRect().left, message: message.getBoundingClientRect().left, overflow: document.documentElement.scrollWidth > innerWidth, composerOverflow: composer.scrollWidth > composer.clientWidth, headerOverlap: document.querySelector(".header-title").getBoundingClientRect().right > document.querySelector(".header-actions").getBoundingClientRect().left && document.querySelector(".header-title").getBoundingClientRect().bottom > document.querySelector(".header-actions").getBoundingClientRect().top };
		});
		assert(Math.abs(layout.message - layout.composer) < 1, JSON.stringify(layout));
		assert.equal(layout.overflow, false, JSON.stringify(layout));
		assert.equal(layout.composerOverflow, false, JSON.stringify(layout));
		assert.equal(layout.headerOverlap, false, JSON.stringify(layout));
		evidence.layouts.push({ theme, width, ...layout });
		assert.equal(await page.locator(".composer [data-variant=primary]").count(), 1);
		for (const selector of [".reasoning-trigger"]) if (await page.locator(selector).count()) assert.equal(await page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
		const input = page.locator(".composer textarea");
		await input.fill("视觉回归草稿");
		const send = page.locator(".composer [data-variant=primary]");
		await send.scrollIntoViewIfNeeded();
		assert.equal(await send.isEnabled(), true);
		const bounds = await send.boundingBox();
		assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
		if (width !== 2200) await page.screenshot({ path: fileURLToPath(new URL(`${theme}-${width}.png`, screenshots)), animations: "disabled" });
		// Disabled controls retain native semantics, opaque containers and solid colors.
		await input.fill("");
		assert.equal(await send.isDisabled(), true);
		assert.equal(await send.evaluate((el) => getComputedStyle(el).opacity), "1");
		// Collapse/expand, including the reserved history-search reveal interface.
		const fold = page.getByRole("button", { name: "展开本轮执行过程" }).first();
		assert.equal(await fold.count(), 1);
		if (await fold.count()) {
			await fold.focus(); await fold.press("Enter");
			const collapse = page.getByRole("button", { name: "收起本轮执行过程" }).first();
			await collapse.press("Space");
			assert.equal(await fold.getAttribute("aria-expanded"), "false");
			await fold.press("Enter");
			assert.equal(await page.locator(".turn-header").first().evaluate((el) => getComputedStyle(el).borderBottomWidth), "0px");
		}
		const summary = page.locator(".thinking > summary").first();
		assert.equal(await summary.count(), 1);
		if (await summary.count()) {
			await summary.focus(); await summary.press("Enter");
			assert.equal(await summary.evaluate((el) => el.parentElement.open), true);
			await summary.press("Space");
			assert.equal(await summary.evaluate((el) => el.parentElement.open), false);
		}
		if (width === 2200) {
			await page.getByRole("button", { name: "收起航行台", exact: true }).click();
			await page.waitForFunction(() => {
				const header = document.querySelector(".chat-header"), composer = document.querySelector(".composer");
				return Math.abs(header.getBoundingClientRect().left + parseFloat(getComputedStyle(header).paddingLeft) - composer.getBoundingClientRect().left) < 1;
			});
		}
		if (width === 360) {
			await page.locator(".voyage-summary").click();
			const dialog = page.getByRole("dialog", { name: "航行台详情" });
			await dialog.waitFor();
			assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
			await page.screenshot({ path: fileURLToPath(new URL(`${theme}-360-gauge.png`, screenshots)), animations: "disabled" });
			await page.keyboard.press("Escape");
		}
	}
	// Exercise local active variants beside the unchanged shared segmented control.
	await page.goto(`${base}/tests/voyage.html`);
	await page.waitForFunction(() => window.voyageHarness?.render);
	await page.evaluate(async () => {
		window.voyageHarness.unmount();
		const { default: React } = await import("/node_modules/.vite/deps/react.js");
		const { useState } = React;
		const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
		const { createRoot } = ReactDOM;
		const { Button, Input, SegmentedControl } = await import("/src/components/ui.tsx");
		const { ReasoningChip } = await import("/src/components/ReasoningChip.tsx");
		window.visualControlClicks = 0;
		function Controls() {
			const [value, setValue] = useState("one");
			return React.createElement("div", { id: "visual-controls" },
				React.createElement(ReasoningChip, { level: "high", levels: ["off", "high"], disabled: false, onLevel: () => {} }),
				React.createElement(SegmentedControl, { value, onChange: setValue, label: "回归选项", options: [{ value: "one", label: "一" }, { value: "two", label: "二" }] }),
				...["primary", "ghost", "setting"].map((variant) => React.createElement(Button, { key: variant, variant, disabled: true, onClick: () => window.visualControlClicks++ }, React.createElement("span", null, "禁用"))),
				React.createElement(Input, { disabled: true, value: "禁用输入", readOnly: true }),
				React.createElement("label", { className: "switch" }, React.createElement("input", { type: "checkbox", disabled: true, checked: true, readOnly: true }), React.createElement("span", { className: "slider" })));
		}
		createRoot(document.getElementById("root")).render(React.createElement(Controls));
	});
	await page.locator("#visual-controls").waitFor();
	for (const theme of ["dark", "light"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const selector of [".reasoning-trigger"]) assert.equal(await page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
		const group = page.getByRole("group", { name: "回归选项" });
		const selected = group.locator('[aria-pressed="true"]');
		assert.equal(await selected.evaluate((el) => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)"), true);
		await selected.focus(); await selected.press("ArrowRight");
		assert.equal(await selected.textContent(), "二");
		await selected.press("Home");
		assert.equal(await selected.textContent(), "一");
		const states = await page.locator("#visual-controls :disabled").evaluateAll((elements) => elements.map((el) => {
			const style = getComputedStyle(el);
			const hex = (color) => "#" + color.match(/\d+/g).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
			let opacity = 1;
			for (let parent = el; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
			return { opacity, text: hex(style.color), background: hex(style.backgroundColor), clipped: el.type === "checkbox" ? style.clipPath !== "none" : undefined };
		}));
		assert.equal(states.length, 5);
		for (const state of states) { assert.equal(state.opacity, 1); assert(contrast(state.text, state.background) >= 3); }
		assert.equal(states.at(-1).clipped, true);
		await page.locator("#visual-controls button:disabled").first().click({ force: true });
		assert.equal(await page.evaluate(() => window.visualControlClicks), 0);
		evidence.controls.push({ theme, states });
	}
	assert.deepEqual(errors, []);
	await fs.writeFile(new URL("../features/020-voyage-visual-convergence/browser-verification.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
	console.log(`PASS: ${samples} CTM geometry samples; 2 themes × 3 rail widths; rendered fonts/opacity; bob extremes/reduced motion; 360/1200/2200 alignment, keyboard folds, narrow send/rail; 6 screenshots`);
} finally { await browser.close(); }
