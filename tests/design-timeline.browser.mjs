import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";
import { openDesignCanvas } from "./workspace-navigation.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/design-timeline", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt" });

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.locator(".composer-input").waitFor();
		await page.evaluate((image) => {
			const serviceId = "timeline-service";
			const sizes = ["1024x1024", "1536x864"];
			const base = { serviceId, serviceName: "Timeline", modelId: "test-image", quality: "auto" };
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: serviceId, services: [{ id: serviceId, name: "Timeline", baseUrl: "http://127.0.0.1/v1", configured: true, keyHint: "…test", defaultModel: "test-image", models: [{ id: "test-image", sizes }] }] }));
			localStorage.setItem("skiff.test.images.jobs", JSON.stringify([
				{ ...base, id: "ok-1", prompt: "成功的一幅画", size: "1024x1024", actualSize: "1024x1024", status: "completed", path: image, createdAt: Date.now() - 1000 },
				{ ...base, id: "fail-1", prompt: "会失败的一幅画", size: "1024x1024", status: "failed", message: "HTTP 400：服务无法生成此图片。", createdAt: Date.now() },
			]));
			localStorage.setItem("skiff.test.design-assets", "[]");
			localStorage.removeItem("skiff.workspace.navigation.v1");
			localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
		}, `data:image/png;base64,${testImage().toString("base64")}`);
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
		await openDesignCanvas(page);

		// An error becomes a resumable draft, not a verbose log.
		const failed = page.locator(".design-turn").filter({ hasText: "会失败的一幅画" }).locator(".design-failure");
		await failed.waitFor();
		assert.match(await failed.innerText(), /生成失败，请调整后重试/);
		assert.equal(await failed.innerText().then((text) => text.includes("HTTP 400")), false, "The error log stays collapsed by default");
		await failed.getByRole("button", { name: "查看原因", exact: true }).click();
		await failed.locator(".design-failure-reason").waitFor();
		assert.match(await failed.locator(".design-failure-reason").innerText(), /HTTP 400/, "The reason stays one click away for debugging");
		await failed.getByRole("button", { name: "收起原因", exact: true }).click();
		assert.equal(await failed.locator(".design-failure-reason").count(), 0, "The reason collapses again");
		await failed.getByRole("button", { name: "修改后重新生成", exact: true }).click();
		await page.waitForFunction(() => document.querySelector(".design-dock textarea")?.value === "会失败的一幅画");
		assert.equal(await prompt().inputValue(), "会失败的一幅画", "The retry action hands the failed prompt back to the composer");

		// A successful retry retires the failure it replaced.
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await page.getByRole("button", { name: "生成图片", exact: true }).click();
		await page.getByText("正在生成图片…", { exact: true }).waitFor();
		await page.evaluate(() => window.skiffPreview.generation.finishJob(window.skiffPreview.generation.calls.at(-1).id));
		await page.locator(".design-turn").filter({ hasText: "会失败的一幅画" }).locator(".design-result-card").waitFor();
		await page.waitForFunction(() => document.querySelectorAll(".design-failure").length === 0, null, { timeout: 5000 });
		assert.equal(await page.locator(".design-result-card").count(), 2, "The retry's finished work and the earlier success both stay");

		// The asset library is a bare timeline grouped by day.
		await page.getByRole("navigation", { name: "素材", exact: true }).getByRole("button", { name: /^资产库/ }).click();
		await page.locator(".asset-timeline").waitFor();
		assert.ok(await page.locator(".asset-timeline-group").count() >= 1, "Works group under a date heading");
		assert.equal(await page.locator(".asset-thumb").count(), 2, "A thumbnail per finished work, including the successful retry");
		assert.equal(await page.locator(".generation-asset-info").count(), 0, "No model or size metadata on the grid");
		await page.screenshot({ path: `dist/design-timeline/${theme}-library.png`, animations: "disabled" });

		// The history drawer fills a reference without leaving the flow.
		await page.getByRole("button", { name: "返回创作", exact: true }).click();
		await page.locator(".design-history-trigger").click();
		await page.locator(".design-history-drawer").waitFor();
		assert.ok(await page.locator(".design-history-drawer .asset-thumb").count() >= 1);
		await page.locator(".design-history-drawer .asset-thumb-main").first().click();
		await page.locator(".design-composer .generation-reference.has-image").waitFor();
		assert.equal(await page.locator(".design-thread").isVisible(), true, "Filling a reference keeps the canvas flow open");
		await page.screenshot({ path: `dist/design-timeline/${theme}-drawer.png`, animations: "disabled" });
	}
	assert.deepEqual(errors, []);
	console.log("PASS timeline: immersive error retry, bare asset timeline and one-click history reference in both themes");
} finally { await browser.close(); }
