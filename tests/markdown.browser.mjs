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
		const page = await browser.newPage();
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
		console.log(`PASS ${theme}: literal ranges, double-tilde deletion, bold, code, GFM table/task list and line breaks`);
		await page.close();
	}
} finally {
	await browser.close();
}
