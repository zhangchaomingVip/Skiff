import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/workspace-modes", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const mode = (name) => page.getByRole("group", { name: "工作模式", exact: true }).getByRole("button", { name: name === "code" ? "Code 工作区" : "Design 设计室", exact: true });
const gallery = () => page.locator(".design-gallery-route:not([hidden])");
const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt", exact: true });
const group = (label) => page.getByRole("navigation", { name: "设计资产分组", exact: true }).getByRole("button", { name: new RegExp(`^${label}`) });

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1600, height: 1000 });
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.locator(".composer-input").waitFor();
		await page.evaluate(() => {
			const workspace = JSON.parse(localStorage.getItem("skiff.workspace.v1"));
			const project = workspace.projects.find((item) => item.id === workspace.chats.find((chat) => chat.id === workspace.activeId).projectId);
			const image = (width, height, color) => { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, width, height); return canvas.toDataURL("image/png"); };
			const service = { id: "studio", name: "本地设计验证", baseUrl: "http://127.0.0.1/v1", configured: true, keyHint: "…test", defaultModel: "test-image", models: [{ id: "test-image", sizes: ["1024x1024"] }] };
			localStorage.setItem("skiff.test.images.config", JSON.stringify({ services: [service], defaultServiceId: service.id, concurrencyLimit: 5 }));
			localStorage.setItem("skiff.test.images.jobs", JSON.stringify([[640, 900, "#90aaa4"], [900, 480, "#cdb6a5"], [480, 480, "#abb7ce"]].map(([width, height, color], index) => ({ id: `saved-${index}`, status: "completed", serviceId: service.id, serviceName: service.name, modelId: "test-image", prompt: `Studio 作品 ${index + 1}`, size: "1024x1024", quality: "auto", createdAt: Date.now() - index * 1000, path: image(width, height, color), projectRoot: project.path }))));
			localStorage.setItem("skiff.workspace.navigation.v1", JSON.stringify({ workspaceMode: "code", codeTool: "chats", designTool: "image-generation" }));
		});
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
		await page.locator(".composer-input").fill("Code 草稿：保留工程上下文");
		// The title bar owns the mode switch and the rail only lists the tools of the
		// active mode, so no two indicators ever compete in the same column.
		assert.deepEqual(await page.locator(".activity-bar").first().locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), ["对话", "文件", "设置"], "The rail keeps only first-level views");
		assert.equal(await page.locator(".titlebar .workspace-mode-switcher").count(), 1, "The segmented mode switch sits in the title bar");
		assert.deepEqual(await page.locator(".titlebar .workspace-mode-switcher button").evaluateAll((buttons) => buttons.map((button) => button.innerText.trim())), ["Code", "Design"], "Each tab pairs its icon with a text label");
		const processes = await page.evaluate(() => [...window.skiffPreview.processes.keys()]);
		assert.equal(await page.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name: "生图", exact: true }).count(), 0);
		await mode("design").click();
		assert.equal(await page.locator(".code-workspace").isVisible(), false);
		assert.equal(await page.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name: "对话", exact: true }).count(), 0);
		assert.equal(await page.getByRole("button", { name: "返回对话", exact: true }).count(), 0);
		await prompt().fill("Design 草稿：暖色海报");
		await page.waitForFunction(() => [...document.querySelectorAll(".generation-card img")].every((image) => image.complete && image.naturalWidth > 0));
		assert.equal(await gallery().locator(".generation-card").evaluateAll((cards) => new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size), 3, "Three differently sized works occupy the three selected masonry columns");
		await page.screenshot({ path: `dist/workspace-modes/${theme}-studio.png`, animations: "disabled" });
		await page.locator(".generation-fields").evaluate((element) => { element.scrollTop = 160; });
		const scroll = await page.locator(".generation-fields").evaluate((element) => element.scrollTop);
		assert.ok(Number(await gallery().locator(".generation-gallery-grid").evaluate((element) => getComputedStyle(element).columnCount)) > 1, "Studio uses responsive masonry columns");
		await mode("code").click();
		assert.equal(await page.locator(".composer-input").inputValue(), "Code 草稿：保留工程上下文");
		await mode("design").click();
		assert.equal(await prompt().inputValue(), "Design 草稿：暖色海报");
		assert.equal(await page.locator(".generation-fields").evaluate((element) => element.scrollTop), scroll);
		assert.deepEqual(await page.evaluate(() => [...window.skiffPreview.processes.keys()]), processes, "Switching workspaces must not restart pi");
		await page.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name: "生成视频", exact: true }).click();
		await prompt().fill("视频草稿：镜头缓缓推进");
		await mode("code").click();
		if (await page.locator("dialog[open][data-variant=drawer]").count()) await page.keyboard.press("Escape");
		await mode("design").click();
		assert.equal(await prompt().inputValue(), "视频草稿：镜头缓缓推进");
		await page.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name: "生图", exact: true }).click();
		assert.equal(await prompt().inputValue(), "Design 草稿：暖色海报");
		await page.evaluate(() => window.skiffPreview.generation.setMode("pending"));
		await page.getByRole("button", { name: "生成图片", exact: true }).click();
		await gallery().getByText("正在生成图片…", { exact: true }).waitFor();
		await mode("code").click(); await mode("design").click();
		assert.equal(await gallery().locator(".generation-pending-card").count(), 1);
		await group("进行中").click();
		assert.equal(await gallery().locator(".generation-card:not(.generation-pending-card)").count(), 0);
		await gallery().getByRole("button", { name: "停止等待", exact: true }).click();
		await group("失败记录").click();
		await gallery().getByText("已停止等待", { exact: true }).waitFor();
		await group("全部作品").click();
		const card = gallery().locator(".generation-card").filter({ hasText: "Studio 作品 1" });
		await card.getByRole("button", { name: /^更多作品操作/ }).click();
		await page.getByRole("menuitem", { name: "保存至当前项目", exact: true }).click();
		await page.getByRole("button", { name: "在 Code 中查看", exact: true }).waitFor();
		const saved = await page.evaluate(() => window.skiffPreview.designAssets.saves[0]);
		assert.match(saved.path, /^assets\//); assert.ok(saved.root);
		await page.getByRole("button", { name: "在 Code 中查看", exact: true }).click();
		assert.equal(await mode("code").getAttribute("aria-pressed"), "true");
		assert.equal(await page.locator(".code-workspace .file-workspace-view").isVisible(), true);
		await mode("design").click();
		// The studio owns its gallery: no project picker, no Code column, no project sync.
		const sidebar = page.getByRole("complementary", { name: "Design 导航", exact: true });
		assert.equal(await sidebar.getByRole("combobox").count(), 0, "Design does not bind a Code project");
		assert.equal(await page.getByRole("button", { name: "同步项目图片", exact: true }).count(), 0, "No project image sync entry");
		assert.deepEqual(await page.getByRole("navigation", { name: "设计资产分组", exact: true }).getByRole("button").evaluateAll((buttons) => buttons.map((button) => button.querySelector("span").textContent)), ["全部作品", "进行中", "失败记录", "已移除"], "Only studio status groups remain");
		assert.equal(await gallery().getByText("Code", { exact: true }).count(), 0, "Code assets never appear in the studio");
		await page.reload();
		assert.equal(await mode("design").getAttribute("aria-pressed"), "true");
		await gallery().getByText("Studio 作品 1", { exact: false }).first().waitFor();
		await page.setViewportSize({ width: 600, height: 800 });
		await page.getByRole("button", { name: "创作参数", exact: true }).click();
		await page.getByRole("dialog", { name: "创作参数", exact: true }).getByRole("textbox", { name: "提示词 Prompt" }).waitFor();
		await page.screenshot({ path: `dist/workspace-modes/${theme}-narrow.png`, animations: "disabled" });
		await page.keyboard.press("Escape");
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.setViewportSize({ width: 390, height: 800 });
		await mode("code").click();
		if (await page.locator("dialog[open][data-variant=drawer]").count()) await page.keyboard.press("Escape");
		await mode("design").click();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		console.log(`PASS ${theme}: modes, independent routes/drafts/scroll, live tasks, filters, project saves, decoupled studio, persistence and 390/600px layouts`);
	}
	assert.deepEqual(errors, []);
} finally { await browser.close(); }
