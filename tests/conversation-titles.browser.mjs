import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
await fs.mkdir("dist", { recursive: true });

async function assertActionSpace(row) {
	const geometry = await row.evaluate((element) => {
		const title = element.querySelector(".chat-title").getBoundingClientRect();
		const link = element.querySelector(".chat-link").getBoundingClientRect();
		const actions = element.querySelector(".sidebar-row-actions").getBoundingClientRect();
		const buttons = [...element.querySelectorAll(".sidebar-row-actions button")].map((button) => button.getBoundingClientRect());
		const bounds = element.getBoundingClientRect();
		return { titleRight: title.right, linkRight: link.right, actionsLeft: actions.left, actionsWidth: actions.width, buttonsFit: buttons.every((button) => button.left >= actions.left && button.right <= bounds.right), titleWidth: title.width };
	});
	assert.ok(geometry.actionsWidth > 0, "Visible actions occupy their own space");
	assert.ok(geometry.titleWidth > 0, "Title retains space at minimum sidebar width");
	assert.ok(geometry.titleRight <= geometry.actionsLeft + 0.5, JSON.stringify(geometry));
	assert.ok(geometry.linkRight <= geometry.actionsLeft + 0.5, JSON.stringify(geometry));
	assert.ok(geometry.buttonsFit, JSON.stringify(geometry));
}

try {
	for (const theme of ["light", "dark"]) {
		for (const width of [200, 232, 420]) {
			const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
			const errors = [];
			page.on("pageerror", (error) => errors.push(String(error)));
			await page.addInitScript((width) => localStorage.setItem("skiff.sidebar.width", String(width)), width);
			await page.goto(`${origin}/tests/preview.html?fixture=conversation-titles&theme=${theme}&persist=1&static=1`);
			await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
			await page.waitForFunction(() => document.querySelector(".header-title-row > span")?.textContent === "北京明天天气怎么样");
			const header = page.locator(".header-title-row > span").first();
			assert.equal(await header.innerText(), "北京明天天气怎么样");
			assert.match(await header.getAttribute("title"), /创建于/);
			const titles = await page.locator(".sidebar .chat-title").allTextContents();
			assert.ok(titles.filter((title) => title === "你好").length >= 2);
			assert.ok(titles.every((title) => !/a1b2c\d|测试模型| · /.test(title)));
			const group = page.locator(".project-group").first();
			const rows = group.locator(".chat-row");
			const selected = rows.filter({ has: page.locator(".chat-title", { hasText: /^北京明天天气怎么样$/ }) });
			await selected.locator(".chat-link").click();
			await page.mouse.move(1100, 500);
			const assertHiddenActions = async (row) => assert.equal(await row.locator(".sidebar-row-actions").evaluate((element) => getComputedStyle(element).pointerEvents), "none");
			await assertHiddenActions(selected);
			assert.equal(await selected.locator(".chat-link").evaluate((element) => getComputedStyle(element).fontWeight), "500");
			const model = rows.filter({ has: page.locator(".chat-title", { hasText: /^你是什么模型$/ }) });
			assert.equal(await model.locator("time").count(), 0, "Hidden duplicate does not add a project timestamp");
			await group.getByRole("button", { name: "展开更多 (1)", exact: true }).click();
			assert.equal(await model.locator("time").count(), 2, "Expanded twins both receive timestamps");
			await group.getByRole("button", { name: "收起", exact: true }).click();
			assert.equal(await model.locator("time").count(), 0, "Collapsing removes the hidden twin from disambiguation");
			const geometry = await group.evaluate((element) => {
				const name = element.querySelector(".project-select > span").getBoundingClientRect();
				const title = element.querySelector(".chat-title").getBoundingClientRect();
				const next = element.nextElementSibling;
				return { inset: title.left - name.left, gap: parseFloat(getComputedStyle(next).marginTop), moreSize: getComputedStyle(element.querySelector(".chat-more")).fontSize };
			});
			assert.equal(geometry.inset, 0, "Chat titles align exactly with the project name");
			assert.equal(geometry.gap, 8);
			assert.equal(geometry.moreSize, "12px");
			const duplicate = rows.filter({ has: page.locator(".chat-title", { hasText: /^你好$/ }) }).first();
			await page.mouse.move(1100, 500);
			assert.equal(await duplicate.locator("time.chat-disambiguator").isVisible(), true);
			assert.match(await duplicate.locator("time").innerText(), /\d{2}:\d{2}/);
			assert.match(await rows.filter({ has: page.locator(".chat-title", { hasText: /^你好$/ }) }).nth(1).locator("time").innerText(), /^\d{1,2}\/\d{1,2}$/);
			await duplicate.hover();
			await assertActionSpace(duplicate);
			assert.equal(await duplicate.locator("time.chat-disambiguator").isVisible(), false);

			const long = rows.filter({ has: page.locator(".chat-title", { hasText: /^你在这个项目/ }) });
			await long.hover();
			await assertActionSpace(long);
			await assertHiddenActions(selected);
			assert.notEqual(await long.evaluate((element) => getComputedStyle(element).backgroundColor), await selected.evaluate((element) => getComputedStyle(element).backgroundColor), "Hover and selected backgrounds differ");
			if (width === 232) await page.screenshot({ path: `dist/sidebar-states-${theme}.png` });
			if (width === 200) assert.ok(await long.locator(".chat-title").evaluate((element) => element.scrollWidth > element.clientWidth), "Long titles truncate");
			await page.mouse.move(1100, 500);
			await page.keyboard.press("Tab");
			await long.locator(".chat-link").focus();
			await assertActionSpace(long);
			await page.keyboard.press("Tab");
			assert.match(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), /^固定聊天/);
			await page.keyboard.press("Enter");
			await long.getByRole("button", { name: /^取消固定聊天/ }).waitFor();
			await assertActionSpace(long);
			await long.locator(".chat-link").click();
			await page.mouse.move(1100, 500);
			await assertHiddenActions(long);
			assert.equal(await long.locator(".chat-pinned").isVisible(), true, "Only the filled pin remains at rest");
			assert.equal(await long.locator("time").count(), 0, "Archived, empty and other-project twins do not affect this project");
			const recentLong = page.locator(".sidebar-recent .chat-row").filter({ has: page.locator(".chat-title", { hasText: /^你在这个项目/ }) });
			assert.equal(await recentLong.locator("time").count(), 2, "Recent disambiguation uses its own visible cross-project list");
			assert.ok((await header.innerText()).startsWith("你在这个项目"));
			assert.doesNotMatch(await header.innerText(), / · |a1b2c\d|测试模型/);
			if (width === 232) await page.screenshot({ path: `dist/conversation-titles-${theme}.png` });
			assert.deepEqual(errors, []);
			await page.close();
			console.log(`PASS ${theme}, sidebar ${width}px: visible twins, compact dates, distinct selection, hover/keyboard actions, pinned indicator, tree alignment and group spacing`);
		}
	}
	const touch = await browser.newPage({ viewport: { width: 1000, height: 900 }, hasTouch: true });
	await touch.goto(`${origin}/tests/preview.html?fixture=conversation-titles&theme=light`);
	await touch.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	await assertActionSpace(touch.locator(".project-chats .chat-row").last());
	await touch.close();
	console.log("PASS touch: actions reserve space without hover");
} finally {
	await browser.close();
}
