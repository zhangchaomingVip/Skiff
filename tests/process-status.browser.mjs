// Real MessageList render/keyboard/timer regression using the existing mock transcript harness.
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1421";
const shots = process.argv[3] ?? "docs/screenshots/process-status";
await mkdir(shots, { recursive: true });
let page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const user = { role: "user", content: "验证动态状态与终态摘要" };
const thought = (text = "分析当前操作") => ({ type: "thinking", thinking: text });
const call = (id, name = "read", args = { path: "src/MessageList.tsx" }) => ({ type: "toolCall", id, name, arguments: args });
const result = (id, isError = false) => ({ role: "toolResult", toolCallId: id, name: "read", content: "工具结果", isError });
const assistant = (content, stopReason) => ({ role: "assistant", content, stopReason });
const row = () => page.locator(".turn-process > summary").first();
const label = () => row().locator(".process-row-label");
const trailing = () => row().locator(".process-row-status");
const starPath = "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z";
const starAnimation = () => row().locator(".process-row-icon svg").evaluate((el) => getComputedStyle(el).animationName);
const render = async (messages, running = true, reason) => {
	await page.evaluate((props) => window.turnUsageHarness.render(props), { messages, running, activeTurnId: "turn:history_0", lastOutcome: reason ? { turnId: "turn:history_0", reason } : undefined });
	await page.clock.runFor(50);
};
const waitLabel = async (expected) => page.waitForFunction((expected) => document.querySelector(".turn-process > summary .process-row-label")?.textContent.includes(expected), expected);
const verifyNestedRow = async (nestedRow) => {
	await nestedRow.evaluate((el) => el.blur());
	await page.mouse.move(0, 0);
	const arrow = nestedRow.locator(".disclosure");
	const text = nestedRow.locator(".process-row-label");
	assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "0");
	assert.equal(await nestedRow.getAttribute("title"), null);
	assert.equal(await nestedRow.locator("[title]").count(), 0);
	assert.doesNotMatch(await nestedRow.textContent(), /已完成/);
	const before = await text.textContent();
	const beforeColor = await text.evaluate((el) => getComputedStyle(el).color);
	const beforeBox = await text.boundingBox();
	await text.hover();
	assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "1");
	assert.equal(await text.textContent(), before);
	assert.equal(await text.evaluate((el) => getComputedStyle(el).color), beforeColor);
	assert.deepEqual(await text.boundingBox(), beforeBox);
	const arrowBox = await arrow.boundingBox();
	assert.ok(arrowBox.x >= beforeBox.x + beforeBox.width && arrowBox.x - beforeBox.x - beforeBox.width <= 8);
	await arrow.hover();
	assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "1");
	await nestedRow.locator(".process-row-icon").hover();
	assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "1");
	const rowBox = await nestedRow.boundingBox();
	await page.mouse.move(rowBox.x + rowBox.width - 2, rowBox.y + rowBox.height / 2);
	assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "0");
	await page.keyboard.press("Escape");
	await nestedRow.focus();
	assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "1");
	await nestedRow.evaluate((el) => el.blur());
	await page.mouse.move(0, 0);
	assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "0");
};

