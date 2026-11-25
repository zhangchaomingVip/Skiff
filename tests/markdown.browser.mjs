import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] || "http://localhost:1421";
const ranges = "会有 3~4 级偏北风，阵风 5~6 级；降水概率 10~20%，周一~周五。";
const text = `${ranges}\n\n~~过时预报~~ **最新预报**\n\n单独的 ~文字~ 保留原样。\n\n\`3~4 和 ~~代码~~\`\n\n| 日期 | 风力 |\n| --- | --- |\n| 周一~周五 | 3~4 级，阵风 5~6 级 |\n\n- [x] 核对预报\n\n第一行\n第二行`;

try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/preview.html?fixture=long&theme=${theme}`);
		await page.locator(".composer").waitFor();
		await page.goto(`${base}/tests/turn-usage.html`);
		await page.waitForFunction(() => window.turnUsageHarness);
		await page.evaluate(({ text, theme }) => {
			document.documentElement.dataset.theme = theme;
			window.turnUsageHarness.render({ messages: [{ role: "user", content: "天气预报" }, { role: "assistant", content: text }] });
		}, { text, theme });
		const reply = page.locator(".msg.assistant .md");
		await reply.locator("table").waitFor();
		assert.ok((await reply.textContent()).includes(ranges), "Numeric and Chinese ranges retain their literal tildes");
		assert.deepEqual(await reply.locator("del").allTextContents(), ["过时预报"], "Only double tildes create strikethrough");
		assert.ok((await reply.textContent()).includes("~文字~"));
		assert.equal(await reply.locator("strong").textContent(), "最新预报");
		assert.equal(await reply.locator("code").textContent(), "3~4 和 ~~代码~~");
		assert.deepEqual(await reply.locator("tbody td").allTextContents(), ["周一~周五", "3~4 级，阵风 5~6 级"]);
		assert.equal(await reply.locator('input[type="checkbox"]').isChecked(), true);
		assert.equal(await reply.locator("br").count(), 1, "Soft line breaks remain supported");
		assert.deepEqual(errors, []);

		// A typed address keeps its own words and leaves the app through the system browser.
		await page.evaluate(() => { window.__TAURI_INTERNALS__ = { invoke: (command, args) => { window.__openedLink = { command, args }; return Promise.resolve(); } }; });
		const address = "https://example.com/";
		await page.evaluate((url) => window.turnUsageHarness.render({ messages: [{ role: "user", content: `${url} 请看这个地址` }] }), address);
		const bubble = page.locator(".msg.user .md");
		const link = bubble.locator("a.message-link");
		await link.waitFor();
		assert.equal(await link.textContent(), address, "The typed URL stays visible instead of a 来源 chip");
		assert.equal(await bubble.locator(".citation-badge, .sources-pill").count(), 0);
		assert.equal(await link.evaluate((element) => getComputedStyle(element).fontWeight), "600");
		await link.click();
		assert.deepEqual(await page.evaluate(() => window.__openedLink), { command: "open_url", args: { url: address } });
		assert.ok(page.url().endsWith("/tests/turn-usage.html"), "Clicking a message link never navigates the app");

		const sources = Array.from({ length: 16 }, (_, index) => `https://example.com/docs/${index + 1}`);
		await page.evaluate((urls) => window.turnUsageHarness.render({ messages: [
			{ role: "user", content: "找一下文档" },
			{ role: "assistant", content: `文档： ${urls[0]}\n\n重复:   ${urls[0]}\n\n链接：[指南](https://example.org/guide)\n\n参考资料 ${urls.slice(1).join(" ")}` },
			{ role: "user", content: "另一个来源" },
			{ role: "assistant", content: "更新： https://example.org/update" },
		] }), sources);
		const firstReply = reply.nth(0);
		const secondReply = reply.nth(1);
		const firstPill = firstReply.locator(".sources-pill");
		const secondPill = secondReply.locator(".sources-pill");
		const badges = firstReply.locator("a.citation-badge");
		const panel = page.locator(".sources-side-panel");
		await firstPill.waitFor();
		assert.deepEqual(await badges.allTextContents(), ["1", "1", ...sources.slice(1).map((_, index) => String(index + 2))]);
		assert.deepEqual((await firstReply.locator("p").allTextContents()).slice(0, 3), ["文档 1", "重复 1", "链接：指南"]);
		assert.ok((await badges.first().getAttribute("title")).includes(sources[0]));
		assert.equal(await firstPill.textContent(), "16 个网页");
		assert.equal(await firstPill.locator("svg").count(), 1);
		for (const control of [badges.first(), firstPill]) {
			assert.equal(await control.evaluate((element) => getComputedStyle(element).display), "inline-flex");
			assert.match(await control.evaluate((element) => getComputedStyle(element).backgroundColor), /^color\(srgb /);
		}
		assert.equal(await panel.count(), 0);

		await firstPill.click();
		assert.equal(await panel.locator("h3").textContent(), "参考来源 · 16 个网页");
		assert.equal(await panel.locator(".source-card").count(), 16);
		assert.equal(await panel.locator(".source-card.is-active").count(), 0);
		const card = panel.locator(".source-card").first();
		assert.deepEqual(await card.evaluate((element) => {
			const style = getComputedStyle(element);
			return [element.closest(".md") === null, style.display, style.textDecorationLine, style.color === getComputedStyle(element.querySelector("strong")).color];
		}), [true, "flex", "none", true], "Source cards retain their layout and link colors inside the portal");

		await badges.last().click();
		const activeCard = panel.locator(".source-card.is-active");
		assert.equal(await activeCard.getAttribute("href"), sources.at(-1));
		await page.waitForFunction(() => document.querySelector(".sources-panel-content").scrollTop > 0);
		await activeCard.click();
		assert.deepEqual(await page.evaluate(() => window.__openedLink), { command: "open_url", args: { url: sources.at(-1) } });
		assert.equal(await panel.count(), 1, "Clicking a result keeps the panel open");

		await secondPill.click();
		assert.equal(await panel.count(), 1);
		assert.equal(await panel.locator("h3").textContent(), "参考来源 · 1 个网页");
		assert.equal(await firstPill.getAttribute("aria-expanded"), "false");
		await badges.first().click();
		assert.equal(await panel.count(), 1);
		assert.equal(await secondPill.getAttribute("aria-expanded"), "false");
		assert.equal(await activeCard.getAttribute("href"), sources[0]);
		await page.keyboard.press("Escape");
		await panel.waitFor({ state: "hidden" });
		await badges.first().click();
		assert.equal(await activeCard.getAttribute("href"), sources[0]);
		await firstPill.click();
		await panel.waitFor({ state: "hidden" });
		await firstPill.click();
		await firstReply.locator("p").first().click({ position: { x: 4, y: 10 } });
		await panel.waitFor({ state: "hidden" });
		await firstPill.click();
		await panel.getByRole("button", { name: "关闭参考来源" }).click();
		await panel.waitFor({ state: "hidden" });
		assert.deepEqual(errors, []);
		console.log(`PASS ${theme}: Markdown, typed links, citation formatting, portal styles, source switching, dismissal and external navigation`);
		await page.close();
	}
} finally {
	await browser.close();
}
