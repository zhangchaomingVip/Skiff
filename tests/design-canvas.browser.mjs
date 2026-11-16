import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";
import { openCanvasComposer, openDesignCanvas } from "./workspace-navigation.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/design-canvas", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const video = `data:video/mp4;base64,${readFileSync("tests/fixtures/video.mp4.b64", "utf8").trim()}`;
const canvases = () => page.getByRole("navigation", { name: "画布", exact: true });
const scene = () => page.locator(".design-canvas-scene");
const crumb = () => page.locator(".canvas-crumb");
const kindSwitch = () => page.getByRole("group", { name: "创作类型", exact: true });
const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt", exact: true });
const currentRows = () => page.locator(".design-canvas-row[aria-current=page]").evaluateAll((rows) => rows.map((row) => row.innerText.replace(/\s+/g, " ").trim()));

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(({ image, video }) => {
			const serviceId = "canvas-service";
			const sizes = ["1024x1024", "1536x864", "864x1536"];
			const now = Date.now();
			const base = { serviceId, serviceName: "灵感工作室", modelId: "image-studio", quality: "auto" };
			const job = (id, prompt, size, canvasId, offset) => ({ ...base, id, prompt, size, actualSize: size, status: "completed", path: image, createdAt: now - offset, canvasId });
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: serviceId, services: [{ id: serviceId, name: "灵感工作室", baseUrl: "http://127.0.0.1/v1", configured: true, keyHint: "…test", defaultModel: "image-studio", models: [{ id: "image-studio", sizes }] }] }));
			localStorage.setItem("skiff.test.images.jobs", JSON.stringify([
				job("img-a1", "窗边的花与午后的光", "1536x864", "canvas-summer", 3000),
				job("img-a2", "山间来信", "864x1536", "canvas-summer", 2000),
				job("img-b1", "夜里的霓虹街角", "1024x1024", "canvas-night", 1000),
				job("img-u1", "还没分组的一张草稿", "1024x1024", undefined, 500),
			]));
			localStorage.setItem("skiff.test.videos.jobs", JSON.stringify([{ id: "vid-a1", status: "completed", prompt: "夏日海浪的一秒钟", serviceId, serviceName: "灵感工作室", baseUrl: "http://127.0.0.1/v1", modelId: "muse-video", duration: 5, ratio: "9:16", resolution: "1080p", createdAt: now - 400, completedAt: now, hasReference: false, path: video, canvasId: "canvas-summer" }]));
			localStorage.setItem("skiff.design.canvases.v1", JSON.stringify({ version: 1, activeId: "", canvases: [{ id: "canvas-summer", name: "夏日短片", createdAt: 1, updatedAt: 2 }, { id: "canvas-night", name: "夜色街拍", createdAt: 3, updatedAt: 4 }] }));
			localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
		}, { image: `data:image/png;base64,${testImage().toString("base64")}`, video });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);

		// The home is a feed: one composer above every recent image and video.
		await page.locator(".studio-home").waitFor();
		await page.locator(".studio-gallery").waitFor();
		await page.waitForFunction(() => document.querySelectorAll(".studio-gallery .generation-card").length === 5);
		assert.match(await page.locator(".studio-gallery-head").innerText(), /最近创作[\s\S]*全部作品[\s\S]*05/, "The home gallery files every work under one recent-works heading");
		assert.equal(await page.getByRole("button", { name: "画布：未分组", exact: true }).count(), 1, "The composer still targets a canvas");
		assert.equal(await canvases().getByRole("button").count(), 4, "Two canvases, ungrouped and the create action");
		assert.deepEqual(await currentRows(), ["首页 5"], "The launcher owns the only highlight and counts every work");
		await page.screenshot({ path: `dist/design-canvas/${theme}-home.png`, animations: "disabled" });

		// Gallery actions refill the composer without leaving home.
		const sourceCard = page.locator(".studio-gallery .generation-card").filter({ hasText: "窗边的花与午后的光" });
		await sourceCard.hover();
		await sourceCard.getByRole("button", { name: "复用提示词", exact: true }).click();
		assert.equal(await prompt().inputValue(), "窗边的花与午后的光", "Reusing a work seeds the composer prompt");
		await sourceCard.getByRole("button", { name: "作为参考图", exact: true }).click();
		await page.locator(".design-composer .generation-reference.has-image").waitFor();
		assert.equal(await page.locator(".design-canvas-scene").count(), 0, "Gallery actions keep the home feed in place");
		await page.getByRole("button", { name: "移除图生图参考图", exact: true }).click();
		await page.getByRole("button", { name: "清空提示词", exact: true }).click();

		// Submitting inserts the task at the head of the feed; no route change.
		await prompt().fill("首页生成留在这里");
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await page.getByRole("button", { name: "生成图片", exact: true }).click();
		const pending = page.locator(".studio-gallery .studio-pending-card");
		await pending.waitFor();
		assert.equal(await page.locator(".design-canvas-scene").count(), 0, "Submitting stays on the home feed");
		assert.equal(await page.locator(".studio-gallery .generation-card").first().evaluate((element) => element.classList.contains("studio-pending-card")), true, "The pending task owns the first slot");
		await page.screenshot({ path: `dist/design-canvas/${theme}-pending-home.png`, animations: "disabled" });
		const pendingId = await page.evaluate(async () => (await window.skiffPreview.generation.calls).at(-1).id);
		await page.evaluate((id) => window.skiffPreview.generation.finishJob(id, "failed"), pendingId);
		await pending.waitFor({ state: "detached" });

		// The sidebar scopes the same feed to a canvas.
		await openDesignCanvas(page);
		assert.deepEqual(await currentRows(), ["未分组 1"], "The canvas scene hands the highlight to its canvas");
		assert.match(await crumb().innerText(), /未分组/);
		assert.match(await crumb().innerText(), /1 件图片/, "Ungrouped names the active work type and count");
		assert.equal(await scene().locator(".generation-card").count(), 1);
		const composer = await openCanvasComposer(page);
		assert.equal(await composer.isVisible(), true, "The composer stays above every canvas gallery");
		assert.equal(await prompt().count(), 1, "One composer owns the whole studio");

		await canvases().getByRole("button", { name: /^夏日短片/ }).click();
		await scene().waitFor();
		assert.match(await crumb().innerText(), /夏日短片/);
		assert.match(await crumb().innerText(), /2 件图片/, "The canvas count follows the active work type");
		assert.equal(await scene().locator(".generation-card").count(), 2, "The image gallery shows the two images of this canvas");
		await page.screenshot({ path: `dist/design-canvas/${theme}-canvas.png`, animations: "disabled" });

		await kindSwitch().getByRole("button", { name: "视频", exact: true }).click();
		await scene().locator(".generation-card[data-kind=video]").first().waitFor();
		assert.match(await crumb().innerText(), /1 件视频/);
		await scene().getByRole("button", { name: /^预览视频/ }).click();
		const preview = page.getByRole("dialog", { name: "视频预览", exact: true });
		await preview.waitFor();
		await page.keyboard.press("Escape");
		await preview.waitFor({ state: "detached" });
		await kindSwitch().getByRole("button", { name: "图片", exact: true }).click();
		await scene().locator(".generation-card[data-kind=image]").first().waitFor();

		await scene().getByRole("button", { name: /^预览图片/ }).first().click();
		const imagePreview = page.getByRole("dialog", { name: "图片预览", exact: true });
		await imagePreview.waitFor();
		await page.keyboard.press("Escape");
		await imagePreview.waitFor({ state: "detached" });

		// Redrawing stays inside the canvas; the composer never collapses.
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await prompt().fill("夏日午后的第二张");
		await page.getByRole("button", { name: "生成图片", exact: true }).click();
		await page.getByText("正在生成图片…", { exact: true }).waitFor();
		assert.equal(await scene().count(), 1, "Submitting keeps the canvas feed");
		assert.equal(await page.locator(".design-composer[data-variant=hero]").count(), 1, "Submitting keeps the composer mounted");
		assert.equal(await scene().locator(".generation-pending-card").count(), 1, "The new task lands in the gallery");
		await page.getByRole("button", { name: "停止等待", exact: true }).click();
		await page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: /^失败记录/ }).click();
		await page.getByText("已停止等待", { exact: true }).waitFor();
		await page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: /^作品/ }).click();

		// Creating from the sidebar opens the new, empty canvas scene.
		await canvases().getByRole("button", { name: "新建画布", exact: true }).click();
		const createDialog = page.getByRole("dialog", { name: "新建画布", exact: true });
		await createDialog.getByRole("textbox", { name: "画布名称", exact: true }).fill("第三画布");
		await createDialog.getByRole("button", { name: "创建画布", exact: true }).click();
		await scene().waitFor();
		assert.match(await crumb().innerText(), /第三画布/);
		assert.equal(await scene().locator(".generation-card").count(), 0);
		assert.match(await page.locator(".studio-feed-empty").innerText(), /还没有作品/);
		assert.equal(await prompt().isVisible(), true, "The empty canvas keeps the composer, not a second CTA");
		await page.screenshot({ path: `dist/design-canvas/${theme}-empty.png`, animations: "disabled" });

		await scene().getByRole("button", { name: "重命名画布", exact: true }).click();
		const renameDialog = page.getByRole("dialog", { name: "重命名画布", exact: true });
		await renameDialog.getByRole("textbox", { name: "画布名称", exact: true }).fill("第三画布改");
		await renameDialog.getByRole("button", { name: "保存名称", exact: true }).click();
		assert.match(await crumb().innerText(), /第三画布改/);
		assert.equal(await canvases().getByRole("button", { name: /^第三画布改/ }).count(), 1);

		// Deleting only removes the grouping; the feed returns to every work.
		await scene().getByRole("button", { name: "删除画布", exact: true }).click();
		const confirm = page.getByRole("dialog", { name: "删除画布", exact: true });
		await confirm.getByRole("button", { name: "删除画布", exact: true }).click();
		await page.locator(".studio-gallery").waitFor();
		assert.equal(await canvases().getByRole("button", { name: /^第三画布改/ }).count(), 0);
		assert.equal(await canvases().getByRole("button").count(), 4);
		assert.deepEqual(await currentRows(), ["首页 5"], "Deleting a canvas returns the highlight and the full feed");

		// Works and the index survive a reload with their canvas intact.
		await page.reload();
		await page.locator(".studio-gallery").waitFor();
		assert.equal(await canvases().getByRole("button").count(), 4);
		await openDesignCanvas(page, "夏日短片");
		assert.equal(await scene().locator(".generation-card").count(), 2);

		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		console.log(`PASS ${theme}: mixed home feed, composer actions, in-place pending, scoped canvases, redraw, create/rename/delete and reload`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
