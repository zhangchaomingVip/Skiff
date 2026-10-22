// Exercises the real transcript components with restored pi messages; no provider calls.
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, timezoneId: "Asia/Shanghai" });
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
	await page.evaluate(async (props) => { window.turnUsageHarness.render(props); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); }, props);
	await page.waitForFunction((count) => document.querySelectorAll(".usage-details").length === count, count);
	while (await page.locator(".usage-toggle[aria-expanded=false]").count()) await page.locator(".usage-toggle[aria-expanded=false]").first().click();
};
const totals = async () => {
	const values = [];
	for (const trigger of await page.locator(".usage-trigger").all()) {
		const wasOpen = await trigger.getAttribute("aria-expanded") === "true";
		if (!wasOpen) await trigger.click();
		values.push(await page.locator(".usage-row dd").first().textContent());
		if (!wasOpen) await page.keyboard.press("Escape");
	}
	return values;
};

try {
	await page.goto(`${process.argv[2] ?? "http://127.0.0.1:1424"}/tests/turn-usage.html`);
	await page.waitForFunction(() => window.turnUsageHarness);
	await render({ messages }, 2);
	assert.deepEqual(await totals(), ["205", "250"]);

	// The footer no longer ships continue / regenerate / delete buttons; only copy remains.
	assert.equal(await page.locator(".continue-btn").count(), 0);
	const first = page.locator(".usage-details").first();
	await first.locator(".usage-trigger").click();
	assert.equal(await first.locator(".usage-heading strong").textContent(), "本轮 Token 消耗");
	assert.deepEqual(await first.locator(".usage-row dd").allTextContents(), ["205", "35", "160", "10", "55", "15", "40", "260"]);
	assert.equal(await first.locator(".usage-rate b").textContent(), "17.1%");
	await first.locator(".usage-trigger").press("Escape");
	assert.equal(await first.locator(".usage-trigger").getAttribute("aria-expanded"), "false");
	assert.equal(await first.locator(".usage-trigger").evaluate((el) => el === document.activeElement), true);
	const processSummary = page.locator(".turn-process-head > summary").first();
	assert.equal(await processSummary.getAttribute("aria-expanded"), "false");
	await processSummary.press("Enter");
	await processSummary.press("Space");
	assert.equal(await page.locator(".usage-details").count(), 2);
	assert.equal(await processSummary.getAttribute("aria-expanded"), "false");
	await render({ messages, revealTurn: { turnId: "turn:history_0", requestKey: "search-1" } }, 2);
	await page.getByRole("button", { name: "收起本轮执行过程" }).waitFor();
	await page.getByRole("button", { name: "收起本轮执行过程" }).click();
	await render({ messages, revealTurn: { turnId: "turn:history_0", requestKey: "search-2" } }, 2);
	await page.getByRole("button", { name: "收起本轮执行过程" }).waitFor();

	// Pending and active next turns must preserve all completed turns' details.
	const nextUser = { id: "next", role: "user", blocks: [{ kind: "text", text: "第三轮" }] };
	await render({ messages, running: true, activeTurnId: "turn:next", pendingPrompt: { id: "pending", userMessage: nextUser } }, 2);
	assert.equal(await page.locator(".continue-btn").count(), 0);
	const active = [...messages, { role: "user", content: "第三轮" }, { role: "assistant", content: "工具执行中", usage: usage(500, 0, 0, 10, 0) }];
	await render({ messages: active, running: true, activeTurnId: "turn:history_6" }, 2);
	assert.deepEqual(await totals(), ["205", "250"]);
	await render({ messages: active, running: false }, 3);


	// A final entry without usage still displays usage from the turn's earlier requests.
	await render({ messages: [...messages.slice(0, 3), { role: "assistant", content: "没有 usage 的最终消息" }, ...messages.slice(4)], readOnly: true }, 2);
	assert.deepEqual(await totals(), ["125", "250"]);
	assert.equal(await page.locator(".continue-btn").count(), 0);
	await render({ messages: [{ role: "user", content: "未上报用量" }, { role: "assistant", content: "回复" }] }, 1);
	await page.locator(".usage-trigger").click();
	assert.equal(await page.locator(".usage-popover").textContent().then((value) => value.includes("用量未记录")), true);
	assert.equal(await page.locator(".usage-model-label").textContent(), "未知渠道 · 未知模型");
	await page.keyboard.press("Escape");

	// A centred first turn used to clip the upward-opening panel inside .messages.
	await render({ messages: [{ role: "user", content: "你好" }, { role: "assistant", content: "你好，有什么可以帮你？", usage: usage(128, 1400, 0, 462) }] }, 1);

	assert.deepEqual(await totals(), ["1.53k"]);
	const chip = page.locator(".usage-trigger");
	const panel = page.locator(".usage-popover");
	await chip.hover();

	assert.equal(await panel.count(), 0);
	await page.mouse.move(0, 0);
	// Keyboard activation opens the panel; pointer exit must not dismiss it.
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
	// Match the requested row and preserve the completed reply's actual route/prices.
	const snapshot = { providerKey: "old-provider", familyId: "deepseek", familyName: "DeepSeek", modelId: "deepseek-flash", alias: "旧别名", relayId: "custom", relayName: "基元律动", billingAccountId: "xxx", currency: "CNY", inputCost: 1, outputCost: 147 / 190 };
	const completed = { role: "assistant", provider: "old-provider", model: "deepseek-flash", content: "完成", usage: usage(73, 1917, 0, 190), routeSnapshot: snapshot, timestamp: new Date("2026-10-13T12:31:00+08:00").getTime() };
	await render({ messages: [{ role: "user", content: "验证 chip" }, completed], current: { provider: "other", id: "other", providerName: "新渠道" } }, 1);
	assert.equal(await page.locator(".usage-model").count(), 0);
	assert.equal(await page.locator(".usage-time").count(), 1);
	await chip.click();
	assert.equal(await page.locator(".usage-model-label").textContent(), "基元律动 · deepseek-flash");
	assert.equal(await page.locator(".usage-model").getAttribute("title"), "完整线路：基元律动 · deepseek-flash · 账户xxx");
	assert.equal(await page.locator(".message-route").count(), 0);
	assert.deepEqual(await totals(), ["1.99k"]);

	assert.equal(await page.locator(".usage-rate b").textContent(), "96.3%");

	assert.equal(await page.getByRole("button", { name: "重新生成", exact: true }).count(), 0);
	assert.equal(await page.locator(".msg.assistant .message-actions > :first-child").getAttribute("class"), "turn-usage");
	assert.equal(await page.locator(".usage-popover .usage-model").count(), 1, "Route details belong to the usage panel");


	assert.equal(await page.locator(".usage-cost").textContent(), "¥0.00214");
	assert.equal(await page.locator(".usage-cost").getAttribute("title"), "精确费用 ¥0.002137（按 6 位原始值）");
	assert.equal(await page.locator(".usage-time").textContent(), "12:31");
	assert.equal(await page.locator(".usage-time").getAttribute("title"), "2026-10-13 周二 12:31");
	await page.evaluate(() => {
		window.copiedValues = [];
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value) => window.copiedValues.push(value) } });
	});
	await page.locator(".usage-model").click();
	await page.locator(".usage-cost").click();
	await page.keyboard.press("Escape");
	assert.deepEqual(await page.evaluate(() => window.copiedValues), ["deepseek-flash", "¥0.002137"]);
	assert.equal(await page.locator(".usage-model").count(), 0);
	assert.equal(await page.locator(".usage-time").count(), 1);
	assert.equal(await panel.count(), 0);
	assert.deepEqual(await page.evaluate(() => window.copiedValues), ["deepseek-flash", "¥0.002137"]);
	for (const theme of ["dark", "light"]) {
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		for (const width of [1200, 600, 360]) {
			await page.setViewportSize({ width, height: 900 });
			assert.equal(await page.locator(".turn-usage").evaluate((el) => el.getBoundingClientRect().right <= innerWidth), true);
			if (process.env.SKIFF_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SKIFF_SCREENSHOT_DIR}/turn-usage-${theme}-${width}.png` });
		}
	}
	// Cache boundaries stay exact inside the details.
	for (const input of [usage(0, 1990, 0, 190), usage(1990, 0, 0, 190)]) {
		await render({ messages: [{ role: "user", content: "边界" }, { ...completed, usage: input }] }, 1);

		assert.deepEqual(await totals(), ["1.99k"]);
		await chip.click();
		assert.equal(await page.locator(".usage-popover .usage-new").textContent(), input.input === 0 ? "0" : "1.99k");
		await page.keyboard.press("Escape");
	}
	// Cache writes count as new input, while output never enters the parentheses.
	await render({ messages: [{ role: "user", content: "缓存写入" }, { ...completed, usage: usage(50, 1900, 40, 500) }] }, 1);

	assert.deepEqual(await totals(), ["1.99k"]);
	await chip.click();
	assert.equal(await page.locator(".usage-popover .usage-new").textContent(), "90");
	await page.keyboard.press("Escape");
	// Missing prices remain explicit; route details are available in the popover.
	await render({ messages: [{ role: "user", content: "未配置价格" }, { ...completed, routeSnapshot: { ...snapshot, inputCost: 0, outputCost: 0 } }] }, 1);
	assert.equal(await page.locator(".usage-cost").count(), 0);
	await chip.click();
	assert.equal(await page.locator(".usage-cost").textContent(), "未配置单价");
	assert.equal(await page.locator(".usage-model").isVisible(), true);
	assert.equal(await page.locator(".usage-time").isVisible(), true);
	assert.equal(await page.locator(".usage-cost").isDisabled(), true);
	await page.keyboard.press("Escape");
	await render({ messages: [{ role: "user", content: "历史来源" }, { ...completed, usage: undefined }], current: { provider: "new", id: "new-model" } }, 1);
	assert.equal(await chip.textContent(), "消息详情");
	await chip.press("Enter");
	assert.equal(await page.locator(".usage-model-label").textContent(), "基元律动 · deepseek-flash");
	assert.equal(await page.locator(".usage-row").count(), 0, "Unrecorded usage must not imply zero consumption");
	await page.keyboard.press("Escape");
	assert.equal(await chip.evaluate((node) => node === document.activeElement), true);
	assert.deepEqual(errors, []);
	console.log("PASS: time/details footer, route details, explicit missing prices, route snapshots, exact cost/model copying, full date titles, new input boundaries, tool aggregation, folding, pending/history turns, click/keyboard dismissal and small-window popovers");
} finally {
	await browser.close();
}
