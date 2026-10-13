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
const totals = () => page.locator(".usage-details > summary").allTextContents();

try {
	await page.goto(`${process.argv[2] ?? "http://127.0.0.1:1424"}/tests/turn-usage.html`);
	await page.waitForFunction(() => window.turnUsageHarness);
	await render({ messages }, 2);
	assert.deepEqual((await totals()).map((text) => text.trim()), ["Tokens: 260", "Tokens: 300"]);
	// The footer no longer ships continue / regenerate / delete buttons; only copy remains.
	assert.equal(await page.locator(".continue-btn").count(), 0);
	const first = page.locator(".usage-details").first();
	await first.locator("summary").click();
	assert.equal(await first.locator(".usage-heading strong").textContent(), "本轮 Token 消耗");
	assert.deepEqual(await first.locator(".usage-row dd").allTextContents(), ["205", "35", "160", "10", "55", "15", "40"]);
	assert.equal(await first.locator(".usage-rate b").textContent(), "17.1%");
	await first.locator("summary").press("Escape");
	assert.equal(await first.evaluate((el) => el.open), false);
	await page.getByRole("button", { name: "收起本轮执行过程" }).click();
	assert.equal(await page.locator(".usage-details").count(), 2);

	// Pending and active next turns must preserve all completed turns' details.
	const nextUser = { id: "next", role: "user", blocks: [{ kind: "text", text: "第三轮" }] };
	await render({ messages, running: true, activeTurnId: "turn:next", pendingPrompt: { id: "pending", userMessage: nextUser } }, 2);
	assert.equal(await page.locator(".continue-btn").count(), 0);
	const active = [...messages, { role: "user", content: "第三轮" }, { role: "assistant", content: "工具执行中", usage: usage(500, 0, 0, 10, 0) }];
	await render({ messages: active, running: true, activeTurnId: "turn:history_6" }, 2);
	assert.deepEqual((await totals()).map((text) => text.trim()), ["Tokens: 260", "Tokens: 300"]);
	await render({ messages: active, running: false }, 3);

	// A final entry without usage still displays usage from the turn's earlier requests.
	await render({ messages: [...messages.slice(0, 3), { role: "assistant", content: "没有 usage 的最终消息" }, ...messages.slice(4)], readOnly: true }, 2);
	assert.deepEqual((await totals()).map((text) => text.trim()), ["Tokens: 155", "Tokens: 300"]);
	assert.equal(await page.locator(".continue-btn").count(), 0);
	await render({ messages: [{ role: "user", content: "未上报用量" }, { role: "assistant", content: "回复" }] }, 0);
	assert.deepEqual(errors, []);
	console.log("PASS: per-turn usage, tool aggregation, cache/reasoning breakdown, folding, pending/streaming turns, history and archive display");
} finally {
	await browser.close();
}
