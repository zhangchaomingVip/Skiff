import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";
import { openDesignCanvas } from "./workspace-navigation.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/design-assets", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const canvases = () => page.getByRole("navigation", { name: "画布", exact: true });
const assetsNav = () => page.getByRole("navigation", { name: "素材", exact: true });
const scene = () => page.locator(".design-canvas-scene");
const library = () => page.getByRole("region", { name: "资产库", exact: true });
const image = `data:image/png;base64,${testImage().toString("base64")}`;

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate((image) => {
			const serviceId = "assets-service";
			const sizes = ["1024x1024", "1536x864"];
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: serviceId, services: [{ id: serviceId, name: "灵感工作室", baseUrl: "http://127.0.0.1/v1", configured: true, keyHint: "…test", defaultModel: "image-studio", models: [{ id: "image-studio", sizes }] }] }));
			localStorage.setItem("skiff.test.images.jobs", JSON.stringify([{ id: "img-summer", prompt: "夏日海浪与白裙", serviceId, serviceName: "灵感工作室", modelId: "image-studio", size: "1536x864", actualSize: "1536x864", quality: "auto", status: "completed", path: image, createdAt: Date.now() - 1000, canvasId: "canvas-summer" }]));
			localStorage.setItem("skiff.test.design-assets", "[]");
			localStorage.setItem("skiff.design.canvases.v1", JSON.stringify({ version: 1, activeId: "canvas-summer", canvases: [{ id: "canvas-summer", name: "夏日短片", createdAt: 1, updatedAt: 2 }, { id: "canvas-night", name: "夜色街拍", createdAt: 3, updatedAt: 4 }] }));
			localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
		}, image);
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
		await page.locator(".studio-home").waitFor();

		// A generated work moves between canvases without touching its file.
		await openDesignCanvas(page, "夏日短片");
		assert.equal(await scene().locator(".generation-card").count(), 1);
		await scene().locator(".generation-card-media").hover();
		await scene().locator(".generation-card").getByRole("button", { name: /^更多作品操作/ }).click();
		await page.getByRole("menuitem", { name: "移到画布…", exact: true }).click();
		const move = page.getByRole("dialog", { name: "移到画布", exact: true });
		await move.getByRole("radio", { name: "夜色街拍", exact: true }).click();
		await move.getByRole("button", { name: "确认移到画布", exact: true }).click();
		await move.waitFor({ state: "detached" });
		await page.waitForFunction(() => document.querySelectorAll(".design-canvas-scene .generation-card").length === 0);
		assert.match(await canvases().getByRole("button", { name: /^夜色街拍/ }).innerText(), /1/, "The target canvas count updates");
		await page.screenshot({ path: `dist/design-assets/${theme}-moved.png`, animations: "disabled" });

		// Imported media is persisted by the shell, so it survives a reload the
		// same way a generated work does.
		await page.evaluate((image) => {
			const saved = JSON.parse(localStorage.getItem("skiff.test.design-assets") ?? "[]");
			saved.unshift({ id: "imported-summer", kind: "image", name: "本地导入.png", mime: "image/png", path: image, size: image.length, canvasId: "canvas-summer", removed: false, createdAt: Date.now() });
			localStorage.setItem("skiff.test.design-assets", JSON.stringify(saved));
		}, image);
		await page.reload();
		await page.locator(".studio-home").waitFor();
		assert.match(await canvases().getByRole("button", { name: /^夏日短片/ }).innerText(), /1/, "Imported media survives a reload");
		await openDesignCanvas(page, "夏日短片");
		await page.getByRole("button", { name: "预览图片：本地导入.png", exact: true }).waitFor();
		assert.equal(await page.locator(".design-canvas-scene .generation-card").count(), 1);

		// The asset library collects both canvases and offers reuse.
		await assetsNav().getByRole("button", { name: /^资产库/ }).click();
		await library().waitFor();
		assert.equal(await library().locator(".generation-card").count(), 2, "Library spans every canvas");
		assert.match(await library().innerText(), /夜色街拍/);
		assert.match(await library().innerText(), /夏日短片/);
		await page.screenshot({ path: `dist/design-assets/${theme}-library.png`, animations: "disabled" });

		await library().getByRole("button", { name: "预览作品：本地导入.png", exact: true }).click();
		await page.getByRole("dialog", { name: "作品预览", exact: true }).getByRole("button", { name: "用作参考图", exact: true }).click();
		const composer = page.locator(".design-composer[data-variant=hero]");
		await composer.waitFor();
		await composer.locator(".generation-reference-image").waitFor();
		assert.match(await composer.innerText(), /夏日短片/, "Reusing a work opens the composer on the work's own canvas");

		// Moving an import out of a canvas is persisted as well.
		await assetsNav().getByRole("button", { name: /^资产库/ }).click();
		await library().getByRole("button", { name: "预览作品：本地导入.png", exact: true }).click();
		await page.getByRole("dialog", { name: "作品预览", exact: true }).getByRole("button", { name: "移到画布…", exact: true }).click();
		const importMove = page.getByRole("dialog", { name: "移到画布", exact: true });
		await importMove.getByRole("radio", { name: "未分组", exact: true }).click();
		await importMove.getByRole("button", { name: "确认移到画布", exact: true }).click();
		await importMove.waitFor({ state: "detached" });
		await page.waitForFunction(() => [...document.querySelectorAll(".design-canvas-row")].some((row) => row.textContent.startsWith("未分组") && row.textContent.endsWith("1")));
		assert.match(await canvases().getByRole("button", { name: /^未分组/ }).innerText(), /1/);
		assert.match(await canvases().getByRole("button", { name: /^夏日短片/ }).innerText(), /0/);

		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		console.log(`PASS ${theme}: move between canvases, persisted imports, library reuse and ungrouping`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
