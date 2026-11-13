import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testImage } from "./imageFixture.mjs";

export async function verifyImageConcurrency(page, scenario, serviceId, dir, artifacts) {
	const prompt = () => page.getByRole("textbox", { name: "提示词 Prompt" });
	const generate = () => page.getByRole("button", { name: "生成图片", exact: true });
	const cards = () => page.locator(".generation-pending-card");
	const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
	const limit = () => settings().getByRole("combobox", { name: "同时生成任务数", exact: true });
	const list = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_image_generation_jobs"));
	const nativeStart = (input) => page.evaluate(async (input) => {
		try { return await window.__TAURI_INTERNALS__.invoke("start_image_generation", { input }); }
		catch (error) { return String(error); }
	}, input);
	const setLimit = async (value) => {
		await page.getByRole("button", { name: "管理生成服务", exact: true }).click();
		await limit().selectOption(String(value));
		await page.waitForFunction(async (expected) => (await window.__TAURI_INTERNALS__.invoke("get_image_generation_config")).concurrencyLimit === expected, value);
		await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
	};
	const submit = async (index) => {
		await prompt().fill(`并行任务 ${index}`);
		await generate().click();
		await cards().getByText(`并行任务 ${index}`, { exact: true }).waitFor();
	};
	scenario.setMode("held");
	const before = scenario.requests.length;
	const beforeCompleted = (await list()).filter((job) => job.status === "completed").length;
	await page.getByRole("button", { name: "管理生成服务", exact: true }).click();
	assert.equal(await limit().inputValue(), "5");
	await page.screenshot({ path: join(artifacts, "image-concurrency-settings-cdp.png"), animations: "disabled" });
	await settings().getByRole("button", { name: "关闭设置", exact: true }).click();
	// Each parallel edit owns a durable reference snapshot, even after replacement.
	const firstReference = testImage();
	await page.locator('input[aria-label="上传图生图参考图"]').setInputFiles({ name: "并行参考一.png", mimeType: "image/png", buffer: firstReference });
	await submit(1);
	const secondReference = await page.evaluate(async () => {
		const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
		canvas.getContext("2d").fillRect(0, 0, 16, 16);
		return canvas.toDataURL("image/png").split(",")[1];
	});
	await page.locator('input[aria-label="上传图生图参考图"]').setInputFiles({ name: "并行参考二.png", mimeType: "image/png", buffer: Buffer.from(secondReference, "base64") });
	await submit(2);
	await page.getByRole("button", { name: "移除图生图参考图", exact: true }).click();
	for (let i = 3; i <= 5; i++) await submit(i);
	assert.equal(await cards().count(), 5);
	assert.equal(await generate().isDisabled(), true);
	const input = { id: crypto.randomUUID(), serviceId, modelId: "test-image", prompt: "超过并发限制", size: "1024x1024", quality: "auto" };
	assert.match(await nativeStart(input), /并发上限 5/);
	let jobs = await list();
	const first = jobs.find((job) => job.prompt === "并行任务 1");
	const second = jobs.find((job) => job.prompt === "并行任务 2");
	assert.equal(first.reference.name, "并行参考一.png"); assert.equal(second.reference.name, "并行参考二.png");
	assert.deepEqual(await readFile(join(dir, "image-inputs", `${first.id}.png`)), firstReference);
	assert.deepEqual(await readFile(join(dir, "image-inputs", `${second.id}.png`)), Buffer.from(secondReference, "base64"));
	const replay = await nativeStart({ ...input, id: first.id });
	assert.equal(replay.id, first.id, "Idempotent replay still succeeds at capacity");
	await setLimit(3);
	assert.equal(await cards().count(), 5, "Lowering the limit must not cancel running jobs");
	assert.match(await nativeStart(input), /并发上限 3/);
	await setLimit(10);
	for (let i = 6; i <= 10; i++) await submit(i);
	assert.equal(await generate().isDisabled(), true);
	assert.match(await nativeStart(input), /并发上限 10/);
	await setLimit(0);
	await submit(11);
	assert.equal(await cards().count(), 11);
	assert.equal(await generate().isEnabled(), true);
	assert.equal(JSON.parse(await readFile(join(dir, "config.json"), "utf8")).concurrencyLimit, 0);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForFunction(() => document.querySelectorAll(".generation-pending-card").length === 11);
	await page.screenshot({ path: join(artifacts, "image-concurrency-cdp.png"), animations: "disabled" });
	// Finish out of order, fail one request and cancel one; the others keep running.
	scenario.finish("并行任务 11"); scenario.finish("并行任务 3", "failure");
	await cards().filter({ hasText: "并行任务 2" }).getByRole("button", { name: "停止等待", exact: true }).click();
	await page.waitForFunction(() => document.querySelectorAll(".generation-pending-card").length === 8);
	jobs = await list();
	assert.equal(jobs.find((job) => job.prompt === "并行任务 2").status, "cancelled");
	assert.equal(jobs.find((job) => job.prompt === "并行任务 3").status, "failed");
	assert.equal(jobs.find((job) => job.prompt === "并行任务 11").status, "completed");
	for (const i of [10, 1, 9, 4, 8, 5, 7, 6]) scenario.finish(`并行任务 ${i}`);
	await page.waitForFunction(() => document.querySelectorAll(".generation-pending-card").length === 0);
	jobs = await list();
	assert.equal(jobs.filter((job) => job.status === "completed").length, beforeCompleted + 9);
	for (const job of jobs.filter((job) => job.prompt.startsWith("并行任务 ") && job.status === "completed")) assert.deepEqual(await readFile(job.path), testImage());
	const calls = scenario.requests.slice(before);
	assert.equal(calls.length, 11, "Limits and idempotent replay must never send extra POSTs");
	assert.deepEqual(calls.find((call) => call.payload.prompt === "并行任务 1").image.bytes, firstReference);
	assert.deepEqual(calls.find((call) => call.payload.prompt === "并行任务 2").image.bytes, Buffer.from(secondReference, "base64"));
	await setLimit(5);
	scenario.setMode("success");
	console.log("PASS real image concurrency: 3/5/10/unlimited enforced in Rust, independent edit snapshots, replay at capacity, reload, out-of-order results and isolated cancellation");
}
