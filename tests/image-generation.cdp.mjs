import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testImage } from "./imageFixture.mjs";
import { verifyImageConcurrency } from "./image-concurrency.cdp.mjs";

export function createImageGenerationScenario() {
	const requests = [];
	const held = new Map();
	let mode = "success";
	return {
		requests, setMode(value) { mode = value; },
		finish(prompt, outcome = "success") { const finish = held.get(prompt); assert.ok(finish, `No held image request for ${prompt}`); held.delete(prompt); finish(outcome); },
		handle(request, response) {
			if (request.method !== "POST" || !["/v1/images/generations", "/v1/images/edits"].includes(request.url)) return false;
			const chunks = [];
			request.on("data", (chunk) => { chunks.push(chunk); });
			request.on("end", async () => {
				const body = Buffer.concat(chunks);
				const editing = request.url === "/v1/images/edits";
				let payload, image;
				if (editing) {
					const form = await new Response(body, { headers: { "content-type": request.headers["content-type"] } }).formData();
					const file = form.get("image");
					assert.ok(file instanceof File, "Reference must be a file part, not a URL");
					image = { type: file.type, name: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
					payload = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
				} else payload = JSON.parse(body.toString());
				requests.push({ endpoint: request.url, payload, image, authorization: request.headers.authorization });
				const outcome = mode;
				const finish = (result = outcome) => {
					if (response.destroyed) return;
					response.writeHead(result === "failure" ? editing ? 404 : 429 : 200, { "Content-Type": "application/json" });
					response.end(JSON.stringify(result === "failure" ? { error: { message: "mock quota exceeded" } } : { data: [{ b64_json: testImage().toString("base64") }], usage: { total_tokens: 42 } }));
				};
				if (outcome === "held") { held.set(payload.prompt, finish); response.once("close", () => held.delete(payload.prompt)); }
				else setTimeout(finish, outcome === "pending" ? 5000 : 400);
			});
			return true;
		},
	};
}

export async function verifyImageGeneration(page, scenario, baseUrl, dir, artifacts) {
	const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
	const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
	const generate = () => page.getByRole("button", { name: "生成图片", exact: true });
	await tool("生图").click();
	await page.getByRole("button", { name: "配置生成服务", exact: true }).click();
	await settings().getByRole("button", { name: "添加生成服务", exact: true }).click();
	await settings().getByRole("textbox", { name: "服务名称", exact: true }).fill("CDP 图片服务");
	await settings().getByRole("textbox", { name: "API 地址", exact: true }).fill(baseUrl);
	await settings().getByRole("textbox", { name: "API Key", exact: true }).fill("dummy-image-key-1234");
	await settings().getByRole("textbox", { name: "模型 ID 1", exact: true }).fill("test-image");
	await settings().getByRole("button", { name: "添加 2K 尺寸", exact: true }).click();
	await settings().getByRole("button", { name: "添加 4K 尺寸", exact: true }).click();
	await settings().getByRole("button", { name: "保存生成服务", exact: true }).click();
	await settings().getByRole("button", { name: "编辑生成服务 CDP 图片服务", exact: true }).waitFor();
	assert.equal(scenario.requests.length, 0, "Saving configuration is free of generation calls");
	const diskConfig = await readFile(join(dir, "config.json"), "utf8");
	assert.ok(diskConfig.includes("dpapi1:")); assert.ok(!diskConfig.includes("dummy-image-key"));
	const config = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_image_generation_config"));
	assert.equal("apiKey" in config.services[0], false); assert.equal(config.services[0].keyHint, "…1234");
	assert.ok(config.services[0].models[0].sizes.length > 16, "Combined tier presets fit the expanded native model size budget");
	assert.ok(config.services[0].models[0].sizes.includes("3840x2160"));
	const configStatus = await page.evaluate(async (path) => (await fetch(window.__TAURI__.core.convertFileSrc(path))).status, join(dir, "config.json"));
	assert.equal(configStatus, 403, "Asset protocol must not expose stored credentials or metadata");
	await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
	const resolution = page.getByRole("group", { name: "分辨率", exact: true });
	await resolution.getByRole("button", { name: "4K", exact: true }).click();
	assert.match(await page.locator(".generation-image-ratios").innerText(), /2880 × 2880/);
	await page.getByRole("group", { name: "画面比例", exact: true }).getByRole("button", { name: "16:9", exact: true }).click();
	assert.match(await page.locator(".generation-image-ratios").innerText(), /3840 × 2160/);
	await resolution.getByRole("button", { name: "2K", exact: true }).click();
	assert.match(await page.locator(".generation-image-ratios").innerText(), /2560 × 1440/);
	await resolution.getByRole("button", { name: "1K", exact: true }).click();
	await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 图片：一只纸船，奶油色背景");
	await page.getByRole("group", { name: "画面比例", exact: true }).getByRole("button", { name: /16:9/ }).click();
	await generate().click();
	await page.getByText("生成作品", { exact: true }).waitFor({ timeout: 30000 });
	await page.waitForFunction(() => document.querySelector(".generation-card img")?.naturalWidth > 0);
	assert.equal(scenario.requests.length, 1);
	assert.equal(scenario.requests[0].authorization, "Bearer dummy-image-key-1234");
	assert.deepEqual(scenario.requests[0].payload, { model: "test-image", prompt: "CDP 图片：一只纸船，奶油色背景", size: "1536x864", quality: "auto", n: 1, output_format: "png" });
	let jobs = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_image_generation_jobs"));
	assert.equal(jobs[0].status, "completed");
	assert.deepEqual(await readFile(jobs[0].path), testImage());
	const completedId = jobs[0].id;
	const completedPath = jobs[0].path;
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByText("生成作品", { exact: true }).waitFor();
	await page.waitForFunction(() => document.querySelector(".generation-card img")?.naturalWidth > 0);
	await page.screenshot({ path: join(artifacts, "image-generation-cdp.png") });
	// A repeated IPC submission with the same request ID must return the saved
	// result without a second billable request, even after a WebView reload.
	await page.evaluate(async (input) => window.__TAURI_INTERNALS__.invoke("start_image_generation", { input }), { id: completedId, serviceId: config.services[0].id, modelId: "test-image", prompt: "duplicate", size: "1024x1024", quality: "auto" });
	assert.equal(scenario.requests.length, 1);
	scenario.setMode("pending");
	await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 取消测试");
	await generate().click();
	await page.getByText("正在生成图片…", { exact: true }).waitFor();
	await page.waitForFunction(() => document.querySelector(".generation-pending-card[data-status=generating]"));
	await tool("对话").click(); await tool("生图").click();
	await page.getByText("正在生成图片…", { exact: true }).waitFor();
	// Reload while Rust is waiting: the active task is still tracked correctly.
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByText("正在生成图片…", { exact: true }).waitFor();
	await page.getByRole("button", { name: "停止等待", exact: true }).click();
	await page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: /^失败记录/ }).click();
		await page.getByText("已停止等待", { exact: true }).waitFor();
	scenario.setMode("failure");
	await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 额度不足测试");
	await generate().click();
	await page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: /^失败记录/ }).click();
		await page.getByText("生成失败", { exact: true }).waitFor();
	assert.match(await page.locator(".generation-task-list").innerText(), /429/);
	assert.equal(scenario.requests.filter((request) => request.payload.prompt === "CDP 额度不足测试").length, 1);
	jobs = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_image_generation_jobs"));
	assert.equal(jobs.filter((job) => job.status === "completed").length, 1);
	assert.equal(jobs.filter((job) => job.status === "cancelled").length, 1);

	// Upload a real PNG reference, keep the old text-to-image flow intact, and
	// inspect the bytes received by the Rust multipart request.
	scenario.setMode("success");
	await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("保留纸船形状，把背景改成星空");
	await page.locator('input[aria-label="上传图生图参考图"]').setInputFiles({ name: "纸船参考.png", mimeType: "image/png", buffer: testImage() });
	const beforeEdit = scenario.requests.length;
	await generate().click();
	await page.waitForFunction(() => document.querySelectorAll(".generation-card:not(.generation-pending-card)").length === 2);
	assert.equal(scenario.requests.length, beforeEdit + 1);
	const edit = scenario.requests.at(-1);
	assert.equal(edit.endpoint, "/v1/images/edits"); assert.equal(edit.authorization, "Bearer dummy-image-key-1234");
	assert.deepEqual(edit.payload, { model: "test-image", prompt: "保留纸船形状，把背景改成星空", size: "1024x1024", quality: "auto", n: "1", output_format: "png" });
	assert.equal(edit.image.type, "image/png"); assert.deepEqual(edit.image.bytes, testImage());
	jobs = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_image_generation_jobs"));
	const edited = jobs.find((job) => job.reference && job.status === "completed"); assert.ok(edited, `Missing edit metadata: ${JSON.stringify(jobs.map((job) => ({ id: job.id, status: job.status, reference: job.reference, prompt: job.prompt })))}`); assert.equal(edited.reference.name, "纸船参考.png");
	const snapshot = join(dir, "image-inputs", `${edited.id}.png`);
	assert.deepEqual(await readFile(snapshot), testImage());
	assert.equal(await page.evaluate(async (path) => (await fetch(window.__TAURI__.core.convertFileSrc(path))).status, snapshot), 403);
	await page.evaluate(async (input) => window.__TAURI_INTERNALS__.invoke("start_image_generation", { input }), { id: edited.id, serviceId: config.services[0].id, modelId: "test-image", prompt: "duplicate edit", size: "1024x1024", quality: "auto", reference: { name: "invalid", dataUrl: "invalid" } });
	assert.equal(scenario.requests.length, beforeEdit + 1, "Edit IPC replay must not read another reference or create another billable request");
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByText("图生图 · 纸船参考.png", { exact: true }).waitFor();
	// Reuse an asset:// original through the actual gallery action.
	const card = page.locator(".generation-card").filter({ hasText: "图生图 · 纸船参考.png" });
	await card.getByRole("button", { name: /^更多作品操作/ }).click();
	await page.getByRole("menuitem", { name: "以此图生成图片", exact: true }).click();
	await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("基于这张作品增加一颗星星");
	await generate().click();
	await page.waitForFunction(() => document.querySelectorAll(".generation-card:not(.generation-pending-card)").length === 3);
	assert.equal(scenario.requests.at(-1).endpoint, "/v1/images/edits"); assert.deepEqual(scenario.requests.at(-1).image.bytes, testImage());
	await page.screenshot({ path: join(artifacts, "image-edit-cdp.png") });
	scenario.setMode("failure"); const beforeFailure = scenario.requests.length;
	await generate().click();
	await page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: /^失败记录/ }).click();
		await page.getByText(/图生图失败：.*未自动改为文生图/).first().waitFor();
	assert.equal(scenario.requests.length, beforeFailure + 1); assert.equal(scenario.requests.at(-1).endpoint, "/v1/images/edits");
	await page.getByRole("button", { name: "移除图生图参考图", exact: true }).click();
	// Gallery removal persists only metadata; its original remains usable.
	const view = (name) => page.getByRole("group", { name: "画廊视图", exact: true }).getByRole("button", { name: new RegExp(`^${name} `) });
	await view("作品").click(); assert.equal(await page.locator(".generation-task-list").count(), 0);
	const originalName = `skiff-${completedId.slice(0, 8)}.png`;
	const originalCard = page.locator(".generation-card").filter({ has: page.getByRole("button", { name: `预览图片：${originalName}`, exact: true }) });
	await originalCard.getByRole("button", { name: /^更多作品操作/ }).click();
	await page.getByRole("menuitem", { name: "从画廊移除", exact: true }).click();
	await page.waitForFunction(() => document.querySelectorAll(".generation-card:not(.generation-pending-card)").length === 2);
	assert.deepEqual(await readFile(completedPath), testImage());
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForFunction(() => document.querySelectorAll(".generation-card:not(.generation-pending-card)").length === 2);
	assert.equal(await page.locator(".generation-task-list").count(), 0);
	jobs = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_image_generation_jobs"));
	assert.equal(jobs.find((job) => job.id === completedId).removed, true);
	await view("已移除").click(); await page.getByRole("button", { name: "恢复到画廊", exact: true }).click();
	await view("作品").click();
	await page.waitForFunction(() => document.querySelectorAll(".generation-card:not(.generation-pending-card)").length === 3);
	assert.deepEqual(await readFile(completedPath), testImage());
	const failedId = jobs.find((job) => job.status === "failed").id;
	assert.match(await page.evaluate(async (id) => { try { await window.__TAURI_INTERNALS__.invoke("set_image_generation_asset_removed", { id, removed: true }); return "unexpected"; } catch (error) { return String(error); } }, failedId), /只能移除/);
	assert.equal(scenario.requests.length, beforeFailure + 1, "Removing/restoring does not create image requests");
	await page.screenshot({ path: join(artifacts, "image-gallery-cdp.png") });
	await verifyImageConcurrency(page, scenario, config.services[0].id, dir, artifacts);
	await tool("对话").click();
	console.log("PASS real image chain: generation/edits, privacy, reload/idempotence/cancellation, separate failure history, durable gallery removal/restore with originals preserved, and errors without fallback verified");
}