try {
	for (const theme of ["light", "dark"]) {
		if (theme === "dark") {
			await page.close();
			page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
			page.on("pageerror", (error) => errors.push(error.message));
		}
		await page.route("**/favicon.ico", async (route) => {
			if (new URL(route.request().url()).hostname === "docs.docker.com") await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#2463cc"/></svg>' });
			else await route.abort();
		});
		// Some managed browsers reject remote images before routing. Keep the success fixture local.
		await page.addInitScript(() => document.addEventListener("error", (event) => {
			const img = event.target;
			if (img instanceof HTMLImageElement && img.src === "https://docs.docker.com/favicon.ico") {
				event.stopImmediatePropagation();
				img.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="#2463cc"/></svg>')}`;
			}
		}, true));
		// Open the full mock app in each theme as well as the isolated transcript regression.
		await page.goto(`${base}/tests/preview.html?fixture=process-actions&theme=${theme}`);
		await page.locator(".turn-process > summary").first().waitFor();
		await page.goto(`${base}/tests/turn-usage.html`);
		await page.waitForFunction(() => window.turnUsageHarness);
		await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
		await page.clock.install();
		await page.evaluate(() => {
			window.processTimers = new Set();
			const start = window.setInterval.bind(window);
			const stop = window.clearInterval.bind(window);
			window.setInterval = (handler, delay, ...args) => {
				const id = start(handler, delay, ...args);
				if (delay === 1000) window.processTimers.add(id);
				return id;
			};
			window.clearInterval = (id) => { window.processTimers.delete(id); stop(id); };
		});
		await render([user, assistant([thought()])]);
		await waitLabel("正在思考");
		assert.equal(await trailing().textContent(), "");
		assert.equal(await row().locator(".process-row-icon path").getAttribute("d"), starPath);
		assert.match(await starAnimation(), /process-star-turn/);
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(await starAnimation(), "none");
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.mouse.move(0, 0);
		const arrow = row().locator(".disclosure");
		assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "0");
		const restingLabel = await label().textContent();
		const restingColor = await label().evaluate((el) => getComputedStyle(el).color);
		const restingLabelBox = await label().boundingBox();
		const iconBox = await row().locator(".process-row-icon svg").boundingBox();
		assert.ok(restingLabelBox.x - iconBox.x - iconBox.width <= 4);
		await row().hover();
		assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "1");
		assert.equal(await row().getAttribute("title"), null);
		assert.equal(await label().textContent(), restingLabel);
		assert.equal(await label().evaluate((el) => getComputedStyle(el).color), restingColor);
		assert.deepEqual(await label().boundingBox(), restingLabelBox);
		const arrowBox = await arrow.boundingBox();
		assert.ok(arrowBox.x >= restingLabelBox.x + restingLabelBox.width && arrowBox.x - restingLabelBox.x - restingLabelBox.width <= 8);
		await page.screenshot({ path: `${shots}/hover-${theme}.jpg`, type: "jpeg", quality: 85 });
		await page.mouse.move(0, 0);
		assert.equal(await arrow.evaluate((el) => getComputedStyle(el).opacity), "0");
		assert.equal(await page.evaluate(() => window.processTimers.size), 1);
		const originalBox = await row().boundingBox();
		await page.clock.runFor(11_000);
		await waitLabel("已运行 11 秒");
		await render([user, assistant([thought("分析当前操作并继续")])]);
		await page.waitForFunction(() => !document.querySelector(".process-elapsed"));
		const calls = Array.from({ length: 5 }, (_, index) => call(String(index)));
		await render([user, assistant([thought(), ...calls]), result("3"), result("1", true)]);
		await waitLabel("正在并行运行 5 个工具（2/5）");
		assert.doesNotMatch(await label().textContent(), /失败|文件|段|字/);
		assert.equal(await trailing().textContent(), "");
		await page.screenshot({ path: `${shots}/parallel-${theme}.jpg`, type: "jpeg", quality: 85 });
		await row().focus();
		await page.keyboard.press("Enter");
		assert.equal(await row().getAttribute("aria-expanded"), "true");
		assert.equal(await page.locator(".turn-process .tool").count(), 5);
		await page.keyboard.press(" ");
		assert.equal(await row().getAttribute("aria-expanded"), "false");
		const complete = [user, assistant([thought(), ...calls]), ...[3, 1, 4, 0, 2].map((id) => result(String(id), id === 1)), assistant("已自动重试并完成。", "stop")];
		await render(complete, false, "stop");
		await waitLabel("读取了 5 个文件");
		assert.doesNotMatch(await label().textContent(), /失败/);
		assert.equal(await trailing().textContent(), "");
		assert.equal(await row().locator(".process-row-icon path").getAttribute("d"), starPath);
		assert.equal(await starAnimation(), "none");
		const finalBox = await row().boundingBox();
		assert.equal(finalBox.x, originalBox.x);
		assert.equal(finalBox.y, originalBox.y);
		assert.equal(finalBox.height, originalBox.height);
		assert.equal(await page.evaluate(() => window.processTimers.size), 0);
		await page.screenshot({ path: `${shots}/complete-${theme}.jpg`, type: "jpeg", quality: 85 });
		const expandedCalls = [
			call("cmd", "bash", { command: "node --version && npm test && git status --short ".repeat(8) }),
			call("edit", "edit", { path: "src/example.ts", oldText: "old", newText: "new" }),
			call("web", "web_search", { query: "React 状态管理" }),
			call("agent", "subagent", { agent: "reviewer", task: "检查结果" }),
		];
		await page.emulateMedia({ reducedMotion: "reduce" });
		await render([user, assistant([thought("展开后保留思考与工具调用的完整明细"), ...expandedCalls]), ...["cmd", "edit", "web", "agent", "orphan"].map((id) => result(id, id === "agent")), assistant("完成。", "stop")], false, "stop");
		await row().click();
		const toolGroup = page.locator(".tool-run > summary").first();
		await verifyNestedRow(toolGroup);
		await toolGroup.click();
		await verifyNestedRow(toolGroup);
		const nestedTool = page.locator(".tool > summary").first();
		await verifyNestedRow(nestedTool);
		assert.equal(await nestedTool.locator(".process-row-status").textContent(), "");
		await page.keyboard.press("Tab");
		await nestedTool.focus();
		assert.equal(await nestedTool.locator(".disclosure").evaluate((el) => getComputedStyle(el).opacity), "1");
		await page.keyboard.press("Enter");
		assert.equal(await nestedTool.getAttribute("aria-expanded"), "true");
		await verifyNestedRow(nestedTool);
		await page.screenshot({ path: `${shots}/nested-expanded-${theme}.jpg`, type: "jpeg", quality: 85 });
		await nestedTool.click();
		await verifyNestedRow(page.locator(".thinking > summary").first());
		await verifyNestedRow(page.locator(".tool-result > summary").first());
		assert.equal(await page.locator(".tool-result > summary .process-row-status").textContent(), "");
		const editRow = page.locator(".tool > summary").nth(1);
		await verifyNestedRow(editRow);
		assert.match(await editRow.locator(".tool-diff-count").textContent(), /\+1-1/);
		await editRow.click();
		const editCard = page.locator(".tool").nth(1).locator(".tool-content");
		assert.equal(await editCard.locator("summary").count(), 0);
		assert.equal(await editCard.getByRole("region", { name: "文件变更", exact: true }).count(), 1);
		assert.equal(await editCard.locator(".copy-btn").count(), 1);
		await page.setViewportSize({ width: 390, height: 800 });
		await verifyNestedRow(toolGroup);
		await verifyNestedRow(nestedTool);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.screenshot({ path: `${shots}/nested-narrow-${theme}.jpg`, type: "jpeg", quality: 85 });
		await page.setViewportSize({ width: 1200, height: 900 });
		await row().click();
		const contentLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
		const searchText = `摘要：保留搜索导语，帮助理解来源。\n\n### Docker release notes | Docker Docs\nhttps://docs.docker.com/desktop/release-notes\n## 4.43.0\n2025-07-03\n> Download Docker Desktop\n${"版本更新与修复详情。\n".repeat(14)}\n### Release news\nhttps://example.org/releases\n**更新信息**与来源。`;
		const detailCalls = [
			call("detail-cmd", "bash", { command: "npm test" }),
			call("detail-edit", "edit", { path: "src/example.ts", oldText: "old", newText: "new" }),
			call("detail-write", "write", { path: "docs/example.md", content: contentLines }),
			call("detail-read", "read", { path: "src/example.ts", offset: 3, limit: 20 }),
			call("detail-agent", "subagent", { agent: "reviewer", task: `检查文件与测试结果\n${contentLines}` }),
			call("detail-web", "web_search", { query: "Docker release notes", max_results: 3 }),
			call("detail-bad", "edit", { path: "missing.txt", oldText: "before", newText: "after" }),
		];
		await render([user, assistant([thought("核对过程材料，随后在正文给出结论。"), ...detailCalls]), ...detailCalls.map((tool) => ({ role: "toolResult", toolCallId: tool.id, name: tool.name, content: tool.id === "detail-web" ? searchText : tool.id === "detail-read" || tool.id === "detail-cmd" ? contentLines : tool.id === "detail-bad" ? "目标文件不存在" : "工具结果", isError: tool.id === "detail-bad" })), assistant("正文结论保持独立。", "stop")], false, "stop");
		if (await row().getAttribute("aria-expanded") !== "true") await row().click();
		const detailGroup = page.locator(".tool-run > summary").first();
		if (await detailGroup.getAttribute("aria-expanded") !== "true") await detailGroup.click();
		await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text) => { window.copiedToolText = text; } } }));
		for (let i = 0; i < detailCalls.length; i++) {
			const tool = page.locator(".tool").nth(i);
			const summary = tool.locator(":scope > summary");
			if (await summary.getAttribute("aria-expanded") !== "true") await summary.click();
			assert.equal(await tool.locator(".tool-content summary").count(), 0);
			assert.equal(await tool.locator(".tool-content .copy-btn").count(), 1);
		}
		const cards = page.locator(".tool-content");
		await cards.nth(0).getByRole("button", { name: "复制命令", exact: true }).click();
		assert.equal(await page.evaluate(() => window.copiedToolText), "npm test");
		assert.doesNotMatch(await cards.nth(0).locator(".tool-output").last().textContent(), /line 1\n/);
		await cards.nth(0).getByRole("button", { name: /显示全部/ }).click();
		assert.match(await cards.nth(0).locator(".tool-output").last().textContent(), /line 1\n/);
		await cards.nth(0).screenshot({ path: `${shots}/details-command-${theme}.jpg`, type: "jpeg", quality: 85 });
		assert.equal(await cards.nth(1).getByRole("region", { name: "文件变更", exact: true }).count(), 1);
		assert.match(await cards.nth(1).locator(".tool-diff").textContent(), /-old\+new/);
		assert.doesNotMatch(await cards.nth(1).textContent(), /调用参数|oldText|newText/);
		await cards.nth(1).getByRole("button", { name: "复制文件变更", exact: true }).click();
		assert.equal(await page.evaluate(() => window.copiedToolText), "-old\n+new");
		await cards.nth(1).screenshot({ path: `${shots}/details-edit-${theme}.jpg`, type: "jpeg", quality: 85 });
		assert.equal(await cards.nth(2).getByRole("region", { name: "写入内容", exact: true }).count(), 1);
		assert.match(await cards.nth(2).locator(".tool-output").first().textContent(), /^line 1\n/);
		assert.doesNotMatch(await cards.nth(2).locator(".tool-output").first().textContent(), /line 20/);
		await cards.nth(2).getByRole("button", { name: "复制写入内容", exact: true }).click();
		assert.equal(await page.evaluate(() => window.copiedToolText), contentLines);
		assert.equal(await cards.nth(3).getByRole("region", { name: "文件内容", exact: true }).count(), 1);
		assert.match(await cards.nth(3).textContent(), /从第 3 行起 · 最多 20 行/);
		assert.match(await cards.nth(3).locator(".tool-output").textContent(), /^line 1\n/);
		assert.match(await cards.nth(4).textContent(), /委派任务.*代理 · reviewer.*检查文件与测试结果/s);
		await cards.nth(4).screenshot({ path: `${shots}/details-agent-${theme}.jpg`, type: "jpeg", quality: 85 });
		const web = cards.nth(5);
		assert.doesNotMatch(await web.textContent(), /调用参数|max_results|query|###|> Download/);
		assert.equal(await page.locator(".tool").nth(5).locator(":scope > summary .process-row-label").textContent(), "搜索网页（2 个结果）");
		assert.equal(await web.locator(".tool-search-excerpt").count(), 0);
		assert.doesNotMatch(await web.textContent(), /摘要与摘录|保留搜索导语|版本更新与修复详情/);
		assert.equal(await web.getByRole("button", { name: /摘要|摘录/ }).count(), 0);
		assert.equal(await web.locator(".tool-search-link").count(), 2);
		assert.equal(await web.locator(".tool-search-link").first().getAttribute("href"), "https://docs.docker.com/desktop/release-notes");
		assert.equal(await web.locator(".tool-search-source").first().textContent(), "docs.docker.com");
		await web.locator(".tool-search-link").first().scrollIntoViewIfNeeded();
		await page.clock.runFor(100);
		await web.locator(".tool-search-site-icon img.is-loaded").waitFor({ timeout: 5000 });
		await web.locator(".tool-search-site-icon").nth(1).locator("img").waitFor({ state: "detached" });
		assert.equal(await web.locator(".tool-search-site-icon").nth(1).textContent(), "E");
		const searchTitleBox = await web.locator(".tool-search-title").first().boundingBox();
		const searchDomainBox = await web.locator(".tool-search-source").first().boundingBox();
		assert.ok(searchDomainBox.x > searchTitleBox.x + searchTitleBox.width);
		assert.ok(Math.abs(searchTitleBox.y + searchTitleBox.height / 2 - searchDomainBox.y - searchDomainBox.height / 2) < 2);
		await page.locator(".tool").nth(5).screenshot({ path: `${shots}/details-web-${theme}.jpg`, type: "jpeg", quality: 85 });
		await web.getByRole("button", { name: "复制搜索结果", exact: true }).click();
		assert.equal(await page.evaluate(() => window.copiedToolText), searchText);
		assert.equal(await cards.nth(6).getByRole("region", { name: "拟议变更", exact: true }).count(), 1);
		assert.match(await cards.nth(6).getByRole("region", { name: "错误信息", exact: true }).textContent(), /目标文件不存在/);
		const thinking = page.locator(".thinking").first();
		await thinking.locator(":scope > summary").click();
		assert.equal(await thinking.locator(".thinking-note-label").textContent(), "过程记录");
		const thoughtStyle = await thinking.locator("pre").evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color, background: getComputedStyle(el.parentElement).backgroundColor }));
		const replyStyle = await page.locator(".msg.assistant .md").last().evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color }));
		assert.ok(thoughtStyle.size < replyStyle.size);
		assert.notEqual(thoughtStyle.color, replyStyle.color);
		assert.notEqual(thoughtStyle.background, "rgba(0, 0, 0, 0)");
		await thinking.screenshot({ path: `${shots}/details-thinking-${theme}.jpg`, type: "jpeg", quality: 85 });
		await page.setViewportSize({ width: 390, height: 800 });
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.locator(".tool").nth(5).screenshot({ path: `${shots}/details-web-narrow-${theme}.jpg`, type: "jpeg", quality: 85 });
		await page.setViewportSize({ width: 1200, height: 900 });
		await row().click();
		const manyHits = Array.from({ length: 50 }, (_, i) => `### ${i + 1}. Release news with a long title that should stay on one line ${"and useful context ".repeat(8)}\nhttps://example.org/news/${i}\nSource excerpt ${i}`).join("\n\n");
		await render([user, assistant([call("many-web", "web_search", { query: "release news" })]), { role: "toolResult", toolCallId: "many-web", name: "web_search", content: manyHits }, assistant("搜索完成。", "stop")], false, "stop");
		if (await row().getAttribute("aria-expanded") !== "true") await row().click();
		const manyTool = page.locator(".tool").first();
		if (await manyTool.locator(":scope > summary").getAttribute("aria-expanded") !== "true") await manyTool.locator(":scope > summary").click();
		assert.equal(await manyTool.locator(":scope > summary .process-row-label").textContent(), "搜索网页（50 个结果）");
		const sourceList = manyTool.locator(".tool-search-list");
		assert.equal(await sourceList.locator(".tool-search-link").count(), 50);
		assert.equal(await sourceList.evaluate((el) => el.scrollHeight > el.clientHeight), true);
		await sourceList.locator(".tool-search-link").last().scrollIntoViewIfNeeded();
		assert.equal(await sourceList.evaluate((el) => el.scrollTop > 0), true);
		await sourceList.evaluate((el) => { el.scrollTop = 0; });
		await manyTool.screenshot({ path: `${shots}/search-list-${theme}.jpg`, type: "jpeg", quality: 85 });
		await page.setViewportSize({ width: 390, height: 800 });
		assert.equal(await sourceList.locator(".tool-search-title").first().evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).whiteSpace === "nowrap"), true);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await manyTool.screenshot({ path: `${shots}/search-list-narrow-${theme}.jpg`, type: "jpeg", quality: 85 });
		await page.setViewportSize({ width: 1200, height: 900 });
		await row().click();
		// Expanded details preserve the original thinking and tool step order.
		const orderHistory = [user, assistant([call("order-a", "bash", { command: "pwd" }), thought("第一段思考"), call("order-b", "read", { path: "src/order.ts" }), thought("第二段思考")]), result("order-a"), result("order-b"), assistant([thought("第三段思考")])];
		await render(orderHistory);
		await waitLabel("正在思考");
		if (await row().getAttribute("aria-expanded") !== "true") await row().click();
		const detailOrder = () => page.locator(".turn-process-body").first().evaluate((el) => [...el.children].map((child) => child.classList.contains("thinking") ? "thinking" : "action"));
		assert.deepEqual(await detailOrder(), ["action", "thinking", "action", "thinking", "thinking"]);
		assert.deepEqual(await page.locator(".thinking pre").allTextContents(), ["第一段思考", "第二段思考", "第三段思考"]);
		const withNextTool = [...orderHistory, assistant([call("order-c", "bash", { command: "npm test" })])];
		await render(withNextTool);
		await waitLabel("正在运行 npm test");
		assert.deepEqual(await detailOrder(), ["action", "thinking", "action", "thinking", "thinking", "action"]);
		assert.deepEqual(await page.locator(".tool > summary .tool-target").allTextContents(), ["pwd", "src/order.ts", "npm test"]);
		await render([...withNextTool, result("order-c"), assistant("结论保持在过程之后。", "stop")], false, "stop");
		assert.deepEqual(await detailOrder(), ["action", "thinking", "action", "thinking", "thinking", "action"]);
		await page.locator(".turn-process").first().screenshot({ path: `${shots}/thinking-first-${theme}.jpg`, type: "jpeg", quality: 85 });
		await row().click();
		for (const isError of [false, true]) {
			await render([user, assistant([call("empty-web", "web_search", { query: "test" })]), { role: "toolResult", toolCallId: "empty-web", name: "web_search", content: isError ? "搜索服务暂不可用" : "没有找到相关结果。", isError }, assistant("完成。", "stop")], false, "stop");
			if (await row().getAttribute("aria-expanded") !== "true") await row().click();
			const emptyTool = page.locator(".tool").first();
			if (await emptyTool.locator(":scope > summary").getAttribute("aria-expanded") !== "true") await emptyTool.locator(":scope > summary").click();
			assert.equal(await emptyTool.locator(".copy-btn").count(), 1);
			assert.equal(await emptyTool.locator(".tool-search-link").count(), 0);
			if (isError) assert.match(await emptyTool.getByRole("region", { name: "错误信息", exact: true }).textContent(), /搜索服务暂不可用/);
			else {
				assert.match(await emptyTool.locator(":scope > summary").textContent(), /搜索网页（0 个结果）/);
				assert.match(await emptyTool.locator(".tool-content").textContent(), /没有找到相关结果/);
			}
			await row().click();
		}
		await render([user, assistant([call("pending-agent", "subagent", { agent: "reviewer", task: "核查实现与测试" })])]);
		if (await row().getAttribute("aria-expanded") !== "true") await row().click();
		const pendingTool = page.locator(".tool").first();
		if (await pendingTool.locator(":scope > summary").getAttribute("aria-expanded") !== "true") await pendingTool.locator(":scope > summary").click();
		assert.match(await pendingTool.locator(".tool-content").textContent(), /核查实现与测试.*等待工具执行结果/s);
		assert.equal(await pendingTool.locator(".copy-btn").count(), 1);
		assert.equal(await pendingTool.locator(".tool-content summary").count(), 0);
		await row().click();
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await render([user, assistant([call("bad")]), result("bad", true), assistant([], "error")], false, "error");
		await waitLabel("（1 失败）");
		assert.equal(await trailing().textContent(), "失败");
		assert.equal(await trailing().locator(".failed").count(), 1);
		await page.screenshot({ path: `${shots}/failed-${theme}.jpg`, type: "jpeg", quality: 85 });
		await render([user, assistant([call("secret", "bash", { command: "npm test --token private-token --password private-password" })])]);
		await waitLabel("正在运行 npm test");
		assert.doesNotMatch(await row().textContent(), /private-token|private-password/);
		assert.equal(await row().getAttribute("title"), null);
		await page.clock.runFor(11_000);
		await waitLabel("已运行");
		await page.setViewportSize({ width: 390, height: 800 });
		assert.equal(await page.locator(".process-elapsed").isVisible(), true);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await page.screenshot({ path: `${shots}/stalled-narrow-${theme}.jpg`, type: "jpeg", quality: 85 });
		await render([user], false);
		assert.equal(await page.evaluate(() => window.processTimers.size), 0);
		await page.setViewportSize({ width: 1200, height: 900 });
		const markdown = "普通正文与 **行内加粗** 保持字号一致。\n\n**独立强调句保持正文字号。**\n\n# **一级标题**\n\n## 二级标题\n\n### 三级标题\n\n#### 四级标题\n\n##### 五级标题\n\n###### 六级标题\n\n- 列表里的 **加粗** 也只改变字重。\n\n> 引用里的 **强调** 保持引用字号。";
		await render([user, assistant(markdown, "stop")], false, "stop");
		const typography = await page.locator(".msg.assistant .md").evaluate((md) => ({
			body: parseFloat(getComputedStyle(md).fontSize),
			paragraphs: [...md.querySelectorAll("p")].map((p) => ({ heading: !!p.closest("h1,h2,h3,h4,h5,h6"), size: getComputedStyle(p).fontSize })),
			strong: [...md.querySelectorAll("strong")].map((strong) => ({ size: getComputedStyle(strong).fontSize, parentSize: getComputedStyle(strong.parentElement).fontSize, weight: getComputedStyle(strong).fontWeight, color: getComputedStyle(strong).color, parentColor: getComputedStyle(strong.parentElement).color })),
			headings: [...md.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({ tag: h.tagName, size: parseFloat(getComputedStyle(h).fontSize) })),
		}));
		assert.equal(typography.headings.length, 6);
		assert.equal(typography.strong.length, 5);
		for (const strong of typography.strong) {
			assert.equal(strong.size, strong.parentSize);
			assert.equal(strong.color, strong.parentColor);
			assert.ok(Number(strong.weight) >= 500);
		}
		assert.ok(typography.paragraphs.every((p) => !p.heading));
		assert.ok(typography.headings.every((h) => h.size <= Math.max(18, typography.body)));
		assert.ok(typography.headings[0].size >= typography.headings[1].size && typography.headings[1].size >= typography.headings[2].size);
		await page.screenshot({ path: `${shots}/typography-${theme}.jpg`, type: "jpeg", quality: 85 });
		console.log(`PASS: ${theme} theme`);
	}
	assert.deepEqual(errors, []);
	console.log("PASS: both themes, dynamic status, parallel progress, recovered/final failure, safe labels, stall clocks/cleanup, keyboard folding, stars, hover arrows, typography, narrow layout, tool content hierarchy, single full-content copy, task previews, thinking separation and linked search results");
} finally {
	await browser.close();
}
