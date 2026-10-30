import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/git-tree-columns", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const summary = () => page.getByRole("separator", { name: "调整提交信息列宽" });
const author = () => page.getByRole("separator", { name: "调整作者列宽" });
const open = async () => {
	await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "Git 历史", exact: true }).click();
	await page.locator(".commit-metadata h2").waitFor();
};
const drag = async (handle, distance, fraction) => {
	const box = await handle.boundingBox();
	const x = box.x + box.width / 2;
	const y = box.y + box.height * fraction;
	await page.mouse.move(x, y);
	assert.equal(await handle.evaluate((el) => getComputedStyle(el).cursor), "col-resize");
	await page.mouse.down();
	await page.mouse.move(x + distance, y, { steps: 8 });
	await page.mouse.up();
};
try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await open();
		const selected = await page.getByRole("option", { selected: true }).textContent();
		const oldSummary = Number(await summary().getAttribute("aria-valuenow"));
		const oldAuthor = Number(await author().getAttribute("aria-valuenow"));
		await drag(summary(), -90, .25);
		assert.equal(Number(await summary().getAttribute("aria-valuenow")), oldSummary - 90);
		assert.equal(Number(await author().getAttribute("aria-valuenow")), oldAuthor);
		await drag(author(), 70, .65);
		assert.equal(Number(await author().getAttribute("aria-valuenow")), oldAuthor + 70);
		assert.equal(Number(await summary().getAttribute("aria-valuenow")), oldSummary - 90);
		assert.equal(await page.getByRole("option", { selected: true }).textContent(), selected, "Dragging cannot select a commit");
		const cells = await page.locator(".commit-log-row").evaluateAll((rows) => rows.map((row) => [row.querySelector(".commit-author").getBoundingClientRect().x, row.querySelector("time").getBoundingClientRect().x]));
		assert.ok(cells.every(([a, d]) => a === cells[0][0] && d === cells[0][1]), "All rows must share column boundaries");
		await author().focus(); await page.keyboard.press("ArrowRight");
		assert.equal(Number(await author().getAttribute("aria-valuenow")), oldAuthor + 82);
		await page.screenshot({ path: `dist/git-tree-columns/${theme}.png` });
		await page.evaluate(() => history.replaceState(null, "", location.pathname + "?fixture=sidebar&persist=1"));
		await page.reload(); await open();
		assert.equal(Number(await summary().getAttribute("aria-valuenow")), oldSummary - 90);
		assert.equal(Number(await author().getAttribute("aria-valuenow")), oldAuthor + 82);
		await author().focus(); await page.keyboard.press("Home");
		assert.equal(await author().getAttribute("aria-valuenow"), "80");
		await page.keyboard.press("End");
		assert.equal(await author().getAttribute("aria-valuenow"), "400");
		await page.getByRole("textbox", { name: "搜索已加载提交" }).fill("no-matching-commit");
		const empty = page.getByText("已加载记录中没有匹配的提交", { exact: true });
		await empty.waitFor();
		const emptyBox = await empty.boundingBox();
		assert.ok(emptyBox.y < 700, "Empty-search message must stay in view");
		console.log(`PASS ${theme}: full-height drag, aligned rows, independent widths, keyboard bounds and persisted widths`);
	}
	await page.setViewportSize({ width: 600, height: 800 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
	await open();
	await page.getByRole("button", { name: "HEAD · 当前提交", exact: true }).click();
	await page.locator(".commit-metadata h2").waitFor();
	await drag(summary(), 80, .5);
	assert.ok(await author().isVisible());
	await page.locator(".commit-log-scroll").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
	await drag(author(), -20, .5);
	assert.equal(await author().getAttribute("aria-valuenow"), "120");
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await page.screenshot({ path: "dist/git-tree-columns/narrow.png" });
	assert.deepEqual(errors, []);
	console.log("PASS narrow: author remains available, column dragging after horizontal scroll, no page overflow");
} finally { await browser.close(); }
