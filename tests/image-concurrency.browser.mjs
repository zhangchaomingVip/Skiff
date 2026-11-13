import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/image-concurrency", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const generate = () => page.getByRole("button", { name: "生成图片", exact: true });
const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt" });
const cards = () => page.locator(".generation-pending-card");
const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
const limit = () => settings().getByRole("combobox", { name: "同时生成任务数", exact: true });
async function setLimit(value) {
	await page.getByRole("button", { name: "管理生成服务", exact: true }).click();
	await limit().selectOption(String(value));
	await page.waitForFunction((expected) => JSON.parse(localStorage.getItem("skiff.test.images.config")).concurrencyLimit === expected, value);
	await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
}
async function submit(text) {
	await prompt().fill(text);
	await generate().click();
	await page.waitForFunction((expected) => window.skiffPreview.generation.calls.some((call) => call.prompt === expected), text);
	await page.waitForFunction(() => !document.querySelector(".generation-submit button[type=submit]")?.getAttribute("aria-busy"));
}

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.locator(".composer-input").waitFor();
		await page.evaluate(() => {
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: "images", services: [{ id: "images", name: "并发验证", baseUrl: "http://127.0.0.1/v1", configured: true, keyHint: "…test", defaultModel: "test-image", models: [{ id: "test-image", sizes: ["1024x1024"] }] }] }));
			localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
		});
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
		await prompt().waitFor();
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await page.getByRole("button", { name: "管理生成服务", exact: true }).click();
		assert.equal(await limit().inputValue(), "5", "Legacy configuration defaults to five");
		assert.deepEqual(await limit().locator("option").allTextContents(), ["3 个", "5 个", "10 个", "不限"]);
		await page.screenshot({ path: `dist/image-concurrency/${theme}-settings.png`, animations: "disabled" });
		await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
		await prompt().fill("任务 1");
		// Two synchronous submit events must still create only one billable task.
		await prompt().evaluate((input) => { input.form.requestSubmit(); input.form.requestSubmit(); });
		await page.waitForFunction(() => window.skiffPreview.generation.calls.length === 1);
		await cards().getByText("任务 1", { exact: true }).waitFor();
		await page.evaluate(() => window.skiffPreview.generation.deferNextJobs());
		await page.waitForFunction(() => window.skiffPreview.generation.hasDeferredJobs);
		await submit("任务 2");
		await page.evaluate(async () => { window.skiffPreview.generation.releaseJobs(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
		assert.equal(await cards().count(), 2, "An older poll must not erase the newly accepted task");
		for (let i = 3; i <= 5; i++) await submit(`任务 ${i}`);
		assert.equal(await cards().count(), 5);
		assert.equal(await generate().isDisabled(), true);
		assert.match(await page.locator(".generation-submit").innerText(), /进行中 5 \/ 5.*已达上限/);
		await prompt().press("Control+Enter");
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.length), 5);
		await page.screenshot({ path: `dist/image-concurrency/${theme}-five-running.png`, animations: "disabled" });
		await setLimit(3);
		assert.equal(await cards().count(), 5, "Lowering the limit preserves existing tasks");
		assert.equal(await generate().isDisabled(), true);
		await setLimit(10);
		await page.locator(".generation-gallery-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
		await submit("任务 6");
		assert.equal(await cards().count(), 6);
		assert.equal(await page.locator(".generation-gallery-scroll").evaluate((element) => element.scrollTop), 0, "Each submission reveals the new task even while other tasks are running");
		await page.evaluate(() => {
			const calls = window.skiffPreview.generation.calls;
			window.skiffPreview.generation.finishJob(calls[5].id);
			window.skiffPreview.generation.finishJob(calls[2].id, "failed");
		});
		await page.waitForFunction(() => document.querySelectorAll(".generation-pending-card").length === 4);
		await cards().filter({ hasText: "任务 2" }).getByRole("button", { name: "停止等待", exact: true }).click();
		await page.waitForFunction(() => document.querySelectorAll(".generation-pending-card").length === 3);
		assert.ok(await cards().filter({ hasText: "任务 1" }).count(), "Cancelling one task preserves another");
		assert.equal(await page.locator(".generation-card:not(.generation-pending-card)").count(), 1);
		await setLimit(0);
		for (let i = 7; i <= 15; i++) await submit(`任务 ${i}`);
		assert.equal(await cards().count(), 12, "Unlimited permits more than ten active jobs");
		assert.equal(await generate().isEnabled(), true);
		assert.match(await page.locator(".generation-submit").innerText(), /进行中 12 \/ 不限/);
		await page.reload();
		await page.waitForFunction(() => document.querySelectorAll(".generation-pending-card").length === 12);
		await page.getByRole("button", { name: "管理生成服务", exact: true }).click();
		assert.equal(await limit().inputValue(), "0", "Preference survives reload");
		await page.setViewportSize({ width: 600, height: 800 });
		await page.screenshot({ path: `dist/image-concurrency/${theme}-settings-narrow.png`, animations: "disabled" });
		await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
		await page.setViewportSize({ width: 1440, height: 1000 });
	}
	assert.deepEqual(errors, []);
	console.log("Image concurrency: defaults, all limits, stale polls, duplicate submit, out-of-order results, isolated cancellation, persistence and both themes passed");
} finally { await browser.close(); }
