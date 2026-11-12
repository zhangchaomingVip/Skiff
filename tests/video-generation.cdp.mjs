import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testVideo } from "./videoFixture.mjs";
import { testImage } from "./imageFixture.mjs";

export function createVideoGenerationScenario() {
	let mode = "success";
	const requests = []; const gets = []; const tasks = new Map();
	return {
		requests, gets, setMode(value) { mode = value; },
		handle(request, response) {
			if (!request.url?.startsWith("/v1/videos")) return false;
			assert.equal(request.headers.authorization, "Bearer dummy-video-key-5678");
			const send = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
			if (request.method === "POST") {
				let body = ""; request.on("data", (chunk) => { body += chunk; });
				request.on("end", () => {
					const payload = JSON.parse(body); requests.push(payload);
					if (mode === "ambiguous") return send(502, { error: { message: "accepted but response lost" } });
					if (mode === "unauthorized") return send(401, { error: { message: "dummy-video-key-5678 must not be shown" } });
					const id = `muse_cdp_${requests.length}`; tasks.set(id, payload);
					send(202, { id, task_id: id, status: "queued", progress: 0 });
				});
				return true;
			}
			gets.push(request.url);
			const id = request.url.split("/")[3]; if (!tasks.has(id)) { send(404, { error: { message: "task not found" } }); return true; }
			if (request.url.endsWith("/content")) {
				if (mode === "download-failure") { send(503, { error: { message: "download unavailable" } }); return true; }
				response.writeHead(200, { "Content-Type": "video/mp4" }); response.end(testVideo()); return true;
			}
			const status = mode === "pending" ? "in_progress" : "completed";
			send(200, { id, status, progress: status === "completed" ? 100 : 15, usage: { billing_mode: "per_second", billing_seconds: 5, cost: 0 } }); return true;
		},
	};
}

