import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] || "http://127.0.0.1:1421";
const output = process.argv[3];
if (output) await mkdir(output, { recursive: true });
const errors = [];
const timestamp = Date.now() - 33 * 60_000;
const usage = { input: 1200, output: 320, cacheRead: 200, cacheWrite: 0, totalTokens: 1720 };
const assistant = (content, extra = {}) => ({ role: "assistant", provider: "mock", model: "glm-5.3-flash", content, timestamp, stopReason: "stop", usage, ...extra });
const messages = [
	{ role: "user", content: "测试一下这个网址，帮我只代理这个网站。", timestamp },
	assistant([{ type: "thinking", thinking: "检查代理规则，确认域名与连接方式。".repeat(100) }], { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }),
	{ role: "user", content: "继续", timestamp },
	assistant([{ type: "thinking", thinking: "优先使用规则模式，再为指定域名单独配置代理。".repeat(100) }, { type: "text", text: "可以，在 Clash Verge 中为指定网站添加一条规则。\n\n**第一步：切换到规则模式**\n\n打开代理设置，选择规则模式。然后在规则文件中添加：\n\n```yaml\nrules:\n  - DOMAIN-SUFFIX,example.com,PROXY\n  - MATCH,DIRECT\n```\n\n保存并重新加载配置后，其他网站会保持直连。" }]),
	{ role: "user", content: "换个模型检查配置。", timestamp },
	assistant("配置顺序正确。请把 `PROXY` 替换成你当前使用的代理组名称。", { model: "kimi-k2", provider: "other" }),
];
const models = [{ provider: "mock", id: "glm-5.3-flash", name: "glm-5.3-flash", currency: "CNY", cost: { input: 1, output: 2 } }, { provider: "other", id: "kimi-k2", name: "Kimi K2", currency: "CNY", cost: { input: 1, output: 2 } }];
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1100, height: 960 }, reducedMotion: "reduce" });
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/preview.html?fixture=chat&theme=${theme}`);
		await page.locator(".assistant-reply").first().waitFor();
		if (output) await page.screenshot({ path: `${output}/app-${theme}.png` });
		await page.goto(`${base}/tests/turn-usage.html`);
		await page.waitForFunction(() => window.turnUsageHarness);
		await page.evaluate(({ theme, messages, models }) => { document.documentElement.dataset.theme = theme; window.turnUsageHarness.render({ messages, models, current: models[0] }); }, { theme, messages, models });
		await page.locator(".msg").last().waitFor();
		await page.evaluate(() => { document.querySelector(".messages").scrollTop = 0; });
		await page.mouse.move(0, 0);
		const user = page.locator(".msg.user").nth(1), bubble = user.locator(".message-bubble");
		const bounds = await bubble.boundingBox(), row = await user.boundingBox();
		assert.ok(bounds.width < row.width / 2, "Short user messages shrink to their content");
		assert.ok(Math.abs(bounds.x + bounds.width - row.x - row.width) < 1, "User bubble aligns right");
		assert.equal(await user.locator(".msg-role").count(), 0);
		assert.equal(await user.locator("time").count(), 1);
		assert.equal(await user.locator(".message-buttons > .msg-time").count(), 1, "User time joins the hover actions");
		assert.match(await user.locator(".msg-time").textContent(), /^\d{2}:\d{2}$/, "User time stays an exact hour and minute");
		assert.equal(await user.locator(".msg-time").getAttribute("title"), null, "User time has no hover tooltip");
		assert.equal(await page.locator(".msg-role:not(.is-compact)").count(), 0, "Assistant identity is available only in details");
		assert.equal(await page.locator(".usage-model").count(), 0, "Route names stay inside usage details");
		assert.equal(await page.locator(".turn-process[open]").count(), 0, "Reasoning defaults to collapsed");
		for (const selector of [".msg-role", ".msg-time", ".usage-time", ".usage-trigger", ".usage-cost"]) {
			assert.ok((await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontSize))).every((size) => size === "12px"), `${selector} uses 12px metadata`);
		}
		assert.ok((await page.locator(".turn-process > summary").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fontSize))).every((size) => size === "13px"), "Process summaries use the existing base type scale");
		const buttons = user.locator(".message-buttons");
		assert.equal(await buttons.locator(".copy-btn .sr-only").count(), 1, "Message copy uses an icon-only control");
		assert.equal(await buttons.locator(".copy-btn").getAttribute("title"), null, "Icon-only copy has no hover tooltip");
		assert.equal(await buttons.locator(":scope > *").count(), 2, "User hover row contains only copy and time");
		assert.equal(await buttons.locator(".copy-btn + .msg-time").count(), 1, "Copy appears before the user timestamp");
		assert.equal(await buttons.evaluate((el) => getComputedStyle(el).opacity), "0");
		await bubble.hover();
		assert.equal(await buttons.evaluate((el) => getComputedStyle(el).opacity), "1");
		assert.deepEqual(await buttons.evaluate((el) => { const style = getComputedStyle(el); return { border: style.borderWidth, background: style.backgroundColor, shadow: style.boxShadow }; }), { border: "0px", background: "rgba(0, 0, 0, 0)", shadow: "none" }, "User hover row is plain metadata, not a floating panel");
		await buttons.locator(".copy-btn").hover();
		const userCopyHover = await buttons.locator(".copy-btn").evaluate((el) => { const probe = document.createElement("span"); probe.style.backgroundColor = "var(--chat-action-hover)"; el.append(probe); const result = { actual: getComputedStyle(el).backgroundColor, expected: getComputedStyle(probe).backgroundColor }; probe.remove(); return result; });
		assert.equal(userCopyHover.actual, userCopyHover.expected, "User copy shares the assistant hover surface");
		assert.deepEqual(await bubble.boundingBox(), bounds, "Hover actions never move the message");
		const toolbar = await buttons.boundingBox();
		assert.ok(Math.abs(toolbar.x + toolbar.width - bounds.x - bounds.width) < 24);
		assert.ok(Math.abs(toolbar.y - bounds.y - bounds.height) < 22);
		await page.mouse.move(0, 0);
		await user.getByRole("button", { name: "复制消息" }).focus();
		assert.equal(await buttons.evaluate((el) => getComputedStyle(el).opacity), "1", "Keyboard focus reveals actions");
		await page.evaluate(() => { document.activeElement.blur(); window.getSelection()?.removeAllRanges(); });
		const rects = await page.locator(".messages > .msg, .messages > .assistant-reply").evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
		assert.equal(Math.round(rects[1].top - rects[0].bottom), 8);
		assert.equal(Math.round(rects[2].top - rects[1].bottom), 32);
		const historicalActions = page.locator(".assistant-reply").nth(1).locator(".message-actions.is-historical");
		const latestActions = page.locator(".assistant-reply").last().locator(".message-actions");
		const latestTime = latestActions.locator(".usage-time");
		const opacity = async (locator, value) => {
			const node = await locator.elementHandle();
			await page.waitForFunction(({ node, value }) => getComputedStyle(node).opacity === value, { node, value });
			await node.dispose();
		};
		await latestActions.scrollIntoViewIfNeeded();
		await page.mouse.move(0, 0);
		assert.equal(await historicalActions.evaluate((el) => getComputedStyle(el).opacity), "0", "Historical reply metadata defaults to hidden");
		assert.equal(await latestActions.locator(".message-buttons").evaluate((el) => getComputedStyle(el).opacity), "1", "Latest reply copy action stays visible");
		await opacity(latestTime, "0");
		assert.equal(await page.locator(".usage-amount").count(), 0, "Costs stay inside details even for priced turns");
		assert.equal(await latestActions.locator(".usage-trigger").textContent(), "", "More is an icon-only control");
		assert.match(await latestActions.locator(".usage-trigger").getAttribute("aria-label"), /^消息详情（本轮用量 .* tok）$/);
		assert.deepEqual(await latestActions.locator(":scope > *").evaluateAll((nodes) => nodes.map((node) => node.className)), ["message-buttons", "turn-usage"], "Reply footer order is copy, more, time");
		const iconStyles = await latestActions.locator(".copy-btn, .usage-trigger").evaluateAll((nodes) => nodes.map((node) => {
			const s = getComputedStyle(node);
			return { width: s.width, height: s.height, padding: s.padding, radius: s.borderRadius, color: s.color, background: s.backgroundColor };
		}));
		assert.deepEqual(iconStyles[0], iconStyles[1], "Copy and more share dimensions, color and hover surfaces");
		assert.deepEqual(await buttons.locator(".copy-btn").evaluate((node) => { const s = getComputedStyle(node); return { width: s.width, height: s.height, padding: s.padding, radius: s.borderRadius, color: s.color, background: s.backgroundColor }; }), iconStyles[0], "User and assistant copy buttons share the same style");
		assert.equal(iconStyles[0].width, "28px");
		assert.equal(iconStyles[0].height, "28px");
		assert.equal(iconStyles[0].radius, "8px");
		await page.emulateMedia({ reducedMotion: "no-preference" });
		assert.ok((await latestActions.locator(".copy-btn, .usage-trigger").evaluateAll((nodes) => nodes.map((node) => { const s = getComputedStyle(node); return s.transitionProperty.includes("background-color") && s.transitionProperty.includes("color") && s.transitionDuration.split(", ").every((duration) => duration === "0.15s"); }))).every(Boolean), "Both icons animate background and color over 150ms");
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(await latestActions.evaluate((node) => getComputedStyle(node).marginTop), "12px");
		assert.ok(["none", "normal", '""'].includes(await latestTime.evaluate((node) => getComputedStyle(node, "::before").content)), "Time has no dot separator");
		const replyText = await page.locator(".assistant-reply").last().locator(".msg-body > .md > *").first().boundingBox();
		const copyIcon = await latestActions.locator(".message-buttons .copy-btn svg").boundingBox();
		assert.ok(Math.abs(copyIcon.x - replyText.x) <= 2, "Copy icon lines up with the answer text");
		const usageBox = await latestActions.locator(".turn-usage").boundingBox();
		assert.ok(usageBox.x - replyText.x <= 48, "Reply footer clusters on the left instead of drifting right");
		const copyBox = await latestActions.locator(".copy-btn").boundingBox();
		const moreBox = await latestActions.locator(".usage-trigger").boundingBox();
		assert.equal(moreBox.x - copyBox.x - copyBox.width, 4, "The icon buttons have a 4px gap");
		assert.equal((await latestTime.boundingBox()).x - moreBox.x - moreBox.width, 12, "Time clears the hover surface with a 12px gap");
		if (output) await page.screenshot({ path: `${output}/footer-idle-${theme}.png` });
		await latestActions.locator(".copy-btn").hover();
		await opacity(latestTime, "1");
		const hoverStyle = await latestActions.locator(".copy-btn").evaluate((node) => { const s = getComputedStyle(node); return { color: s.color, background: s.backgroundColor }; });
		await latestActions.locator(".usage-trigger").hover();
		assert.deepEqual(await latestActions.locator(".usage-trigger").evaluate((node) => { const s = getComputedStyle(node); return { color: s.color, background: s.backgroundColor }; }), hoverStyle, "Both icons use the same hover treatment");
		assert.notEqual(hoverStyle.background, "rgba(0, 0, 0, 0)");
		if (output) await page.screenshot({ path: `${output}/footer-hover-${theme}.png` });
		await page.locator(".assistant-reply").nth(1).hover();
		assert.equal(await historicalActions.evaluate((el) => getComputedStyle(el).opacity), "1", "Hover reveals historical reply metadata");
		await opacity(historicalActions.locator(".usage-time"), "1");
		await historicalActions.locator(".usage-trigger").click();
		assert.deepEqual(await page.locator(".usage-system dt").allTextContents(), ["渠道", "模型", "费用"]);
		assert.equal(await page.locator(".usage-relay").textContent(), "mock");
		assert.equal(await page.locator(".usage-model-label").textContent(), "glm-5.3-flash");
		assert.equal(await page.locator(".usage-model-label").evaluate((node) => node.scrollWidth <= node.clientWidth), true, "Ordinary model names fit without premature truncation");
		assert.deepEqual(await page.locator(".usage-popover").evaluate((node) => {
			const s = getComputedStyle(node);
			const probe = document.createElement("div");
			probe.style.cssText = "color: var(--text); background: var(--surface); border: 1px solid var(--boundary); box-shadow: var(--shadow-elevation-2)";
			node.append(probe);
			const expected = getComputedStyle(probe);
			const result = {
				width: s.width, radius: s.borderRadius,
				softBorder: s.borderColor !== expected.borderColor,
				surface: s.backgroundColor === expected.backgroundColor,
				shadow: s.boxShadow === expected.boxShadow,
				values: [...node.querySelectorAll(".usage-model, .usage-cost")].every((button) => getComputedStyle(button).color === expected.color),
				relay: getComputedStyle(node.querySelector(".usage-relay")).color !== expected.color,
			};
			probe.remove();
			return result;
		}), { width: "280px", radius: "12px", softBorder: true, surface: true, shadow: true, values: true, relay: true }, "Details use a compact soft surface with clear model/cost hierarchy");
		const panelBox = await page.locator(".usage-popover").boundingBox();
		const anchorBox = await historicalActions.locator(".usage-trigger").boundingBox();
		assert.equal(Math.round(Math.max(panelBox.y - anchorBox.y - anchorBox.height, anchorBox.y - panelBox.y - panelBox.height)), 6, "Details leave a 6px gap from the trigger");
		for (const selector of [".usage-model", ".usage-cost"]) {
			await page.locator(selector).hover();
			assert.notEqual(await page.locator(selector).evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)", "Copyable values provide hover feedback");
		}
		await page.locator(".usage-popover").hover();
		await page.evaluate(() => document.activeElement.blur());
		await page.mouse.move(0, 0);
		assert.equal(await historicalActions.evaluate((node) => getComputedStyle(node).opacity), "1", "An open historical panel keeps the footer visible without hover or focus");
		assert.equal(await historicalActions.locator(".message-buttons").evaluate((node) => getComputedStyle(node).opacity), "1", "Copy stays visible with the historical panel");
		assert.equal(await historicalActions.locator(".usage-time").evaluate((node) => getComputedStyle(node).opacity), "1", "The open panel keeps the time visible");
		if (output) {
			await page.screenshot({ path: `${output}/footer-details-${theme}.png` });
			const x = Math.max(0, Math.min(panelBox.x, anchorBox.x - 32) - 16);
			const y = Math.max(0, Math.min(panelBox.y, anchorBox.y) - 16);
			await page.screenshot({ path: `${output}/detail-closeup-${theme}.png`, clip: { x, y, width: Math.min(1100 - x, Math.max(panelBox.x + panelBox.width, anchorBox.x + anchorBox.width + 64) - x + 16), height: Math.min(960 - y, Math.max(panelBox.y + panelBox.height, anchorBox.y + anchorBox.height) - y + 16) } });
		}
		await page.keyboard.press("Escape");
		await opacity(historicalActions.locator(".usage-time"), "1");
		assert.equal(await historicalActions.evaluate((node) => getComputedStyle(node).opacity), "1", "Escape restores focus and keeps keyboard actions visible");
		await page.evaluate(() => { document.activeElement.blur(); window.getSelection()?.removeAllRanges(); });
		await page.mouse.move(0, 0);
		await opacity(latestTime, "0");
		const collapsedTimeX = await latestTime.evaluate((node) => node.getBoundingClientRect().x);
		await latestActions.locator(".usage-trigger").click();
		assert.equal(await latestTime.evaluate((node) => node.getBoundingClientRect().x), collapsedTimeX, "Opening usage must not shift the footer row");
		await page.keyboard.press("Escape");
		for (const width of [1100, 520, 360]) {
			await page.setViewportSize({ width, height: 1200 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector(".messages").scrollWidth <= document.querySelector(".messages").clientWidth), true, `No horizontal overflow at ${width}px`);
			assert.ok((await page.locator(".msg-role").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left))).every((left) => left >= 0), "AI icons stay within the viewport");
			assert.ok(await page.locator(".messages").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom) >= 8));
			await page.evaluate(() => { document.querySelector(".messages").scrollTop = 0; });
			if (output) await page.screenshot({ path: `${output}/conversation-${theme}-${width}.png` });
		}
		await page.setViewportSize({ width: 1100, height: 600 });
		await page.evaluate(({ messages, models }) => window.turnUsageHarness.render({ messages: Array.from({ length: 10 }, () => messages).flat(), models, current: models[0] }), { messages, models });
		await page.locator(".msg").nth(59).waitFor();
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
		await page.evaluate(() => { document.querySelector(".messages").scrollTop = 0; });
		const back = page.getByRole("button", { name: "回到底部", exact: true });
		await back.waitFor();
		const size = await back.boundingBox(); assert.equal(size.width, size.height);
		assert.equal(await back.evaluate((el) => getComputedStyle(el).backdropFilter), "blur(12px)");
		assert.ok(await page.locator(".messages").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom) >= 8));
		await back.click(); await back.waitFor({ state: "detached" });
		assert.ok(await page.locator(".messages").evaluate((el) => { const last = el.lastElementChild.getBoundingClientRect(); return el.getBoundingClientRect().bottom - last.bottom >= 7; }));
		await page.evaluate(({ messages, models }) => window.turnUsageHarness.render({ messages, models, current: models[1], running: true, activeTurnId: "turn:pending", pendingPrompt: { id: "pending", userMessage: { id: "pending-user", role: "user", blocks: [{ kind: "text", text: "再检查一次" }] } } }), { messages, models });
		await page.locator(".waiting-reply").waitFor();
		assert.equal(await page.locator(".waiting-reply .msg-role.is-compact").count(), 0, "Waiting replies omit model identity");
		// One pi run spans text/tool/result messages; it must remain one reply bubble.
		const toolReply = [
			{ role: "user", content: "演示工具调用并汇总结果", timestamp },
			assistant([{ type: "text", text: "第一步：先检查文件，再运行命令。" }, { type: "toolCall", id: "read", name: "read", arguments: { path: "README.md" } }]),
			{ role: "toolResult", toolCallId: "read", toolName: "read", content: "文件已读取" },
		];
		const renderReply = async (entries, running) => {
			await page.evaluate(({ entries, models, running }) => window.turnUsageHarness.render({ messages: entries, models, current: models[0], running, activeTurnId: "turn:history_0" }), { entries, models, running });
		};
		await renderReply(toolReply, true);
		await page.locator(".turn-process > summary").click();
		await page.getByText("第一步：先检查文件，再运行命令。", { exact: true }).waitFor();
		await page.evaluate(() => { window.replyContainer = document.querySelector(".assistant-reply"); });
		toolReply.push(assistant([{ type: "text", text: "第二步：文件已读取，继续验证配置。" }, { type: "toolCall", id: "bash", name: "bash", arguments: { command: "echo ok" } }]), { role: "toolResult", toolCallId: "bash", toolName: "bash", content: "ok" });
		await renderReply(toolReply, true);
		await page.getByText("第二步：文件已读取，继续验证配置。", { exact: true }).waitFor();
		assert.equal(await page.locator(".assistant-reply").count(), 1, "Streaming tool steps share one bubble");
		assert.equal(await page.evaluate(() => document.querySelector(".assistant-reply") === window.replyContainer), true, "Appending steps preserves the existing reply container");
		toolReply.push(assistant("检查完成，所有结果均已核对。"), assistant([], { timestamp: timestamp + 1000 }));
		await renderReply(toolReply, false);
		await page.locator(".assistant-reply .usage-trigger").waitFor();
		assert.equal(await page.locator(".assistant-reply").count(), 1);
		assert.equal(await page.locator(".assistant-reply .message-bubble").count(), 0, "Segments never create nested bubbles");
		assert.deepEqual(await page.locator(".assistant-reply .msg-body > .md").allTextContents(), ["检查完成，所有结果均已核对。"]);
		assert.equal(await page.locator(".assistant-reply time").count(), 1, "Only the final timestamp is shown");
		assert.equal(await page.locator(".assistant-reply .message-buttons").count(), 1, "One copy action covers the full reply");
		const replyCopy = page.locator(".assistant-reply .message-buttons");
		await page.mouse.move(0, 0);
		await page.evaluate(() => document.activeElement.blur());
		assert.equal(await replyCopy.evaluate((el) => getComputedStyle(el).opacity), "1", "Latest reply action remains visible");
		await page.locator(".assistant-reply .msg-body > .md").first().hover();
		assert.equal(await replyCopy.evaluate((el) => getComputedStyle(el).opacity), "1", "Hovering any step reveals the reply action");
		await page.setViewportSize({ width: 1100, height: 960 });
		await page.mouse.move(0, 0);
		if (output) await page.screenshot({ path: `${output}/merged-reply-${theme}.png` });
		toolReply.push({ role: "user", content: "再核对一次", timestamp }, assistant("再次核对完成。"));
		await renderReply(toolReply, false);
		await page.getByText("再次核对完成。", { exact: true }).waitFor();
		assert.equal(await page.locator(".assistant-reply").count(), 2, "A new user prompt starts a new reply bubble");
		await page.close();
		const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
		touch.on("pageerror", (error) => errors.push(error.message));
		await touch.goto(`${base}/tests/turn-usage.html`);
		await touch.waitForFunction(() => window.turnUsageHarness);
		await touch.evaluate(({ messages, models, theme }) => { document.documentElement.dataset.theme = theme; window.turnUsageHarness.render({ messages, models, current: models[0] }); }, { messages, models, theme });
		await touch.locator(".usage-time").last().waitFor();
		assert.equal(await touch.evaluate(() => matchMedia("(hover: none)").matches), true);
		assert.ok((await touch.locator(".message-actions, .message-buttons, .usage-time").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).opacity))).every((value) => value === "1"), "Touch devices keep historical and latest actions and times visible");
		await touch.locator(".usage-trigger").last().tap();
		await touch.locator(".usage-popover").waitFor();
		await touch.close();
		console.log(`PASS ${theme}: minimal footer, hover/focus/open/touch states, equal icon styles, hierarchy, bubbles, model changes, spacing, 360px layout and floating navigation`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
