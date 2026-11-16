import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";
import { openDesignCanvas } from "./workspace-navigation.mjs";

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

		// The launcher owns creation and shows no history.
		await page.locator(".studio-home").waitFor();
		assert.equal(await page.locator(".generation-card").count(), 0, "The launcher holds no works");
		assert.equal(await page.getByRole("button", { name: "画布：未分组", exact: true }).count(), 1, "The launcher still targets a canvas");
		assert.equal(await canvases().getByRole("button").count(), 4, "Two canvases, ungrouped and the create action");
		await page.screenshot({ path: `dist/design-canvas/${theme}-home.png`, animations: "disabled" });

		// The sidebar scopes every canvas scene.
		await openDesignCanvas(page);
		assert.match(await crumb().innerText(), /未分组/);
		assert.match(await crumb().innerText(), /1$/, "Ungrouped hides works that belong to a canvas");
		assert.equal(await scene().locator(".generation-card").count(), 1);
		assert.equal(await page.locator(".design-composer[data-variant=canvas] .generation-field-canvas").isVisible(), false, "The redraw bar never re-targets another canvas");

		await canvases().getByRole("button", { name: /^夏日短片/ }).click();
		await scene().waitFor();
		assert.match(await crumb().innerText(), /夏日短片/);
		assert.match(await crumb().innerText(), /3$/, "The canvas keeps a mixed count");
		assert.equal(await scene().locator(".generation-card").count(), 2, "The image gallery shows the two images of this canvas");
		await page.screenshot({ path: `dist/design-canvas/${theme}-canvas.png`, animations: "disabled" });

		await kindSwitch().getByRole("button", { name: "视频", exact: true }).click();
		await page.locator(".generation-card[data-kind=video]").first().waitFor();
		assert.equal(await page.locator(".generation-card[data-kind=video]").count(), 1, "The video gallery keeps its own scope");
		await page.getByRole("button", { name: /^预览视频/ }).click();
		const preview = page.getByRole("dialog", { name: "视频预览", exact: true });
		await preview.waitFor();
		await page.keyboard.press("Escape");
		await preview.waitFor({ state: "detached" });
		await kindSwitch().getByRole("button", { name: "图片", exact: true }).click();
		await page.locator(".generation-card[data-kind=image]").first().waitFor();

		await scene().getByRole("button", { name: /^预览图片/ }).first().click();
		const imagePreview = page.getByRole("dialog", { name: "图片预览", exact: true });
		await imagePreview.waitFor();
		await page.keyboard.press("Escape");
		await imagePreview.waitFor({ state: "detached" });

		// Redrawing stays inside the canvas instead of jumping back to the launcher.
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await page.getByRole("textbox", { name: "提示词 Prompt", exact: true }).fill("夏日午后的第二张");
		await page.getByRole("button", { name: "生成图片", exact: true }).click();
		await page.getByText("正在生成图片…", { exact: true }).waitFor();
		assert.equal(await page.locator(".design-canvas-scene").count(), 1, "Submitting keeps the canvas scene");
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
		assert.equal(await scene().getByText("这个画布还没有作品", { exact: true }).count(), 1);

		await scene().getByRole("button", { name: "重命名画布", exact: true }).click();
		const renameDialog = page.getByRole("dialog", { name: "重命名画布", exact: true });
		await renameDialog.getByRole("textbox", { name: "画布名称", exact: true }).fill("第三画布改");
		await renameDialog.getByRole("button", { name: "保存名称", exact: true }).click();
		assert.match(await crumb().innerText(), /第三画布改/);
		assert.equal(await canvases().getByRole("button", { name: /^第三画布改/ }).count(), 1);
		await page.screenshot({ path: `dist/design-canvas/${theme}-empty.png`, animations: "disabled" });

		// Deleting only removes the grouping; the app returns to the launcher.
		await scene().getByRole("button", { name: "删除画布", exact: true }).click();
		const confirm = page.getByRole("dialog", { name: "删除画布", exact: true });
		await confirm.getByRole("button", { name: "删除画布", exact: true }).click();
		await page.locator(".studio-home").waitFor();
		assert.equal(await canvases().getByRole("button", { name: /^第三画布改/ }).count(), 0);
		assert.equal(await canvases().getByRole("button").count(), 4);

		// Works and the index survive a reload with their canvas intact.
		await page.reload();
		await page.locator(".studio-home").waitFor();
		assert.equal(await canvases().getByRole("button").count(), 4);
		await openDesignCanvas(page, "夏日短片");
		assert.equal(await scene().locator(".generation-card").count(), 2);

		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		console.log(`PASS ${theme}: launcher first, scoped canvas scenes, mixed count, kind switch, redraw in place, create/rename/delete and reload`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
