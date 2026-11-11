import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testImage } from "./imageFixture.mjs";

export function createImageGenerationScenario() {
	const requests = [];
	let mode = "success";
	return {
		requests, setMode(value) { mode = value; },
		handle(request, response) {
			if (request.method !== "POST" || request.url !== "/v1/images/generations") return false;
			let body = "";
			request.on("data", (chunk) => { body += chunk; });
			request.on("end", () => {
				const payload = JSON.parse(body);
				requests.push({ payload, authorization: request.headers.authorization });
				const outcome = mode;
				const finish = () => {
					if (response.destroyed) return;
					response.writeHead(outcome === "failure" ? 429 : 200, { "Content-Type": "application/json" });
					response.end(JSON.stringify(outcome === "failure" ? { error: { message: "mock quota exceeded" } } : { data: [{ b64_json: testImage().toString("base64") }], usage: { total_tokens: 42 } }));
				};
				setTimeout(finish, outcome === "pending" ? 5000 : 400);
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
	await settings().getByRole("button", { name: "保存生成服务", exact: true }).click();
	await settings().getByRole("button", { name: "编辑生成服务 CDP 图片服务", exact: true }).waitFor();
	assert.equal(scenario.requests.length, 0, "Saving configuration is free of generation calls");
	const diskConfig = await readFile(join(dir, "config.json"), "utf8");
	assert.ok(diskConfig.includes("dpapi1:")); assert.ok(!diskConfig.includes("dummy-image-key"));
	const config = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_image_generation_config"));
	assert.equal("apiKey" in config.services[0], false); assert.equal(config.services[0].keyHint, "…1234");
	const configStatus = await page.evaluate(async (path) => (await fetch(window.__TAURI__.core.convertFileSrc(path))).status, join(dir, "config.json"));
	assert.equal(configStatus, 403, "Asset protocol must not expose stored credentials or metadata");
	await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
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
	await page.getByText("已停止等待", { exact: true }).waitFor();
	scenario.setMode("failure");
	await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 额度不足测试");
	await generate().click();
	await page.getByText("生成失败", { exact: true }).waitFor();
	assert.match(await page.locator(".generation-task-list").innerText(), /429/);
	assert.equal(scenario.requests.filter((request) => request.payload.prompt === "CDP 额度不足测试").length, 1);
	jobs = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_image_generation_jobs"));
	assert.equal(jobs.filter((job) => job.status === "completed").length, 1);
	assert.equal(jobs.filter((job) => job.status === "cancelled").length, 1);
	await tool("对话").click();
	console.log("PASS real image chain: UI settings → encrypted key → Rust HTTP → saved PNG → asset preview; reload/idempotence/cancellation/429 verified");
}
