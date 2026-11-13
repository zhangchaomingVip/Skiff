import { workbenchTool } from "./workspace-navigation.mjs";
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
const importInput = (kind) => page.locator(`input[aria-label="导入${kind}作品"]`);
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
		assert.equal(await page.getByRole("heading", { name: "从一个画面开始", exact: true }).isVisible(), true);
		assert.equal(await page.getByRole("button", { name: "生成图片", exact: true }).isDisabled(), true);
		assert.equal(await page.getByRole("combobox", { name: "模型", exact: true }).isDisabled(), true);
		await screenshot(`${theme}-image-empty`);
		await prompt().fill("午后，窗边的一束花，柔和的奶油色光线");
		assert.equal(await page.getByRole("group", { name: "画面比例", exact: true }).getByRole("button", { name: "4:3", exact: true }).isDisabled(), true);
		await tool("生成视频").click();
		await page.getByRole("complementary", { name: "生成视频参数", exact: true }).waitFor();
		assert.deepEqual(await selectedAppearance(tool("生成视频")), appearance);
		assert.equal(await prompt().inputValue(), "");
		assert.equal(await page.getByRole("heading", { name: "让灵感动起来", exact: true }).isVisible(), true);
		await prompt().fill("镜头缓缓推进，微风轻拂花瓣");
		assert.equal(await page.getByRole("slider").count(), 0);
		assert.equal(await page.getByRole("combobox", { name: "时长", exact: true }).inputValue(), "5");
		await page.locator(".generation-fields").evaluate((element) => { element.scrollTop = 0; });
		await screenshot(`${theme}-video-empty`);
		await tool("生图").click();
		assert.match(await prompt().inputValue(), /奶油色/);
		assert.equal(await page.getByRole("button", { name: "4:3", exact: true }).getAttribute("aria-pressed"), "false");
		await importInput("图片").setInputFiles({ name: "wrong.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
		await page.getByRole("alert").filter({ hasText: "请选择 PNG" }).waitFor();
		assert.equal(await page.locator(".design-gallery-route:not([hidden]) .generation-card").count(), 0);
		await importInput("图片").setInputFiles([image, { ...image, name: "另一束光.png" }]);
		await page.waitForFunction(() => [...document.querySelectorAll(".generation-card img")].every((image) => image.complete && image.naturalWidth > 0));
		assert.equal(await page.locator(".design-gallery-route:not([hidden]) .generation-card").count(), 2);
		assert.equal(await page.getByRole("alert").count(), 0);
		await page.getByRole("button", { name: "预览图片：午后.png", exact: true }).click();
		const preview = page.getByRole("dialog", { name: "图片预览", exact: true });
		await preview.waitFor();
		assert.equal(await preview.locator("img").getAttribute("alt"), "午后.png");
		await screenshot(`${theme}-image-preview`);
		await page.keyboard.press("Escape");
		assert.equal(await page.getByRole("button", { name: "预览图片：午后.png", exact: true }).evaluate((element) => element === document.activeElement), true);
		const firstCard = page.locator(".design-gallery-route:not([hidden]) .generation-card").filter({ has: page.getByRole("button", { name: "预览图片：午后.png", exact: true }) });
		await firstCard.hover();
		await screenshot(`${theme}-gallery`);
		const assetUrl = await firstCard.locator("img").getAttribute("src");
		await firstCard.getByRole("button", { name: "以此图生成视频", exact: true }).click();
		assert.equal(await tool("生成视频").getAttribute("aria-pressed"), "true");
		assert.equal(await prompt().inputValue(), "镜头缓缓推进，微风轻拂花瓣");
		assert.equal(await page.getByRole("combobox", { name: "时长", exact: true }).inputValue(), "5");
		assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), assetUrl);
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
		// Import an actual decodable local clip; no network or model generation is involved.
		const clip = Buffer.from(await readFile("tests/fixtures/video.mp4.b64", "utf8"), "base64");
		await importInput("视频").setInputFiles({ name: "光影.mp4", mimeType: "video/mp4", buffer: clip });
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
		assert.equal(await page.locator(".design-gallery-route:not([hidden]) .generation-card").count(), 2);
		// Collapsed controls keep the gallery and can be reopened from the workspace.
		await page.getByRole("button", { name: "创作参数", exact: true }).click();
		assert.equal(await page.locator(".generation-controls").count(), 0);
		assert.equal(await page.getByRole("region", { name: "图片画廊", exact: true }).isVisible(), true);
		await page.getByRole("button", { name: "创作参数", exact: true }).click();
		assert.match(await prompt().inputValue(), /奶油色/);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		console.log(`PASS ${theme}: navigation style parity, independent drafts, capability controls, import validation, image/video previews, loop playback, image-to-video reference, URL cleanup, chat/Commit restoration and collapsed controls`);
	}
	for (const width of [760, 390]) {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
		await tool("生成视频").click();
		const drawer = page.getByRole("dialog", { name: "创作参数", exact: true });
		await drawer.waitFor();
		await prompt().fill("窄屏下保留的运动描述");
		assert.equal(await page.locator(".generation-controls").evaluate((element) => element.scrollWidth <= element.clientWidth), true);
		await screenshot(`narrow-${width}-controls`);
		await page.keyboard.press("Escape");
		await drawer.waitFor({ state: "hidden" });
		await page.getByRole("button", { name: "创作参数", exact: true }).click();
		assert.equal(await prompt().inputValue(), "窄屏下保留的运动描述");
		await page.keyboard.press("Escape");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
		await screenshot(`narrow-${width}-gallery`);
	}
	// A stored generation tool restores its own workspace, rather than the file panel.
	await page.evaluate(() => { localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" })); });
	await page.setViewportSize({ width: 1440, height: 960 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=light`);
	await page.getByRole("complementary", { name: "生图参数", exact: true }).waitFor();
	assert.equal(await page.getByRole("button", { name: "Design 设计室", exact: true }).getAttribute("aria-pressed"), "true");
	assert.equal(await page.locator(".workbench-panel").count(), 0);
	assert.deepEqual(errors, []);
	console.log("PASS narrow drawers at 760/390px, no overflow, persisted workspace selection and no runtime errors");
} catch (error) {
	await page.screenshot({ path: "dist/generation-workspace/failure.png", animations: "disabled" });
	console.error(await page.locator("video").evaluateAll((videos) => videos.map((video) => ({ src: video.currentSrc, paused: video.paused, readyState: video.readyState, dialog: video.closest("dialog")?.getAttribute("aria-label"), error: video.error?.message }))));
	throw error;
} finally { await browser.close(); }
