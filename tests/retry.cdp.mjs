import assert from "node:assert/strict";
import { join } from "node:path";

/** Real WebView → Rust → pi coverage; all requests use the isolated local provider. */
export async function verifyToolResultsAndRetries(page, setScenario, requests, artifacts) {
	setScenario("tools");
	await page.fill(".composer-input", "请执行两次工具以验证重复 ID。");
	await page.click(".send-btn");
	await page.getByText("CDP 重复工具 ID 验证完成", { exact: true }).waitFor({ timeout: 60_000 });
	assert.equal(requests.length, 3);
	assert.equal(await page.locator(".tool").count(), 2);
	assert.equal(await page.locator(".tool-state.running").count(), 0);
	assert.ok(requests[1].payload.messages.some((message) => message.role === "tool" && String(message.content).includes("cdp-tool-1")));
	assert.ok(requests[2].payload.messages.some((message) => message.role === "tool" && String(message.content).includes("cdp-tool-2")));
	console.log("PASS CDP: two real Bash calls with the same ID both receive their own result");

	setScenario("failure");
	await page.fill(".composer-input", "验证上游 503 与重试耗尽。");
	await page.click(".send-btn");
	await page.locator(".retry-progress").first().waitFor({ timeout: 60_000 });
	const retry = page.locator(".retry-progress").first();
	await retry.getByRole("button", { name: /服务器繁忙/ }).click();
	await retry.getByText("错误详情", { exact: true }).waitFor();
	assert.ok((await retry.innerText()).includes("no_available_workers"));
	await page.getByRole("button", { name: "停止生成", exact: true }).click();
	await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
	assert.ok((await page.locator(".retry-progress").last().innerText()).includes("已停止重试"));
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector(".composer-input", { timeout: 60_000 });
	const cancelled = page.locator(".request-failure").last();
	await cancelled.getByRole("button", { name: "请求失败", exact: true }).click();
	assert.ok((await cancelled.innerText()).includes("no_available_workers"));
	console.log("PASS CDP: cancelled retry retains its provider error after reloading the omitted context");

	const offset = requests.length;
	await page.fill(".composer-input", "再次验证五次重试耗尽。");
	await page.click(".send-btn");
	const failure = page.locator(".request-failure").last();
	await page.waitForFunction(() => document.querySelectorAll(".retry-progress").length === 5 && !document.querySelector('button[aria-label="停止生成"]'), undefined, { timeout: 60_000 });
	await failure.getByRole("button", { name: "重试", exact: true }).waitFor({ timeout: 60_000 });
	assert.equal(requests.length - offset, 6, "Exactly one initial request plus five automatic retries");
	assert.equal(await page.locator(".retry-progress").filter({ hasText: "正在重新连接" }).count(), 0);
	await failure.getByRole("button", { name: "请求失败", exact: true }).click();
	assert.ok((await failure.innerText()).includes("No available workers"));
	assert.ok((await failure.innerText()).includes("cdp-retry-request"));
	await page.screenshot({ path: join(artifacts, "cdp-retry-failure.png") });
	console.log("PASS CDP: bounded retries end in an inspectable provider error with request ID");

	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector(".composer-input", { timeout: 60_000 });
	const restored = page.locator(".request-failure").last();
	await restored.getByRole("button", { name: "请求失败", exact: true }).click();
	assert.ok((await restored.innerText()).includes("no_available_workers"));
	assert.equal(await page.locator(".tool-state.running").count(), 0);
	assert.equal(requests.length - offset, 6, "Restoring a failed session must not retry it");
	console.log("PASS CDP: provider error and completed tools survive a real session reload");
}
