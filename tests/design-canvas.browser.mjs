import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";
import { workbenchTool } from "./workspace-navigation.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/design-canvas", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const video = `data:video/mp4;base64,${readFileSync("tests/fixtures/video.mp4.b64", "utf8").trim()}`;
const canvases = () => page.getByRole("navigation", { name: "画布", exact: true });
const canvasView = () => page.getByRole("region", { name: "画布", exact: true });
const galleryHeading = () => page.locator(".design-gallery-route:not([hidden]) .generation-gallery-heading h2");
const canvasTitle = () => page.locator(".design-canvas .generation-gallery-heading h2");

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
		await page.locator(".design-gallery-route:not([hidden]) .design-composer").waitFor();

		// The canvas list scopes every gallery: ungrouped only holds the draft work.
		assert.equal(await canvases().getByRole("button").count(), 4, "Two canvases, ungrouped and the create action");
		assert.equal(await page.getByRole("button", { name: "画布：未分组", exact: true }).count(), 1);
		assert.match(await galleryHeading().innerText(), /01$/, "Ungrouped hides works that belong to a canvas");

		await canvases().getByRole("button", { name: /^夏日短片/ }).click();
		await canvasView().waitFor();
		assert.match(await canvasTitle().innerText(), /夏日短片/);
		assert.match(await canvasTitle().innerText(), /03/, "Mixed images and videos share one canvas count");
		assert.equal(await canvasView().locator(".generation-card").count(), 3);
		await page.screenshot({ path: `dist/design-canvas/${theme}-canvas.png`, animations: "disabled" });

		const filters = canvasView().getByRole("group", { name: "画布筛选", exact: true });
		await filters.getByRole("button", { name: "视频 1", exact: true }).click();
		assert.equal(await canvasView().locator(".generation-card").count(), 1);
		assert.equal(await canvasView().locator(".generation-card[data-kind=video]").count(), 1);
		await filters.getByRole("button", { name: "图片 2", exact: true }).click();
		assert.equal(await canvasView().locator(".generation-card").count(), 2);

		await canvasView().getByRole("button", { name: /^预览作品/ }).first().click();
		const preview = page.getByRole("dialog", { name: "作品预览", exact: true });
		await preview.waitFor();
		assert.match(await preview.innerText(), /画布：夏日短片/);
		await page.keyboard.press("Escape");
		await preview.waitFor({ state: "detached" });

		// Create keeps the canvas as the submit target instead of leaving the context.
		await canvasView().getByRole("button", { name: "在此画布创作", exact: true }).click();
		await page.locator(".design-composer").waitFor();
		assert.equal(await page.getByRole("button", { name: "画布：夏日短片", exact: true }).count(), 1);

		await page.getByRole("button", { name: "画布：夏日短片", exact: true }).click();
		const picker = page.getByRole("listbox", { name: "画布", exact: true });
		await picker.waitFor();
		await picker.getByRole("option", { name: /^未分组/ }).click();
		assert.match(await galleryHeading().innerText(), /01$/, "Switching the composer target re-scopes the gallery");

		// Creating from the sidebar opens the empty canvas page.
		await canvases().getByRole("button", { name: "新建画布", exact: true }).click();
		const createDialog = page.getByRole("dialog", { name: "新建画布", exact: true });
		await createDialog.getByRole("textbox", { name: "画布名称", exact: true }).fill("第三画布");
		await createDialog.getByRole("button", { name: "创建画布", exact: true }).click();
		await canvasView().waitFor();
		assert.match(await canvasTitle().innerText(), /第三画布/);
		assert.equal(await canvasView().locator(".generation-card").count(), 0);
		assert.equal(await canvasView().getByText("这个画布还没有作品", { exact: true }).count(), 1);

		await canvasView().getByRole("button", { name: "重命名画布", exact: true }).click();
		const renameDialog = page.getByRole("dialog", { name: "重命名画布", exact: true });
		await renameDialog.getByRole("textbox", { name: "画布名称", exact: true }).fill("第三画布改");
		await renameDialog.getByRole("button", { name: "保存名称", exact: true }).click();
		assert.match(await canvasTitle().innerText(), /第三画布改/);
		assert.equal(await canvases().getByRole("button", { name: /^第三画布改/ }).count(), 1);
		await page.screenshot({ path: `dist/design-canvas/${theme}-empty.png`, animations: "disabled" });

		// Deleting only removes the grouping; the app returns to the gallery.
		await canvasView().getByRole("button", { name: "删除画布", exact: true }).click();
		const confirm = page.getByRole("dialog", { name: "删除画布", exact: true });
		await confirm.getByRole("button", { name: "删除画布", exact: true }).click();
		await page.locator(".design-canvas").waitFor({ state: "detached" });
		assert.equal(await canvases().getByRole("button", { name: /^第三画布改/ }).count(), 0);
		assert.equal(await canvases().getByRole("button").count(), 4);

		// Works and the index survive a reload with their canvas intact.
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
		await page.locator(".design-gallery-route:not([hidden]) .design-composer").waitFor();
		assert.equal(await canvases().getByRole("button").count(), 4);
		await canvases().getByRole("button", { name: /^夏日短片/ }).click();
		await canvasView().waitFor();
		assert.equal(await canvasView().locator(".generation-card").count(), 3);

		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		console.log(`PASS ${theme}: canvas list, scoped galleries, mixed filter, target picker, create/rename/delete and reload`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
