import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";
import { imageSizeMenu } from "./workspace-navigation.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const output = "dist/generation-redesign";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
const gridColumns = (target = page) => target.locator(".generation-gallery-grid").evaluate((element) => Number(getComputedStyle(element).columnCount));

async function seed(theme, target = page) {
	await target.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
	await target.locator(".composer-input").waitFor();
	await target.evaluate(() => {
		const serviceId = crypto.randomUUID();
		const sizes = ["1024x1024", "1536x864", "864x1536", "864x1152", "1152x864", "1536x1024", "1024x1536", "1792x768", "2048x2048", "2560x1440", "1440x2560"];
		localStorage.setItem("skiff.test.images.config", JSON.stringify({ defaultServiceId: serviceId, services: [{ id: serviceId, name: "灵感工作室", baseUrl: "http://127.0.0.1/v1", configured: true, keyHint: "…test", defaultModel: "image-studio", models: [{ id: "image-studio", sizes }] }] }));
		const makeImage = (width, height, color) => {
			const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
			const context = canvas.getContext("2d");
			context.fillStyle = color; context.fillRect(0, 0, width, height);
			context.fillStyle = "#f5ddb8"; context.beginPath(); context.arc(width * .68, height * .28, Math.min(width, height) * .16, 0, Math.PI * 2); context.fill();
			context.fillStyle = "#78958a"; context.beginPath(); context.moveTo(0, height * .72); context.quadraticCurveTo(width * .3, height * .4, width, height * .8); context.lineTo(width, height); context.lineTo(0, height); context.fill();
			context.strokeStyle = "#ffffff"; context.lineWidth = 8; context.strokeRect(12, 12, width - 24, height - 24);
			return canvas.toDataURL("image/png");
		};
		const examples = [
			{ prompt: "窗边的花与午后的光，把柔软的时刻收藏进画面", size: "1536x864", path: makeImage(640, 360, "#b5c9c5") },
			{ prompt: "山间来信，一幅安静的竖版风景", size: "864x1536", path: makeImage(360, 640, "#b8bad0") },
			{ prompt: "今天也有温柔的小事发生", size: "1024x1024", path: makeImage(480, 480, "#cdb8a7") },
		];
		localStorage.setItem("skiff.test.images.jobs", JSON.stringify(examples.map((example, index) => ({ ...example, id: crypto.randomUUID(), serviceId, serviceName: "灵感工作室", modelId: "image-studio", actualSize: example.size, quality: "auto", createdAt: Date.now() - index * 1000, status: "completed" }))));
		localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
	});
	await target.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
	await target.waitForFunction(() => [...document.querySelectorAll(".generation-card-preview img")].length === 3 && [...document.querySelectorAll(".generation-card-preview img")].every((img) => img.naturalWidth > 0));
}

