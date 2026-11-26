import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const output = "dist/design-archive";
const image = `data:image/png;base64,${testImage().toString("base64")}`;
const video = `data:video/mp4;base64,${(await readFile("tests/fixtures/video.mp4.b64", "utf8")).trim()}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });

async function seed(page, theme, atCapacity = false) {
	const url = `${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`;
	await page.goto(url);
	await page.locator(".composer-input").waitFor();
	await page.evaluate(({ image, video, atCapacity }) => {
		const now = Date.now();
		const canvas = (id, name, offset = 0) => ({ id, name, createdAt: now + offset, updatedAt: now + offset });
		const conversations = [canvas("mixed", "海边故事"), canvas("other", "另一段对话"), canvas("paused", "暂停的视频"), canvas("unknown", "待核对的视频"), canvas("download", "待下载的视频"), canvas("running", "生成中的图片")];
		const previous = { ...canvas("old", "旧的归档", -10000), archivedAt: now - 5000 };
		const canvases = atCapacity ? [conversations[0], ...Array.from({ length: 499 }, (_, index) => ({ ...canvas(`old-${index}`, `历史 ${index}`), archivedAt: now - index }))] : [...conversations, previous];
		localStorage.setItem("skiff.design.canvases.v1", JSON.stringify({ version: 1, activeId: "", canvases }));
		localStorage.setItem("skiff.workspace.navigation.v1", JSON.stringify({ workspaceMode: "design", designTool: "image-generation", codeTool: "chats" }));
		localStorage.setItem("skiff.design.sidebar.open", "true");
		const service = { id: "archive-service", name: "测试服务", configured: true, baseUrl: "http://127.0.0.1/v1", keyHint: "…test" };
		const imageModel = { id: "test-image", sizes: ["1024x1024"] };
		const videoModel = { id: "test-video", durations: [5], ratios: ["9:16"], referenceEnabled: true };
		for (const [kind, model] of [["images", imageModel], ["videos", videoModel]]) {
			localStorage.setItem(`skiff.test.${kind}.config`, JSON.stringify({ defaultServiceId: service.id, services: [{ ...service, defaultModel: model.id, models: [model] }] }));
		}
		const imageJob = (id, canvasId, status, prompt, extra) => ({ id, canvasId, status, prompt, serviceId: service.id, serviceName: service.name, modelId: imageModel.id, createdAt: now - 4000, size: "1024x1024", quality: "auto", ...extra });
		const videoJob = (id, canvasId, status, prompt, extra) => ({ id, canvasId, status, prompt, serviceId: service.id, serviceName: service.name, baseUrl: service.baseUrl, modelId: videoModel.id, createdAt: now - 2000, duration: 5, ratio: "9:16", resolution: "1080p", hasReference: false, ...extra });
		localStorage.setItem("skiff.test.images.jobs", JSON.stringify(atCapacity ? [] : [
			imageJob("mix-image", "mixed", "completed", "海边的第一张图", { path: image }),
			imageJob("mix-movable", "mixed", "completed", "可以移动的作品", { path: image }),
			imageJob("mix-failure", "mixed", "failed", "原来的失败提示词", { message: "测试失败原因", createdAt: now - 3000 }),
			imageJob("busy-image", "running", "generating", "工作中的图"),
		]));
		localStorage.setItem("skiff.test.videos.jobs", JSON.stringify(atCapacity ? [] : [
			videoJob("mix-video", "mixed", "completed", "海边的第一段视频", { path: video }),
			videoJob("busy-pause", "paused", "paused", "等待继续查询"),
			videoJob("busy-unknown", "unknown", "submission_unknown", "等待核对"),
			videoJob("busy-download", "download", "download_failed", "等待下载"),
		]));
	}, { image, video, atCapacity });
	await page.goto(`${url}&persist=1`);
	await page.getByRole("textbox", { name: "提示词 Prompt" }).waitFor();
}

function studioControls(page) {
	const navigation = page.getByRole("navigation", { name: "创作", exact: true });
	const conversations = page.getByRole("navigation", { name: "对话", exact: true });
	const newChat = navigation.getByRole("button", { name: "新对话", exact: true });
	const prompt = page.getByRole("textbox", { name: "提示词 Prompt" });
	const menu = page.getByRole("menu", { name: /^对话操作/ });
	const archive = menu.getByRole("menuitem", { name: "归档", exact: true });
	const search = page.getByRole("searchbox", { name: "搜索已归档对话" });
	const openNav = async () => {
		if (!await navigation.isVisible()) {
			await page.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name: "生图", exact: true }).click();
			await navigation.waitFor();
		}
	};
	return {
		conversations, newChat, prompt, menu, archive, search, openNav,
		async openConversation(name) { await openNav(); await conversations.getByRole("button", { name, exact: true }).click(); },
		async openMenu(name, keyboard = false) {
			await openNav();
			const trigger = conversations.getByRole("button", { name: `更多操作：${name}`, exact: true });
			if (keyboard) { await trigger.focus(); await trigger.press("ArrowDown"); }
			else { await conversations.getByRole("button", { name, exact: true }).hover(); await trigger.click(); }
			await menu.waitFor();
		},
		async openArchives() { await openNav(); await navigation.getByRole("button", { name: "已归档对话", exact: true }).click(); await search.waitFor(); },
		async closeMenu() { await page.keyboard.press("Escape"); await menu.waitFor({ state: "hidden" }); },
		async openAssets() { await openNav(); await navigation.getByRole("button", { name: "资产库", exact: true }).click(); },
	};
}

try {
	for (const [theme, width] of [["light", 1440], ["dark", 390]]) {
		const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], hasTouch: width === 390 });
		const page = await context.newPage();
		page.setDefaultTimeout(12000);
		const errors = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		await seed(page, theme);
		const ui = studioControls(page);
		await ui.openConversation("海边故事");
		await page.getByText("海边的第一张图", { exact: true }).waitFor();
		await ui.prompt.fill("保留的草稿");
		for (const [name, reason] of [["暂停的视频", "已暂停查询"], ["待核对的视频", "提交结果待核对"], ["待下载的视频", "视频下载失败"], ["生成中的图片", "图片正在生成或保存"]]) {
			await ui.openMenu(name);
			await ui.menu.getByText(reason, { exact: true }).waitFor();
			assert.equal(await ui.archive.getAttribute("aria-disabled"), "true");
			await ui.closeMenu();
		}
		await ui.openMenu("另一段对话", true);
		await page.keyboard.press("ArrowDown");
		assert.equal(await ui.archive.evaluate((node) => node === document.activeElement), true);
		await page.keyboard.press("Enter");
		await ui.menu.waitFor({ state: "hidden" });
		await ui.conversations.getByRole("button", { name: "另一段对话", exact: true }).waitFor({ state: "hidden" });
		if (width < 760) await page.keyboard.press("Escape");
		assert.equal(await ui.prompt.inputValue(), "保留的草稿");
		assert.equal(await page.getByText("海边的第一张图", { exact: true }).count(), 1);

		await ui.openMenu("海边故事");
		await ui.archive.click();
		await page.getByRole("heading", { name: "今天想创作什么？" }).waitFor();
		assert.equal(await ui.prompt.inputValue(), "保留的草稿");
		await ui.openNav();
		assert.equal(await ui.conversations.getByRole("button", { name: "早期作品", exact: true }).count(), 0);
		await ui.openAssets();
		if (width < 760) await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "预览作品：skiff-mix-mova.png", exact: true }).click();
		const asset = page.getByRole("dialog", { name: "作品预览", exact: true });
		await asset.getByText("对话：海边故事", { exact: true }).waitFor();
		assert.equal(await asset.getByRole("button", { name: "用作参考图", exact: true }).count(), 1);
		await asset.getByRole("button", { name: "移到对话…" }).click();
		const move = page.getByRole("dialog", { name: "移到对话", exact: true });
		assert.equal(await move.getByRole("radio", { name: "海边故事", exact: true }).count(), 0);
		assert.equal(await move.getByRole("button", { name: "确认移到对话", exact: true }).isDisabled(), true);
		await move.getByRole("radio", { name: "早期作品", exact: true }).click();
		await move.getByRole("button", { name: "确认移到对话", exact: true }).click();
		await asset.getByRole("button", { name: "关闭作品预览", exact: true }).click();
		await page.waitForFunction(() => JSON.parse(localStorage.getItem("skiff.test.images.jobs")).some((job) => job.id === "mix-movable" && !job.canvasId));

		await ui.openArchives();
		assert.deepEqual(await page.locator(".design-archive-row > span").allTextContents(), ["海边故事", "另一段对话", "旧的归档"]);
		await page.screenshot({ path: `${output}/${theme}-list.png`, animations: "disabled" });
		await ui.search.fill("不存在");
		await page.getByText("没有匹配的已归档对话", { exact: true }).waitFor();
		await ui.search.fill("海边");
		await page.getByRole("button", { name: /^海边故事/ }).press("Enter");
		const preview = page.getByRole("region", { name: "海边故事", exact: true });
		await preview.getByRole("heading", { name: "海边故事", exact: true }).waitFor();
		assert.equal(await ui.prompt.count(), 0);
		assert.equal(await preview.getByText("可以移动的作品", { exact: true }).count(), 0);
		await preview.getByRole("button", { name: "查看原因", exact: true }).click();
		await preview.getByText("测试失败原因", { exact: true }).waitFor();
		assert.equal(await preview.getByRole("button", { name: /使用提示词|修改后重新生成|图片操作/ }).count(), 0);
		const imageTurn = preview.locator(".design-turn").filter({ hasText: "海边的第一张图" });
		await imageTurn.getByRole("button", { name: "复制提示词", exact: true }).click();
		assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "海边的第一张图");
		await preview.getByRole("button", { name: /^预览图片/ }).click();
		const lightbox = page.getByRole("dialog", { name: "图片预览", exact: true });
		await lightbox.getByRole("button", { name: "放大", exact: true }).click();
		await page.keyboard.press("Escape");
		await preview.getByRole("button", { name: /^预览视频/ }).click();
		const player = page.getByRole("dialog", { name: "视频预览", exact: true });
		await player.locator("video[controls]").waitFor();
		await player.locator("video").evaluate((node) => node.play());
		assert.equal(await player.getByRole("button", { name: /使用提示词|从作品流移除|保存至当前项目/ }).count(), 0);
		await page.keyboard.press("Escape");
		await page.screenshot({ path: `${output}/${theme}-preview.png`, animations: "disabled" });
		assert.deepEqual(await page.evaluate(() => [window.skiffPreview.generation.calls.length, window.skiffPreview.videos.calls.length]), [0, 0]);

		await preview.getByRole("button", { name: "恢复对话", exact: true }).click();
		await ui.prompt.waitFor();
		assert.equal(await ui.prompt.inputValue(), "保留的草稿");
		await ui.openMenu("海边故事");
		await ui.archive.click();
		await page.getByRole("heading", { name: "今天想创作什么？" }).waitFor();
		await page.reload();
		await ui.prompt.waitFor();
		await ui.openArchives();
		await page.getByRole("button", { name: /^海边故事/ }).click();
		await preview.getByText("海边的第一段视频", { exact: true }).waitFor();
		await preview.getByRole("button", { name: "返回已归档对话", exact: true }).click();
		await ui.search.waitFor();
		await page.getByRole("button", { name: /^海边故事/ }).click();
		await preview.getByRole("button", { name: "恢复对话", exact: true }).click();
		await page.evaluate(() => {
			window.skiffPreview.generation.setMode("pending");
			const bridge = window.__TAURI_INTERNALS__;
			const invoke = bridge.invoke.bind(bridge);
			bridge.invoke = (command, ...args) => command === "start_image_generation"
				? new Promise((resolve) => { window.releaseImageSubmission = () => resolve(invoke(command, ...args)); })
				: invoke(command, ...args);
		});
		await ui.prompt.fill("在原对话继续创作");
		await page.getByRole("button", { name: "生成图片", exact: true }).click();
		await page.waitForFunction(() => !!window.releaseImageSubmission);
		await ui.openMenu("海边故事");
		await ui.menu.getByText("正在提交图片", { exact: true }).waitFor();
		assert.equal(await ui.archive.getAttribute("aria-disabled"), "true");
		await page.evaluate(() => window.releaseImageSubmission());
		await page.waitForFunction(() => window.skiffPreview.generation.calls.length === 1);
		await ui.menu.getByText("图片正在生成或保存", { exact: true }).waitFor();
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls[0].canvasId), "mixed");
		await page.evaluate(() => window.skiffPreview.generation.finishJob(window.skiffPreview.generation.calls[0].id));
		await ui.menu.getByText("图片正在生成或保存", { exact: true }).waitFor({ state: "hidden" });
		assert.equal(await ui.archive.getAttribute("aria-disabled"), null);
		assert.deepEqual(errors, []);
		await context.close();
		console.log(`PASS ${theme} ${width}px: archive/restore, read-only mixed timeline, assets, keyboard and per-conversation task restrictions`);
	}

	const capacityPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	await seed(capacityPage, "light", true);
	const ui = studioControls(capacityPage);
	await capacityPage.getByText(/对话已达 500 条上限/).waitFor();
	await ui.prompt.fill("保留的图片描述");
	await ui.prompt.press("Control+Enter");
	assert.equal(await capacityPage.getByRole("button", { name: "生成图片", exact: true }).isDisabled(), true);
	assert.equal(await ui.prompt.inputValue(), "保留的图片描述");
	await capacityPage.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name: "生成视频", exact: true }).click();
	await ui.prompt.fill("保留的视频描述");
	await ui.prompt.press("Control+Enter");
	assert.equal(await capacityPage.locator(".generation-submit").getByRole("button", { name: "生成视频", exact: true }).isDisabled(), true);
	assert.equal(await ui.prompt.inputValue(), "保留的视频描述");
	assert.deepEqual(await capacityPage.evaluate(() => [window.skiffPreview.generation.calls.length, window.skiffPreview.videos.calls.length]), [0, 0]);
	await ui.openConversation("海边故事");
	await capacityPage.locator(".generation-submit").getByRole("button", { name: "生成视频", exact: true }).click();
	await capacityPage.waitForFunction(() => window.skiffPreview.videos.calls.length === 1);
	assert.equal(await capacityPage.evaluate(() => window.skiffPreview.videos.calls[0].canvasId), "mixed");
	console.log("PASS capacity: archived rows count toward the limit, drafts survive, existing conversations can continue");
} finally { await browser.close(); }
