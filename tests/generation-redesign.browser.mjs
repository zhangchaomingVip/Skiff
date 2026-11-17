import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { imageSizeMenu, openCanvasComposer, openDesignCanvas } from "./workspace-navigation.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const output = "dist/generation-redesign";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });

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
		localStorage.setItem("skiff.test.design-assets", "[]");
		localStorage.removeItem("skiff.workspace.navigation.v1"); localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "image-generation" }));
	});
	await target.goto(`${origin}/tests/preview.html?fixture=sidebar&persist=1&theme=${theme}`);
	await openDesignCanvas(target);
	await target.waitForFunction(() => [...document.querySelectorAll(".generation-card-preview img")].length === 3 && [...document.querySelectorAll(".generation-card-preview img")].every((img) => img.naturalWidth > 0));
}

try {
	for (const theme of ["light", "dark"]) {
		await seed(theme);
		// The flow is a conversation: prompt bubbles on the right, works on the left.
		const turns = page.locator(".design-turn");
		assert.equal(await turns.count(), 3, "One turn per prompt");
		const prompts = await page.locator(".design-bubble-prompt").allTextContents();
		assert.match(prompts[0], /^今天也有/, "The flow opens with the oldest prompt");
		assert.match(prompts[2], /^窗边的花/, "The newest prompt closes the flow");
		assert.equal(await page.locator(".design-bubble").first().evaluate((element) => {
			const bubble = element.getBoundingClientRect(), result = element.closest(".design-turn").querySelector(".design-result").getBoundingClientRect();
			return bubble.left > result.left;
		}), true, "The prompt bubble sits to the right of its work");
		assert.deepEqual(await page.locator(".generation-card-preview img").evaluateAll((images) => images.map((image) => getComputedStyle(image).objectFit)), ["contain", "contain", "contain"]);
		assert.equal(await page.getByRole("group", { name: "画廊列数", exact: true }).count(), 0, "No density switch survives above the flow");
		assert.equal(await page.getByRole("group", { name: "画廊视图", exact: true }).count(), 0, "No status tabs survive above the flow");
		assert.equal(await page.getByRole("button", { name: /导入作品/ }).count(), 0, "The flow carries no import toolbar");
		await openCanvasComposer(page);
		assert.ok(await page.locator(".generation-controls").evaluate((element) => element.scrollWidth <= element.clientWidth));
		await page.screenshot({ path: `${output}/${theme}-gallery.png`, animations: "disabled" });
		assert.equal(await page.locator(".design-workspace").evaluate(el => el.scrollTop), 0, "Copy status never creates an outer scroll range");
		assert.equal(await page.locator(".design-stage").evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector(".design-workspace").getBoundingClientRect().top - 1) < 1), true, "The flow starts at the workspace top");
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

		// Actions are outside the bubble and below the image.
		assert.equal(await page.locator(".design-stage-bar, .design-bubble-meta, .design-result-card .design-result-meta, .generation-hover-actions").count(), 0);
		assert.equal(await page.getByRole("button", { name: "添加参考图", exact: true }).isVisible(), false);
		assert.equal(await page.getByText("每次 1 张 · 按服务商计费").count(), 0);
		assert.equal(await page.getByText("快速生成").count(), 0);
		const newest = page.locator(".design-turn").filter({ hasText: "窗边的花" });
		const aligned = await newest.evaluate((turn) => {
			const composer = document.querySelector(".design-composer").getBoundingClientRect();
			const bubble = turn.querySelector(".design-bubble").getBoundingClientRect();
			const result = turn.querySelector(".design-result-card").getBoundingClientRect();
			const mode = document.querySelector(".generation-field-mode").getBoundingClientRect();
			const submit = document.querySelector(".generation-submit button").getBoundingClientRect();
			return { left: Math.abs(result.left - composer.left), right: Math.abs(bubble.right - composer.right), toolbar: Math.abs(mode.top + mode.height / 2 - submit.top - submit.height / 2), height: composer.height };
		});
		assert.ok(aligned.left < 1 && aligned.right < 1, JSON.stringify(aligned));
		assert.ok(aligned.toolbar < 1 && aligned.height < 150, JSON.stringify(aligned));
		assert.equal(await page.locator(".generation-field-configure").evaluate((element) => {
			const size = document.querySelector(".generation-size-trigger").getBoundingClientRect();
			const gear = element.getBoundingClientRect();
			return gear.left >= size.right && Math.abs(gear.top - size.top) < 1;
		}), true, "Settings follow the size chip");
		await page.mouse.move(1350, 100);
		await page.waitForFunction(() => [...document.querySelectorAll(".design-prompt-actions")].every((bar) => getComputedStyle(bar).opacity === "0"));
		await newest.locator(".design-bubble").hover();
		await page.waitForFunction(() => getComputedStyle(document.querySelector(".design-turn:last-child .design-prompt-actions")).opacity === "1");
		await newest.getByRole("button", { name: "复制提示词", exact: true }).click();
		assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^窗边的花/);
		const openActions = async () => {
			await newest.locator(".generation-card-media").hover();
			await newest.locator(".generation-image-menu-trigger").click();
		};
		assert.equal(await page.locator(".design-result-actions").count(), 0);
		await page.getByRole("textbox", { name: "提示词 Prompt" }).focus();
		await page.mouse.move(1350, 100);
		await page.waitForFunction(() => [...document.querySelectorAll(".generation-image-menu-trigger")].every(el => getComputedStyle(el).opacity === "0"));
		await newest.locator(".generation-card-preview").click({ button: "right", position: { x: 40, y: 40 } });
		assert.equal(await page.getByRole("dialog", { name: "图片预览", exact: true }).count(), 0, "Right-click never opens the lightbox");
		await page.getByRole("menuitem", { name: "复制", exact: true }).click();
		await page.getByRole("status").filter({ hasText: "已复制图片" }).waitFor();
		assert.equal(await page.evaluate(async () => (await navigator.clipboard.read()).some((item) => item.types.includes("image/png"))), true);
		await page.keyboard.press("Escape");
		await newest.locator(".generation-card-preview").click();
		const lightbox = page.getByRole("dialog", { name: "图片预览", exact: true });
		await lightbox.waitFor();
		assert.equal(await lightbox.locator("header, footer, .generation-preview-info").count(), 0);
		assert.equal(await lightbox.getByRole("button").count(), 4);
		const zoomText = lightbox.getByLabel("当前缩放");
		assert.equal(await zoomText.innerText(), "100%");
		const picture = lightbox.locator("img");
		await picture.dblclick();
		assert.equal(await zoomText.innerText(), "200%");
		const beforePan = await picture.boundingBox();
		await page.mouse.move(720, 520);
		await page.mouse.down();
		await page.mouse.move(800, 570, { steps: 5 });
		assert.equal(await picture.evaluate(el => getComputedStyle(el).cursor), "grabbing");
		await page.mouse.up();
		const afterPan = await picture.boundingBox();
		assert.ok(Math.abs(afterPan.x - beforePan.x - 80) < 1 && Math.abs(afterPan.y - beforePan.y - 50) < 1);
		assert.equal(await picture.evaluate(el => getComputedStyle(el).cursor), "grab");
		await lightbox.getByRole("button", { name: "复位缩放" }).click();
		assert.equal(await zoomText.innerText(), "100%");
		await page.mouse.move(720, 520);
		for (let index = 0; index < 4; index++) await page.mouse.wheel(0, -1000);
		await page.waitForFunction(() => document.querySelector('.image-lightbox output')?.textContent === "500%");
		assert.equal(await lightbox.getByRole("button", { name: "放大", exact: true }).isDisabled(), true);
		for (let index = 0; index < 5; index++) await page.mouse.wheel(0, 1000);
		await page.waitForFunction(() => document.querySelector('.image-lightbox output')?.textContent === "50%");
		assert.equal(await lightbox.getByRole("button", { name: "缩小", exact: true }).isDisabled(), true);
		await lightbox.getByRole("button", { name: "复位缩放" }).click();
		await lightbox.getByRole("button", { name: "放大", exact: true }).click();
		assert.equal(await zoomText.innerText(), "125%");
		await lightbox.getByRole("button", { name: "缩小", exact: true }).click();
		assert.equal(await zoomText.innerText(), "100%");
		await picture.dblclick();
		await picture.dblclick();
		assert.equal(await zoomText.innerText(), "100%");
		await page.screenshot({ path: output + "/" + theme + "-lightbox.png", animations: "disabled" });
		await page.keyboard.press("Escape");
		assert.equal(await lightbox.count(), 0);
		assert.equal(await newest.locator(".generation-card-preview").evaluate(el => el === document.activeElement), true);
		await newest.locator(".generation-card-preview").click();
		await lightbox.locator(".image-lightbox-viewport").click({ position: { x: 10, y: 10 } });
		assert.equal(await lightbox.count(), 0);
		await newest.locator(".generation-card-preview").click();
		await lightbox.getByRole("button", { name: "关闭作品预览" }).click();
		await openActions();
		const actions = page.getByRole("menu", { name: "图片操作", exact: true });
		assert.deepEqual(await actions.locator("[role^=menuitem]").allTextContents(), ["用作参考图", "复制", "下载", "收藏", "删除"]);
		assert.equal(await actions.getByRole("separator").count(), 3);
		await actions.getByRole("menuitemcheckbox", { name: "收藏", exact: true }).click();
		await actions.getByRole("menuitemcheckbox", { name: "取消收藏", exact: true }).waitFor();
		assert.equal(await actions.getByRole("menuitemcheckbox").getAttribute("aria-checked"), "true");
		assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.design.favorites.v1")).ids.length), 1);
		await actions.getByRole("menuitemcheckbox", { name: "取消收藏", exact: true }).click();
		await actions.getByRole("menuitemcheckbox", { name: "收藏", exact: true }).waitFor();
		await actions.getByRole("menuitem", { name: "下载", exact: true }).click();
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.filter((call) => call.command === "export_image_generation_asset").length), 1);
		await openActions();
		await page.screenshot({ path: output + "/" + theme + "-actions.png", animations: "disabled" });
		await page.keyboard.press("End");
		assert.equal(await page.getByRole("menuitem", { name: "删除" }).evaluate((element) => element === document.activeElement), true);
		await page.keyboard.press("Home");
		assert.equal(await page.getByRole("menuitem", { name: "用作参考图", exact: true }).evaluate((element) => element === document.activeElement), true);
		await page.keyboard.press("Escape");
		await newest.locator(".design-bubble").hover();
		await newest.getByRole("button", { name: "使用提示词", exact: true }).click();
		assert.match(await page.getByRole("textbox", { name: "提示词 Prompt" }).inputValue(), /^窗边的花/);
		await page.waitForFunction(() => document.querySelector(".design-dock textarea") === document.activeElement);
		await openActions();
		await page.getByRole("menuitem", { name: "用作参考图", exact: true }).click();
		await page.locator(".generation-reference.has-image").waitFor();
		assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), await newest.locator(".generation-card-preview img").getAttribute("src"));
		await page.getByRole("button", { name: "移除图生图参考图" }).click();

		const dropData = await page.evaluateHandle(async () => {
			const source = document.querySelector(".design-turn:last-child img").src;
			const data = new DataTransfer();
			data.items.add(new File([await (await fetch(source)).blob()], "拖拽参考.png", { type: "image/png" }));
			return data;
		});
		await page.locator(".generation-form").dispatchEvent("dragenter", { dataTransfer: dropData });
		await page.locator(".generation-dropzone").waitFor();
		await page.locator(".generation-form").dispatchEvent("drop", { dataTransfer: dropData });
		await page.locator(".generation-reference.has-image").waitFor();
		await page.getByRole("button", { name: "移除图生图参考图" }).click();
		await dropData.dispose();
		await page.getByRole("group", { name: "创作类型" }).getByRole("button", { name: "视频", exact: true }).click();
		await openActions();
		await page.getByRole("menuitem", { name: "用作参考图", exact: true }).click();
		await page.locator('.generation-controls[data-kind="video"] .generation-reference.has-image').waitFor();
		assert.equal(await page.locator(".generation-reference-image img").getAttribute("src"), await newest.locator(".generation-card-preview img").getAttribute("src"));
		assert.match(await page.getByRole("textbox", { name: "提示词 Prompt" }).inputValue(), /^窗边的花/);
		await page.getByRole("button", { name: "移除首帧参考图" }).click();
		await page.getByRole("group", { name: "创作类型" }).getByRole("button", { name: "图片", exact: true }).click();

		// A submission joins the newest slot and scrolls the flow to it.
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
		await prompt.press("Control+Enter");
		assert.equal(await page.evaluate(() => window.skiffPreview.generation.calls.find((call) => call.prompt)?.size), "1440x2560");
		await page.getByText("正在生成图片…", { exact: true }).waitFor();
		assert.equal(await page.locator(".design-turn").last().evaluate((element) => !!element.querySelector(".generation-pending-card")), true, "The pending turn owns the newest slot");
		await page.waitForFunction(() => { const feed = document.querySelector(".design-thread-feed"); return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24; });
		await page.screenshot({ path: `${output}/${theme}-pending.png`, animations: "disabled" });
		await page.emulateMedia({ reducedMotion: "reduce" });
		assert.equal(await page.locator(".generation-pending-glow").evaluate((element) => getComputedStyle(element).animationName), "none");
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await page.getByRole("button", { name: "停止等待", exact: true }).click();
		await page.locator(".design-failure").filter({ hasText: "已停止等待" }).waitFor();
		const removable = page.locator('.design-turn[data-status="done"]').first();
		await removable.locator(".generation-card-preview").click({ button: "right" });
		await page.getByRole("menuitemcheckbox", { name: "收藏", exact: true }).click();
		await page.getByRole("status").filter({ hasText: "已收藏" }).waitFor();
		await page.reload();
		await openDesignCanvas(page);
		await removable.locator(".generation-card-preview").click({ button: "right" });
		assert.equal(await page.getByRole("menuitemcheckbox", { name: "取消收藏", exact: true }).getAttribute("aria-checked"), "true", "Favorite survives a full reload");
		await page.getByRole("menuitem", { name: "删除", exact: true }).click();
		await page.waitForFunction(() => document.querySelectorAll('.design-turn[data-status="done"]').length === 2);
		console.log(`PASS ${theme}: shared context menu, correct references in both tabs, persisted favorite, removal, lightbox and composer`);
	}
	const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
	const touch = await touchContext.newPage();
	await seed("light", touch);
	await touch.locator(".generation-image-menu-trigger").first().tap();
	const menu = touch.getByRole("menu", { name: "图片操作", exact: true });
	await menu.waitFor();
	const bounds = await menu.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
	assert.ok((await touch.getByRole("menuitem", { name: "下载", exact: true }).boundingBox()).height >= 44);
	await touch.screenshot({ path: `${output}/touch-actions.png`, animations: "disabled" });
	await touch.keyboard.press("Escape");
	await touch.locator(".design-user-message").first().getByRole("button", { name: "使用提示词", exact: true }).tap();
	await openCanvasComposer(touch);
	assert.match(await touch.getByRole("textbox", { name: "提示词 Prompt" }).inputValue(), /^今天也有/);
	assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
	await touch.screenshot({ path: `${output}/touch-controls.png`, animations: "disabled" });
	await touchContext.close();
	assert.deepEqual(errors, []);
	console.log("PASS touch: visible menu entry, 44px action targets, prompt reuse and narrow controls");
} finally { await browser.close(); }