try {
	for (const theme of ["light", "dark"]) {
		await seed(theme);
		const density = page.getByRole("group", { name: "画廊列数", exact: true });
		assert.equal(await density.getByRole("button", { name: "3 列", exact: true }).getAttribute("aria-pressed"), "true");
		assert.equal(await gridColumns(), 3, "Default is three comfortable columns");
		await density.getByRole("button", { name: "1 列", exact: true }).click();
		assert.equal(await gridColumns(), 1, "One column shows one image per row");
		await page.reload();
		await page.locator(".generation-card-preview img").first().waitFor();
		assert.equal(await density.getByRole("button", { name: "1 列", exact: true }).getAttribute("aria-pressed"), "true");
		assert.equal(await gridColumns(), 1, "One-column preference survives reload");
		await density.getByRole("button", { name: "3 列", exact: true }).click();
		const titles = await page.locator(".generation-card-caption > strong").allTextContents();
		assert.match(titles[0], /^窗边的花/); assert.ok(titles.every((title) => !title.startsWith("skiff-")));
		assert.equal(await page.locator(".generation-card .generation-saved-actions").count(), 0);
		assert.deepEqual(await page.locator(".generation-card-preview img").evaluateAll((images) => images.map((image) => getComputedStyle(image).objectFit)), ["contain", "contain", "contain"]);
		assert.ok(await page.locator(".generation-controls").evaluate((element) => element.scrollWidth <= element.clientWidth));
		await page.screenshot({ path: `${output}/${theme}-gallery.png`, animations: "disabled" });
		const sizes = imageSizeMenu(page);
		await sizes.open();
		const ratios = sizes.ratios;
		for (const [ratio, direction] of [["1:1", "square"], ["16:9", "wide"], ["9:16", "tall"]]) {
			const shape = await ratios.getByRole("button", { name: new RegExp(`^${ratio}$`) }).locator(".generation-ratio-shape").boundingBox();
			assert.ok(direction === "square" ? Math.abs(shape.width - shape.height) < 1 : direction === "wide" ? shape.width > shape.height : shape.height > shape.width);
		}
		assert.equal(await ratios.getByRole("button").count(), 8);
		const resolution = sizes.resolutions;
		await ratios.getByRole("button", { name: "16:9", exact: true }).click();
		await resolution.getByRole("button", { name: "2K", exact: true }).click();
		assert.equal(await ratios.getByRole("button", { name: "16:9", exact: true }).getAttribute("aria-pressed"), "true");
		assert.match(await sizes.output.innerText(), /2560 × 1440/);
		assert.equal(await ratios.getByRole("button", { name: "4:3", exact: true }).isDisabled(), true);
		await resolution.getByRole("button", { name: "1K", exact: true }).click();
		await ratios.getByRole("button", { name: "21:9", exact: true }).click();
		assert.match(await sizes.output.innerText(), /1792 × 768/);
		await ratios.getByRole("button", { name: "3:4", exact: true }).click();
		assert.match(await sizes.output.innerText(), /864 × 1152/);
		await sizes.close();
		await density.getByRole("button", { name: "2 列", exact: true }).click();
		for (const viewport of [{ width: 2560, height: 1440 }, { width: 1920, height: 1080 }]) {
			await page.setViewportSize(viewport);
			assert.equal(await gridColumns(), 2);
			assert.ok((await page.locator(".generation-card-preview").first().boundingBox()).height <= 540);
			// The design home keeps the greeting and composer above the works, so the
			// card itself is brought into view before measuring it.
			await page.locator(".generation-card").first().scrollIntoViewIfNeeded();
			assert.ok(await page.locator(".generation-card").first().evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight), "The whole first card fits on a wide-screen viewport");
			await page.screenshot({ path: `${output}/${theme}-wide-${viewport.width}.png`, animations: "disabled" });
		}
		await page.setViewportSize({ width: 1440, height: 1040 });
		await density.getByRole("button", { name: "4 列", exact: true }).click();
		assert.equal(await gridColumns(), 4);
		assert.equal(await page.evaluate(() => localStorage.getItem("skiff.generation.columns.v1")), "4");
		await page.reload();
		await page.locator(".generation-card-preview img").first().waitFor();
		assert.equal(await density.getByRole("button", { name: "4 列", exact: true }).getAttribute("aria-pressed"), "true");
		assert.equal(await gridColumns(), 4, "Density preference survives a full reload");
		await page.mouse.move(1350, 100);
		const hover = page.getByRole("group", { name: "作品快捷操作", exact: true }).first();
		await page.waitForFunction(() => getComputedStyle(document.querySelector(".generation-hover-actions")).opacity === "0");
		await page.locator(".generation-card-media").first().hover();
		await page.waitForFunction(() => getComputedStyle(document.querySelector(".generation-hover-actions")).opacity === "1");
		await hover.getByRole("button", { name: "使用提示词", exact: true }).click();
		assert.match(await page.getByRole("textbox", { name: "提示词 Prompt" }).inputValue(), /^窗边的花/);
		await sizes.open();
		assert.equal(await ratios.getByRole("button", { name: "16:9", exact: true }).getAttribute("aria-pressed"), "true");
		await sizes.close();
		await page.locator(".generation-card-media").first().hover();
		await hover.getByRole("button", { name: "复制提示词", exact: true }).click();
		await hover.getByRole("status").filter({ hasText: "已复制提示词" }).waitFor();
		assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^窗边的花/);
		await hover.getByRole("button", { name: "另存为", exact: true }).click();
		assert.equal(await page.getByRole("dialog", { name: "图片预览", exact: true }).count(), 0, "Quick actions never open the image preview");
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.filter((call) => call.command === "export_image_generation_asset").length), 1);
		await page.screenshot({ path: `${output}/${theme}-four-columns-hover.png`, animations: "disabled" });
		// The composer now lives in the gallery column instead of a fixed parameters
		// panel, so four columns remain comfortable down to a 1200px window.
		for (const [width, expected] of [[1200, 4], [900, 2], [1440, 4]]) {
			await page.setViewportSize({ width, height: 1040 });
			await page.waitForFunction((columns) => Number(getComputedStyle(document.querySelector(".generation-gallery-grid")).columnCount) === columns, expected);
			assert.equal(await gridColumns(), expected, `Preferred four columns adapt at ${width}px`);
			assert.equal(await density.getByRole("button", { name: "4 列", exact: true }).getAttribute("aria-pressed"), "true");
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		}
		const more = page.locator(".generation-more-trigger").first();
		await more.click();
		await page.getByRole("menu", { name: "作品操作", exact: true }).waitFor();
		await page.screenshot({ path: `${output}/${theme}-actions.png`, animations: "disabled" });
		await page.keyboard.press("End");
		assert.equal(await page.getByRole("menuitem", { name: "从画廊移除" }).evaluate((element) => element === document.activeElement), true);
		await page.keyboard.press("Home"); await page.keyboard.press("Escape");
		await more.click(); await page.getByRole("heading", { name: /灵感画廊/ }).click();
		assert.equal(await page.getByRole("menu").count(), 0, "Outside click closes the menu");
		const prompt = page.getByRole("textbox", { name: "提示词 Prompt" });
		await prompt.fill("窗边的花与午后的光，让想象慢慢成形");
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await prompt.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })));
		await prompt.evaluate((element) => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, repeat: true, bubbles: true })));
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.filter((call) => call.prompt).length), 0, "IME confirmation and repeated keydown never submit");
		await sizes.open();
		await resolution.getByRole("button", { name: "2K", exact: true }).click();
		await ratios.getByRole("button", { name: "9:16", exact: true }).click();
		await sizes.close();
		await page.locator(".generation-gallery-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
		await prompt.press("Control+Enter");
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.find((call) => call.prompt)?.size), "1440x2560");
		await page.getByText("正在生成图片…", { exact: true }).waitFor();
		assert.equal(await page.locator(".generation-gallery-grid > :first-child").getAttribute("aria-busy"), "true");
		assert.equal(await page.locator(".generation-gallery-scroll").evaluate((element) => element.scrollTop), 0);
		await page.screenshot({ path: `${output}/${theme}-pending.png`, animations: "disabled" });
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(await page.locator(".generation-pending-glow").evaluate((element) => getComputedStyle(element).animationName), "none");
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.getByRole("button", { name: "停止等待", exact: true }).click();
		await page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: /^失败记录/ }).click();
		await page.getByText("已停止等待", { exact: true }).waitFor();
		await page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: /^作品 / }).click();
		await page.locator('input[aria-label="导入图片作品"]').setInputFiles(["my_sketch.png", "ceea955e-cda1-4249-aeda-a87197123456.png", "a".repeat(64) + ".png"].map((name) => ({ name, mimeType: "image/png", buffer: testImage() })));
		const importedTitles = await page.locator(".generation-card-caption > strong").allTextContents();
		assert.ok(importedTitles.includes("my_sketch.png"));
		assert.ok(importedTitles.includes("本地导入作品 02")); assert.ok(importedTitles.includes("本地导入作品 03"));
		assert.ok(!importedTitles.some((title) => title.includes("ceea955e") || title.includes("a".repeat(16))));
		await page.getByRole("button", { name: "预览图片：ceea955e-cda1-4249-aeda-a87197123456.png", exact: true }).click();
		assert.equal(await page.getByRole("dialog", { name: "图片预览", exact: true }).locator("header strong").textContent(), "本地导入作品 02");
		await page.keyboard.press("Escape");
		console.log(`PASS ${theme}: 1/2/3/4 columns, capped previews, independent resolution/ratio and persistence, responsive fallback, hover actions, import names, keyboard menu, guarded shortcut, skeleton and reduced motion`);
	}
	const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	const touch = await touchContext.newPage();
	await seed("light", touch);
	await touch.locator(".generation-more-trigger").first().tap();
	const menu = touch.getByRole("menu", { name: "作品操作", exact: true });
	await menu.waitFor();
	const bounds = await menu.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
	assert.ok((await touch.getByRole("menuitem", { name: "另存为", exact: true }).boundingBox()).height >= 44);
	await touch.screenshot({ path: `${output}/touch-actions.png`, animations: "disabled" });
	await touch.getByRole("menuitem", { name: "使用提示词", exact: true }).tap();
	await touch.getByRole("button", { name: "创作参数", exact: true }).tap();
	assert.match(await touch.getByRole("textbox", { name: "提示词 Prompt" }).inputValue(), /^窗边的花/);
	assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await touch.screenshot({ path: `${output}/touch-controls.png`, animations: "disabled" });
	await touchContext.close();
	assert.deepEqual(errors, []);
	console.log("PASS touch: visible menu entry, 44px action targets, prompt reuse and narrow controls");
} finally { await browser.close(); }
