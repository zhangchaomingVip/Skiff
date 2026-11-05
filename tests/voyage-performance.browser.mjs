// Real React session ownership and workspace persistence, with the isolated mock bridge.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(new URL("../.playwright-cli/package.json", import.meta.url))("playwright-core");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.argv[2] ?? "http://localhost:1421";
const chat = (index) => page.getByRole("navigation", { name: "项目列表" }).getByRole("button", { name: `Performance ${index}`, exact: true });
const receiptCount = () => page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "s0").turnPerformances?.filter(Boolean).length ?? 0);
const waitReceipts = (count) => page.waitForFunction((count) => JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === "s0").turnPerformances?.filter(Boolean).length === count, count);
const reading = async () => ({ speed: await page.locator(".voyage-weather-speed strong").textContent(), timing: await page.locator(".voyage-weather-speed p").textContent() });
async function openRail() {
	if (!await page.locator(".voyage-weather-speed").count()) await page.getByRole("button", { name: "航行台", exact: true }).click();
}
try {
	await page.addInitScript(() => {
		if (localStorage.getItem("skiff.performance-test.seeded")) return;
		const selectedModel = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
		const chats = [0, 1].map((index) => ({ id: `s${index}`, projectId: "p", title: `Performance ${index}`, customTitle: true, hasMessages: true, sessionFile: `s${index}.jsonl`, selectedModel, updatedAt: Date.now() - index }));
		localStorage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "p", name: "Performance", path: "D:/mock" }], chats, activeId: "s0" }));
		localStorage.setItem("skiff.test.sessions", JSON.stringify(Object.fromEntries(chats.map((chat) => [chat.sessionFile, [{ role: "user", content: "旧问题" }, { role: "assistant", provider: selectedModel.provider, model: selectedModel.id, content: "旧回答" }]]))));
		localStorage.setItem("skiff.sidebar.open", "true");
		localStorage.setItem("skiff.performance-test.seeded", "1");
	});
	await page.goto(`${base}/tests/session-switch.html?restore=1&delay=0`);
	await page.locator(".composer-input").waitFor();
	await openRail();
	await page.locator(".composer-input").fill("保留性能记录");
	await page.locator(".send-btn").click();
	await waitReceipts(1);
	const first = await reading();
	assert.notEqual(first.speed, "—");
	assert.match(first.timing, /首字 \d+(?:\.\d+)?(?:ms|s) · 纯吐字/);
	await chat(1).click();
	await page.locator(".composer-input").waitFor();
	await page.waitForFunction(() => document.querySelector(".voyage-weather-speed strong")?.textContent === "—");
	await chat(0).click();
	await page.waitForFunction((speed) => document.querySelector(".voyage-weather-speed strong")?.textContent === speed, first.speed);
	assert.deepEqual(await reading(), first);
	await page.reload();
	await page.locator(".composer-input").waitFor();
	await openRail();
	await page.waitForFunction((speed) => document.querySelector(".voyage-weather-speed strong")?.textContent === speed, first.speed);
	assert.deepEqual(await reading(), first);
	assert.equal(await receiptCount(), 1);
	// Record completion while another conversation owns the dashboard.
	await page.locator(".composer-input").fill("后台完成也保留性能记录");
	await page.locator(".send-btn").click();
	await chat(1).click();
	await waitReceipts(2);
	await chat(0).click();
	await page.waitForFunction(() => document.querySelector(".voyage-weather-speed strong")?.textContent !== "—");
	const background = await reading();
	await page.reload(); await page.locator(".composer-input").waitFor(); await openRail();
	await page.waitForFunction((speed) => document.querySelector(".voyage-weather-speed strong")?.textContent === speed, background.speed);
	assert.deepEqual(await reading(), background);
	assert.equal(await receiptCount(), 2);
	assert.deepEqual(errors, []);
	console.log("PASS performance persistence: A→B→A, workspace reload, background completion, second reload, no cross-session timing");
} finally { await browser.close(); }
