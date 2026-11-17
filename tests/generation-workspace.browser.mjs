import { openCanvasComposer, openDesignCanvas, workbenchTool } from "./workspace-navigation.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/generation-workspace", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const tool = (name) => workbenchTool(page, name);
const image = { name: "午后.png", mimeType: "image/png", buffer: testImage() };
const screenshot = (name) => page.screenshot({ path: `dist/generation-workspace/${name}.png`, animations: "disabled" });
const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt" });
const selectedAppearance = async (button) => {
	await page.mouse.move(1350, 920);
	return button.evaluate((element) => {
		const style = getComputedStyle(element);
		const svg = element.querySelector("svg");
		return [style.width, style.height, style.borderRadius, style.padding, style.backgroundColor, style.color, svg.getAttribute("stroke-width"), svg.getAttribute("width")];
	});
};

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1440, height: 960 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}&color=yellow`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => {
			const original = URL.revokeObjectURL.bind(URL);
			window.revokedMedia = [];
			URL.revokeObjectURL = (url) => { window.revokedMedia.push(url); original(url); };
		});
		assert.deepEqual(await page.locator(".activity-button").evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))), ["对话", "文件", "设置"]);
		await page.locator(".composer-input").fill("切换创作空间后仍保留的对话草稿");
		await tool("文件").click();
		const appearance = await selectedAppearance(tool("文件"));
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.getByRole("textbox", { name: "提交信息", exact: true }).fill("创作空间不影响提交草稿");
		await tool("生图").click();
		await page.getByRole("complementary", { name: "生图参数", exact: true }).waitFor();
		assert.deepEqual(await selectedAppearance(tool("生图")), appearance);
		assert.equal(await page.locator(".primary-view").isVisible(), false);
		// The launcher is the creation feed: one card, then the works grid.
		assert.equal(await page.locator(".design-composer[data-variant=hero]").isVisible(), true);
		assert.equal(await page.locator(".design-thread").isVisible(), true);
		assert.equal(await page.getByRole("button", { name: "生成图片", exact: true }).isDisabled(), true);
		assert.equal(await page.getByRole("button", { name: "模型", exact: true }).isDisabled(), true);
		await screenshot(`${theme}-image-empty`);
		await prompt().fill("午后，窗边的一束花，柔和的奶油色光线");
		assert.equal(await page.getByRole("button", { name: "画面尺寸", exact: true }).isDisabled(), true);
		await tool("生成视频").click();
		await page.getByRole("complementary", { name: "生成视频参数", exact: true }).waitFor();
		assert.deepEqual(await selectedAppearance(tool("生成视频")), appearance);
		assert.equal(await prompt().inputValue(), "");
		await prompt().fill("镜头缓缓推进，微风轻拂花瓣");
		assert.equal(await page.getByRole("slider").count(), 0);
		assert.equal(await page.getByRole("combobox", { name: "时长", exact: true }).inputValue(), "5");
		await screenshot(`${theme}-video-empty`);
		await tool("生图").click();
		assert.match(await prompt().inputValue(), /奶油色/);
		assert.equal(await page.getByRole("button", { name: "画面尺寸", exact: true }).isDisabled(), true);

		// Imported media is persisted by the shell, so seed it the way the app stores
		// it: one image pair and one clip, all ungrouped.
		await openDesignCanvas(page);
		assert.equal(await page.locator(".design-result-card").count(), 0);
		const clip = Buffer.from(await readFile("tests/fixtures/video.mp4.b64", "utf8"), "base64");
		await page.evaluate(({ imageUrl, clipUrl }) => {
			localStorage.setItem("skiff.test.design-assets", JSON.stringify([
				{ id: "import-image", kind: "image", name: "午后.png", mime: "image/png", path: imageUrl, size: imageUrl.length, removed: false, createdAt: Date.now() },
				{ id: "import-image-2", kind: "image", name: "另一束光.png", mime: "image/png", path: imageUrl, size: imageUrl.length, removed: false, createdAt: Date.now() - 1000 },
				{ id: "import-video", kind: "video", name: "光影.mp4", mime: "video/mp4", path: clipUrl, size: clipUrl.length, removed: false, createdAt: Date.now() - 2000 },
			]));
			const url = new URL(location.href); url.searchParams.set("persist", "1"); history.replaceState(null, "", url);
		}, { imageUrl: `data:image/png;base64,${testImage().toString("base64")}`, clipUrl: `data:video/mp4;base64,${clip.toString("base64")}` });
		await page.reload();
		await page.evaluate(() => {
			const original = URL.revokeObjectURL.bind(URL);
			window.revokedMedia = [];
			URL.revokeObjectURL = (url) => { window.revokedMedia.push(url); original(url); };
		});
		// A reload keeps the persisted drafts, but the Commit field only flushes
		// after a beat, so the two drafts are written again before navigating.
		await page.getByRole("button", { name: "Code 工作区", exact: true }).click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.getByRole("textbox", { name: "提交信息", exact: true }).fill("创作空间不影响提交草稿");
		await tool("生图").click();
		await prompt().fill("午后，窗边的一束花，柔和的奶油色光线");
		await openDesignCanvas(page);
		await page.getByRole("button", { name: "预览图片：另一束光.png", exact: true }).waitFor();
		await page.waitForFunction(() => [...document.querySelectorAll(".generation-card img")].every((image) => image.complete && image.naturalWidth > 0));
		assert.equal(await page.locator(".design-result-card").count(), 2, "Both imported images join the flow");
		assert.equal(await page.getByRole("alert").count(), 0);
		await page.getByRole("button", { name: "预览图片：午后.png", exact: true }).click();
		const preview = page.getByRole("dialog", { name: "图片预览", exact: true });
		await preview.waitFor();
		assert.equal(await preview.locator("img").getAttribute("alt"), "午后.png");
		await screenshot(`${theme}-image-preview`);
		await page.keyboard.press("Escape");
		await preview.waitFor({ state: "detached" });
		assert.equal(await page.locator(".design-result-card .generation-card-preview:focus").count(), 1, "Closing the preview returns focus to the flow");
		// Reloading clears the session drafts, so the motion draft is typed again.
		await tool("生成视频").click();
		await prompt().fill("镜头缓缓推进，微风轻拂花瓣");
		await tool("生图").click();
		const firstCard = page.locator(".design-turn").filter({ hasText: "午后.png" }).locator(".design-result-card");
		await firstCard.locator(".generation-card-media").hover();
		await screenshot(`${theme}-gallery`);
		const assetUrl = await firstCard.locator("img").getAttribute("src");
		// "图生视频" hands the reference back to the dock, not the launcher.
		await firstCard.getByRole("button", { name: "图生视频", exact: true }).click();
		const panel = await openCanvasComposer(page);
		assert.equal(await page.locator(".design-canvas-scene").isVisible(), true, "Reusing a work as a reference stays on the canvas");
		assert.equal(await tool("生成视频").getAttribute("aria-pressed"), "true");
		assert.equal(await prompt().inputValue(), "镜头缓缓推进，微风轻拂花瓣");
		assert.equal(await page.getByRole("combobox", { name: "时长", exact: true }).inputValue(), "5");
		assert.equal(await panel.locator(".generation-reference-image img").getAttribute("src"), assetUrl);
		await page.getByRole("button", { name: "移除首帧参考图", exact: true }).click();
		assert.equal(await page.evaluate((url) => window.revokedMedia.includes(url), assetUrl), false, "Removing a shared reference must keep its gallery image alive");
		await page.locator('input[aria-label="上传首帧参考图"]').setInputFiles(image);
		const uploadedUrl = await page.locator(".generation-reference-image img").getAttribute("src");
		await page.locator('input[aria-label="上传首帧参考图"]').setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
		await page.getByRole("alert").filter({ hasText: "请选择 PNG" }).waitFor();
		assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), uploadedUrl);
		await page.locator('input[aria-label="上传首帧参考图"]').setInputFiles({ ...image, name: "新的首帧.png" });
		assert.equal(await page.evaluate((url) => window.revokedMedia.includes(url), uploadedUrl), true, "Replacing a local reference releases the previous blob");
		await page.locator(".generation-reference").scrollIntoViewIfNeeded();
		await screenshot(`${theme}-video-reference`);
		// The seeded clip is decodable, so playback needs no network or model call.
		await page.locator(".design-canvas-scene").waitFor();
		await page.getByRole("button", { name: "预览视频：光影.mp4", exact: true }).click();
		const player = page.getByRole("dialog", { name: "视频预览", exact: true }).locator("video");
		await page.waitForFunction(() => document.querySelector("dialog video")?.readyState >= 2);
		assert.equal(await player.evaluate((element) => element.loop && element.controls && element.autoplay), true);
		await page.waitForFunction(() => !document.querySelector("dialog video")?.paused);
		await screenshot(`${theme}-video-preview`);
		await page.getByRole("button", { name: "关闭作品预览", exact: true }).click();
		await page.getByRole("button", { name: "Code 工作区", exact: true }).click();
		assert.equal(await page.locator(".composer-input").inputValue(), "切换创作空间后仍保留的对话草稿");
		assert.equal(await page.getByRole("tab", { name: "Commit", exact: true }).getAttribute("aria-selected"), "true");
		assert.equal(await page.getByRole("textbox", { name: "提交信息", exact: true }).inputValue(), "创作空间不影响提交草稿");
		await tool("生图").click();
		await page.locator(".design-thread").waitFor();
		await page.locator(".design-result-card").first().waitFor();
		// The dock stays pinned below the flow and keeps its draft.
		assert.equal(await page.locator(".design-result-card").count(), 2);
		assert.equal(await page.locator(".design-thread").isVisible(), true);
		assert.equal(await page.locator(".design-composer[data-variant=hero]").isVisible(), true);
		assert.match(await prompt().inputValue(), /奶油色/, "Returning to Design keeps the draft");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		console.log(`PASS ${theme}: navigation style parity, independent drafts, launcher, seeded imports, image/video previews, loop playback, image-to-video reference, URL cleanup, chat/Commit restoration and the pinned composer`);
	}
	for (const width of [760, 390]) {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
		await tool("生成视频").click();
		await page.locator(".design-composer[data-variant=hero]").waitFor();
		await prompt().fill("窄屏下保留的运动描述");
		assert.equal(await prompt().inputValue(), "窄屏下保留的运动描述");
		await screenshot(`narrow-${width}-home`);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
	}
	// A stored generation tool restores its own workspace, rather than the file panel.
	await page.evaluate(() => { localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" })); });
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=light`);
	await page.getByRole("complementary", { name: "生图参数", exact: true }).waitFor();
	assert.equal(await page.getByRole("button", { name: "Design 设计室", exact: true }).getAttribute("aria-pressed"), "true");
	assert.equal(await page.locator(".workbench-panel").count(), 0);
	assert.deepEqual(errors, []);
	console.log("PASS narrow launcher at 760/390px, no overflow, persisted workspace selection and no runtime errors");
} catch (error) {
	await page.screenshot({ path: "dist/generation-workspace/failure.png", animations: "disabled" });
	console.error(await page.locator("video").evaluateAll((videos) => videos.map((video) => ({ src: video.currentSrc, paused: video.paused, readyState: video.readyState, dialog: video.closest("dialog")?.getAttribute("aria-label"), error: video.error?.message }))));
	throw error;
} finally { await browser.close(); }
