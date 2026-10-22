import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] || "http://localhost:1421";
const output = process.argv[3] || "features/030-chat-reading-experience/screenshots";
await mkdir(output, { recursive: true });
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ reducedMotion: "reduce" });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/preview.html?fixture=long&theme=${theme}`);
		await page.locator(".composer").waitFor();
		for (const viewport of [{ width: 1440, height: 960 }, { width: 1000, height: 750 }, { width: 600, height: 750 }, { width: 600, height: 400 }]) {
			await page.setViewportSize(viewport);
			for (const zoom of [1, 1.5, 2]) {
				await page.evaluate((zoom) => document.documentElement.style.zoom = String(zoom), zoom);
				assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme} ${JSON.stringify(viewport)} CSS zoom ${zoom}: no page overflow`);
				assert.equal(await page.locator(".msg-role").count(), 0);
				assert.ok(await page.locator(".composer").evaluate((node) => node.offsetWidth <= 760));
				await page.locator(".messages").evaluate((node) => node.scrollTop = 0);
				const back = page.getByRole("button", { name: "回到底部", exact: true });
				if (await back.count()) {
					assert.equal(await back.evaluate((node) => {
						const rect = node.getBoundingClientRect(), parent = node.closest(".transcript").getBoundingClientRect();
						return rect.left >= parent.left && rect.right <= parent.right && rect.top >= parent.top && rect.bottom <= parent.bottom;
					}), true, "Jump control stays inside transcript");
				}
			}
		}
		await page.evaluate(() => document.documentElement.style.zoom = "1");
		await page.screenshot({ path: `${output}/short-window-${theme}.png` });
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.screenshot({ path: `${output}/long-${theme}.png` });
		await page.goto(`${base}/tests/turn-usage.html`);
		await page.waitForFunction(() => window.turnUsageHarness);
		const table = "| 工具 | 说明 |\n| --- | --- |\n| web_search | 搜索网页 |\n| `apply_patch` | 编辑文件 |\n| https://example.com/" + "long/".repeat(50) + " | 长路径应在局部容器中处理 |\n| " + "长段落内容".repeat(30) + " | 自然换行 |";
		await page.evaluate(({ table, theme }) => { document.documentElement.dataset.theme = theme; window.turnUsageHarness.render({ messages: [{ role: "user", content: "工具表格" }, { role: "assistant", content: table, timestamp: 1700000000000, durationMs: 45000, usage: { input: 100, output: 200, cacheRead: 400, cacheWrite: 0, totalTokens: 700 } }] }); }, { table, theme });
		await page.locator(".usage-toggle").waitFor();
		assert.equal(await page.locator(".usage-inline").count(), 0, "Usage statistics default to hidden");
		await page.locator(".usage-toggle").press("Enter");
		assert.match(await page.locator(".usage-inline").textContent(), /↓ 500.*80%.*↑ 200/);
		assert.equal(await page.getByRole("img", { name: "缓存命中率 80%" }).count(), 1);
		assert.equal(await page.locator(".usage-inline").textContent().then((text) => text.includes("⚡")), false);
		for (const width of [600, 360]) {
			await page.setViewportSize({ width, height: 700 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Inline stats and long table do not overflow the page");
			assert.equal(await page.locator("td").filter({ hasText: /^web_search$/ }).evaluate((node) => getComputedStyle(node).whiteSpace), "nowrap");
			assert.equal(await page.locator("td").filter({ hasText: /^长段落内容/ }).evaluate((node) => getComputedStyle(node).whiteSpace !== "nowrap"), true);
			for (const selector of [".usage-time", ".msg.assistant .message-buttons"]) assert.equal(await page.locator(selector).evaluate((node) => node.getBoundingClientRect().right <= innerWidth), true);
		}
		await page.locator(".usage-trigger").press("Enter");
		await page.locator(".usage-popover").waitFor();
		await page.keyboard.press("Escape");
		assert.equal(await page.locator(".usage-trigger").evaluate((node) => node === document.activeElement), true);
		await page.screenshot({ path: `${output}/inline-usage-table-${theme}.png` });
		await page.locator(".usage-toggle").press("Space");
		assert.equal(await page.locator(".usage-inline").count(), 0);
		const history = Array.from({ length: 25 }, (_, index) => [{ role: "user", content: `问题 ${index}` }, { role: "assistant", content: "正文阅读锚点。".repeat(150) }]).flat();
		const render = async (messages) => page.evaluate(async (messages) => { window.turnUsageHarness.render({ messages, running: true, activeTurnId: "turn:history_50" }); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }, messages);
		await render([...history, { role: "user", content: "等待回复" }]);
		await page.locator(".messages").evaluate((node) => node.scrollTop = 200);
		await page.getByRole("button", { name: "回到底部", exact: true }).waitFor();
		const before = await page.locator(".messages").evaluate((node) => node.scrollTop);
		await render([...history, { role: "user", content: "等待回复" }, { role: "assistant", content: [{ type: "thinking", thinking: "分析" }] }]);
		assert.equal(await page.locator(".messages").evaluate((node) => node.scrollTop), before, "Thinking replaces waiting without stealing an upper reading position");
		await render([...history, { role: "user", content: "等待回复" }, { role: "assistant", content: "首个正文内容。" }]);
		assert.equal(await page.locator(".messages").evaluate((node) => node.scrollTop), before, "First token does not force the reader to the bottom");
		assert.deepEqual(errors, []);
		console.log(`PASS ${theme}: 1440/1000/600/600x400, CSS zoom 100/150/200%, long replies and contained jump control`);
		await page.close();
	}
} finally { await browser.close(); }
