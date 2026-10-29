import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/resize-separator/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const handle = () => page.getByRole("separator", { name: "调整左侧导航宽度" });
const ready = () => page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}`);
		await ready();
		const rect = await handle().boundingBox();
		assert.ok(rect.width >= 16, `Sidebar resize hit area collapsed to ${rect.width}px`);
		const sidebar = await page.locator(".sidebar").boundingBox();
		const workspace = await page.locator(".workspace").boundingBox();
		assert.equal(sidebar.x + sidebar.width, workspace.x, "Hit area must not create a gutter or overlap the panels");
		assert.equal(rect.x + rect.width / 2, workspace.x, "Hit area must straddle the actual divider");
		const scroll = await page.locator(".sidebar-scroll").boundingBox();
		assert.ok(scroll.x + scroll.width <= rect.x, "Resize hit area must not cover the sidebar scrollbar");
		for (const offset of [-7, 0, 7]) {
			const current = await handle().boundingBox();
			for (const fraction of [.1, .5, .9]) {
				const point = { x: current.x + current.width / 2 + offset, y: current.y + current.height * fraction };
				assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"), point), "调整左侧导航宽度", `Missed ${theme} divider at ${offset}px / ${fraction}`);
			}
			const x = current.x + current.width / 2 + offset;
			const y = current.y + current.height / 2;
			const before = Number(await handle().getAttribute("aria-valuenow"));
			await page.mouse.move(x, y);
			assert.equal(await handle().evaluate((element) => getComputedStyle(element).cursor), "col-resize");
			await page.mouse.down();
			await page.mouse.move(x + 40, y, { steps: 5 });
			await page.mouse.up();
			assert.equal(Number(await handle().getAttribute("aria-valuenow")), before + 40, "Dragging from either edge must resize");
			assert.equal(await page.evaluate(() => localStorage.getItem("skiff.sidebar.width")), String(before + 40));
		}
		await handle().focus();
		await page.keyboard.press("Home");
		assert.equal(await handle().getAttribute("aria-valuenow"), "200");
		await page.keyboard.press("ArrowRight");
		assert.equal(await handle().getAttribute("aria-valuenow"), "212");
		await page.keyboard.press("End");
		assert.equal(await handle().getAttribute("aria-valuenow"), "420");
		assert.equal(await handle().evaluate((element) => getComputedStyle(element).outlineStyle), "none", "Focus must highlight only the split line");
		const final = await handle().boundingBox();
		await page.mouse.move(final.x + final.width / 2, final.y + final.height / 2);
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-hover.png`, output)) });
		await page.evaluate(() => history.replaceState(null, "", "/tests/preview.html?fixture=archive&persist=1"));
		await page.reload();
		await ready();
		assert.equal(await handle().getAttribute("aria-valuenow"), "420");
		await page.getByRole("button", { name: "搜索项目与聊天", exact: true }).click();
		await page.getByRole("textbox", { name: "搜索项目与聊天", exact: true }).fill("当前会话");
		await page.getByRole("textbox", { name: "搜索项目与聊天", exact: true }).press("Escape");
		await page.getByRole("button", { name: "航行台", exact: true }).click();
		const right = page.getByRole("separator", { name: "调整右侧航行台宽度" });
		await right.waitFor();
		const rightRect = await right.boundingBox();
		const rightWidth = Number(await right.getAttribute("aria-valuenow"));
		await page.mouse.move(rightRect.x + rightRect.width / 2, rightRect.y + rightRect.height / 2);
		await page.mouse.down();
		await page.mouse.move(rightRect.x + rightRect.width / 2 - 40, rightRect.y + rightRect.height / 2, { steps: 5 });
		await page.mouse.up();
		assert.equal(Number(await right.getAttribute("aria-valuenow")), rightWidth + 40, "Shared separator styling must preserve right-panel dragging");
	}
	await page.setViewportSize({ width: 600, height: 800 });
	assert.equal(await handle().count(), 0, "Drawer mode must not expose the desktop separator");
	assert.deepEqual(errors, []);
	console.log("PASS resize separator: full-height hit area, edge drag, layout, scrollbar clearance, keyboard, persistence, light/dark, drawer");
} finally {
	await browser.close();
}