export async function verifyVideoGeneration(page, scenario, baseUrl, dir, artifacts, restartDesktop) {
	const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
	const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
	const generate = () => page.locator(".generation-controls").getByRole("button", { name: "生成视频", exact: true });
	const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
	await tool("生成视频").click();
	await page.getByRole("button", { name: "配置视频服务", exact: true }).click();
	await settings().getByRole("button", { name: "添加视频服务", exact: true }).click();
	await settings().getByRole("textbox", { name: "服务名称", exact: true }).fill("CDP 视频服务");
	await settings().getByRole("textbox", { name: "API 地址", exact: true }).fill(baseUrl);
	await settings().getByRole("textbox", { name: "API Key", exact: true }).fill("dummy-video-key-5678");
	await settings().getByRole("checkbox", { name: "启用单图参考（实验）", exact: true }).check();
	await settings().getByRole("button", { name: "保存视频服务", exact: true }).click();
	await settings().getByRole("button", { name: "编辑视频服务 CDP 视频服务", exact: true }).waitFor();
	assert.equal(scenario.requests.length, 0);
	const disk = await readFile(join(dir, "video-config.json"), "utf8"); assert.ok(disk.includes("dpapi1:")); assert.ok(!disk.includes("dummy-video-key"));
	const config = await invoke("get_video_generation_config"); assert.equal("apiKey" in config.services[0], false);
	const exposed = await page.evaluate(async (paths) => Promise.all(paths.map(async (path) => (await fetch(window.__TAURI__.core.convertFileSrc(path))).status)), [join(dir, "video-config.json")]);
	assert.deepEqual(exposed, [403]);
	await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
	await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 视频：蓝色纸船，波光缓慢移动"); await generate().click();
	await page.getByText("生成作品", { exact: true }).waitFor({ timeout: 30000 });
	let jobs = await invoke("list_video_generation_jobs"); const first = jobs[0];
	assert.ok(first.completedAt >= first.createdAt); assert.equal(first.actualWidth, 72); assert.equal(first.actualHeight, 128); assert.equal(first.actualDuration, 5); assert.equal(first.actualFps, 24);
	assert.deepEqual(await readFile(first.path), testVideo());
	assert.deepEqual(scenario.requests[0], { model: "muse-video", prompt: "CDP 视频：蓝色纸船，波光缓慢移动", duration: 5, aspect_ratio: "9:16", resolution: "1080p" });
	await invoke("start_video_generation", { input: { id: first.id, serviceId: config.services[0].id, modelId: "muse-video", prompt: "duplicate", duration: 5, ratio: "9:16" } }); assert.equal(scenario.requests.length, 1);
	await page.locator(".generation-card-preview").click();
	await page.waitForFunction(() => document.querySelector("dialog video")?.readyState >= 2);
	await page.waitForFunction(() => !document.querySelector("dialog video")?.paused);
	const video = page.getByRole("dialog", { name: "视频预览", exact: true }).locator("video");
	await video.evaluate((v) => { v.currentTime = 2; v.muted = false; });
	await page.waitForFunction(() => document.querySelector("dialog video")?.currentTime >= 2);
	assert.match(await page.getByRole("dialog", { name: "视频预览", exact: true }).innerText(), /72 × 128/);
	await page.screenshot({ path: join(artifacts, "video-generation-cdp.png") }); await page.keyboard.press("Escape");

	scenario.setMode("download-failure"); await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 下载重试"); await generate().click();
	await page.getByRole("status").filter({ hasText: "视频下载失败" }).waitFor({ timeout: 30000 });
	scenario.setMode("success"); await page.getByRole("button", { name: "重新下载", exact: true }).click();
	await page.waitForFunction(() => document.querySelectorAll(".generation-card").length === 2); assert.equal(scenario.requests.length, 2);

	scenario.setMode("pending"); await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 首帧与进程重启恢复");
	await page.locator('input[aria-label="上传首帧参考图"]').setInputFiles({ name: "boat.png", mimeType: "image/png", buffer: testImage() });
	await generate().click(); await page.waitForFunction(() => document.querySelector('.generation-task[data-status="in_progress"]'));
	assert.ok(scenario.requests[2].image.startsWith("data:image/jpeg;base64,")); assert.equal(scenario.requests.length, 3);
	jobs = await invoke("list_video_generation_jobs"); const pending = jobs.find((j) => j.status === "in_progress");
	assert.ok((await readFile(join(dir, "video-inputs", `${pending.id}.jpg`))).length > 0);
	assert.equal(await page.evaluate(async (path) => (await fetch(window.__TAURI__.core.convertFileSrc(path))).status, join(dir, "video-inputs", `${pending.id}.jpg`)), 403);
	await tool("对话").click(); await tool("生成视频").click();
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "暂停查询", exact: true }).click();
	await page.getByRole("status").filter({ hasText: "已暂停查询" }).waitFor();
	await page.getByRole("button", { name: "继续查询", exact: true }).click();
	await page.waitForFunction(() => document.querySelector('.generation-task[data-status="in_progress"]'));
	const before = scenario.requests.length;
	scenario.setMode("success"); page = await restartDesktop();
	await page.waitForFunction(() => document.querySelectorAll(".generation-card").length === 3, null, { timeout: 30000 });
	assert.equal(scenario.requests.length, before, "A fresh Rust process must recover by GET, never POST");
	jobs = await invoke("list_video_generation_jobs"); assert.equal(jobs.find((j) => j.id === pending.id).status, "completed");

	scenario.setMode("ambiguous"); await page.getByRole("textbox", { name: "提示词 Prompt" }).fill("CDP 提交结果未知"); await generate().click();
	await page.getByRole("status").filter({ hasText: "提交结果待核对" }).waitFor(); assert.equal(await generate().isDisabled(), true);
	await page.getByRole("button", { name: "核对后结束跟踪", exact: true }).click();
	await page.getByRole("button", { name: "已核对，结束跟踪", exact: true }).click();
	await page.getByRole("status").filter({ hasText: "已结束本地跟踪" }).waitFor();
	scenario.setMode("unauthorized"); await generate().click(); await page.getByRole("status").filter({ hasText: "视频生成失败" }).waitFor();
	assert.ok(!(await page.locator(".generation-task-list").innerText()).includes("dummy-video-key"));
	await tool("对话").click();
	console.log("PASS real video chain: encrypted settings → JSON/reference → Rust polling → streamed MP4 → native asset playback/seek; download retry, pause/resume, process restart without POST, unknown submission and 401 verified");
	return page;
}
