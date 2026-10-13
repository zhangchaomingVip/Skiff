// Exercises the real transcript components with restored pi messages; no provider calls.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const usage = (input, cacheRead, cacheWrite, output, reasoning) => ({ input, cacheRead, cacheWrite, output, reasoning, totalTokens: input + cacheRead + cacheWrite + output });
const messages = [
	{ role: "user", content: "第一轮：检查文件" },
	{ role: "assistant", content: [{ type: "toolCall", id: "read", name: "read", arguments: { path: "README.md" } }], usage: usage(100, 20, 5, 30, 10) },
	{ role: "toolResult", toolCallId: "read", toolName: "read", content: "文件内容" },
	{ role: "assistant", content: "第一轮完成", usage: usage(60, 15, 5, 25, 5) },
	{ role: "user", content: "第二轮：解释结果" },
	{ role: "assistant", content: "第二轮完成", usage: usage(200, 40, 10, 50, 20) },
];
const render = async (props, count) => {
	await page.evaluate((props) => window.turnUsageHarness.render(props), props);
	await page.waitForFunction((count) => document.querySelectorAll(".usage-details").length === count, count);
};
const totals = () => page.locator(".usage-trigger .usage-total").allTextContents();
const added = () => page.locator(".usage-trigger .usage-new").allTextContents();

try {
	await page.goto(`${process.argv[2] ?? "http://127.0.0.1:1424"}/tests/turn-usage.html`);
	await page.waitForFunction(() => window.turnUsageHarness);
	await render({ messages }, 2);
	assert.deepEqual(await totals(), ["/ 260", "/ 300"]);
	assert.deepEqual(await added(), ["225", "260"]);
	// The footer no longer ships continue / regenerate / delete buttons; only copy remains.
	assert.equal(await page.locator(".continue-btn").count(), 0);
	const first = page.locator(".usage-details").first();
	await first.locator("button").click();
	assert.equal(await first.locator(".usage-heading strong").textContent(), "本轮 Token 消耗");
	assert.deepEqual(await first.locator(".usage-row dd").allTextContents(), ["205", "35", "160", "10", "55", "15", "40", "260"]);
	assert.equal(await first.locator(".usage-rate b").textContent(), "17.1%");
	await first.locator("button").press("Escape");
	assert.equal(await first.locator("button").getAttribute("aria-expanded"), "false");
	assert.equal(await first.locator("button").evaluate((el) => el === document.activeElement), true);
	await page.getByRole("button", { name: "收起本轮执行过程" }).click();
	assert.equal(await page.locator(".usage-details").count(), 2);

	// Pending and active next turns must preserve all completed turns' details.
	const nextUser = { id: "next", role: "user", blocks: [{ kind: "text", text: "第三轮" }] };
	await render({ messages, running: true, activeTurnId: "turn:next", pendingPrompt: { id: "pending", userMessage: nextUser } }, 2);
	assert.equal(await page.locator(".continue-btn").count(), 0);
	const active = [...messages, { role: "user", content: "第三轮" }, { role: "assistant", content: "工具执行中", usage: usage(500, 0, 0, 10, 0) }];
	await render({ messages: active, running: true, activeTurnId: "turn:history_6" }, 2);
	assert.deepEqual(await totals(), ["/ 260", "/ 300"]);
	await render({ messages: active, running: false }, 3);

	// A final entry without usage still displays usage from the turn's earlier requests.
	await render({ messages: [...messages.slice(0, 3), { role: "assistant", content: "没有 usage 的最终消息" }, ...messages.slice(4)], readOnly: true }, 2);
	assert.deepEqual(await totals(), ["/ 155", "/ 300"]);
	assert.equal(await page.locator(".continue-btn").count(), 0);
	await render({ messages: [{ role: "user", content: "未上报用量" }, { role: "assistant", content: "回复" }] }, 0);

	// A centred first turn used to clip the upward-opening panel inside .messages.
	await render({ messages: [{ role: "user", content: "你好" }, { role: "assistant", content: "你好，有什么可以帮你？", usage: usage(128, 1400, 0, 462) }] }, 1);
	assert.deepEqual(await added(), ["590"]);
	assert.deepEqual(await totals(), ["/ 1.99k"]);
	const chip = page.locator(".usage-trigger");
	const panel = page.locator(".usage-popover");
	await chip.hover();
	await panel.waitFor({ state: "visible" });
	await panel.hover();
	assert.equal(await panel.isVisible(), true);
	await page.mouse.move(0, 0);
	await panel.waitFor({ state: "detached" });
	// Keyboard activation pins the panel; pointer exit must not dismiss it.
	await chip.focus();
	await chip.press("Enter");
	await panel.waitFor({ state: "visible" });
	for (const viewport of [{ width: 1200, height: 900 }, { width: 600, height: 500 }, { width: 360, height: 420 }, { width: 360, height: 240 }]) {
		await page.setViewportSize(viewport);
		await page.waitForFunction(() => {
			const panel = document.querySelector(".usage-popover");
			const rect = panel?.getBoundingClientRect();
			return rect && rect.top >= 11 && rect.left >= 11 && rect.bottom <= innerHeight - 11 && rect.right <= innerWidth - 11;
		});
		assert.equal(await panel.evaluate((el) => getComputedStyle(el).position), "fixed");
		// Hit testing catches ancestor clipping even when the panel's bounds look right.
		assert.equal(await panel.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			return el.contains(document.elementFromPoint(rect.left + 20, rect.top + 20));
		}), true);
		if (viewport.height === 240) {
			assert.equal(await panel.evaluate((el) => el.scrollHeight > el.clientHeight), true);
			await panel.evaluate((el) => { el.scrollTop = el.scrollHeight; });
			assert.equal(await panel.locator(".menu-hint").evaluate((el) => {
				const rect = el.getBoundingClientRect();
				const parent = el.closest(".usage-popover").getBoundingClientRect();
				return rect.top >= parent.top && rect.bottom <= parent.bottom;
			}), true);
		}
	}
	await chip.press("Escape");
	await panel.waitFor({ state: "detached" });
	await page.setViewportSize({ width: 1200, height: 900 });
	await chip.click();
	await panel.waitFor({ state: "visible" });
	await page.mouse.click(0, 0);
	await panel.waitFor({ state: "detached" });
	assert.deepEqual(errors, []);
	console.log("PASS: per-turn usage, new/total tokens, tool aggregation, cache/reasoning breakdown, folding, pending/streaming turns, history/archive, hover/keyboard/click dismissal, centred first-turn popup and small-window scrolling");
} finally {
	await browser.close();
}
