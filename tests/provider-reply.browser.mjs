// Mock UI regression; native HTTP/IPC reply validation lives in Rust and app.cdp.mjs.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(resolve(".playwright-cli/node_modules/playwright-core"));
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
const output = resolve("dist/provider-reply");
await mkdir(output, { recursive: true });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${process.argv[2] ?? "http://localhost:1421"}/tests/preview.html?fixture=settings-info&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar-footer")?.textContent.includes("pi 已连接"));
		await page.evaluate(async () => {
			const invoke = window.__TAURI_INTERNALS__.invoke;
			const config = await invoke("list_model_families");
			const relay = config.relays.find((relay) => relay.name === "官方直连");
			const model = config.families.flatMap((family) => family.routes).find((route) => route.relayId === relay.id).models[0];
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				if (command === "list_settings_metadata") return { version: 1, tests: [{ relayId: relay.id, modelId: model.modelId, completedAt: Date.now(), configVersion: "old-http-only", ok: true, latencyMs: 12, status: 200, errorCategory: null, configChanged: true }], usage: [] };
				if (command === "test_provider_connection") return { ok: false, latencyMs: 20, status: 200, error: "接口返回了 HTML 网页，未收到模型回复；请检查 Base URL 是否包含 /v1 等接口前缀" };
				return invoke(command, args);
			};
		});
		await page.keyboard.press("Control+Comma");
		const settings = page.getByRole("dialog", { name: "设置", exact: true });
		await settings.getByRole("button", { name: "供应商", exact: true }).click();
		const row = settings.locator(".provider-relay-row").filter({ hasText: "官方直连" }).first();
		await row.getByText("· 需重新测试", { exact: true }).waitFor();
		assert.equal(await row.locator(".provider-row-test-status.is-success").count(), 0);
		await page.screenshot({ path: join(output, `stale-${theme}.png`) });
		await settings.getByRole("button", { name: "编辑 官方直连", exact: true }).click();
		await settings.locator(".provider-model-test").first().getByRole("button", { name: "测试", exact: true }).click();
		const result = settings.locator(".provider-model-test .test-result").first();
		await result.getByText(/失败.*HTTP 200.*HTML/).waitFor();
		assert.match(await result.getAttribute("class"), /bad/);
		await page.screenshot({ path: join(output, `invalid-reply-${theme}.png`) });
	}
	assert.deepEqual(errors, []);
	console.log("PASS provider reply UI: stale successes require retesting, HTTP 200 HTML shows model-test failure, light/dark themes");
} finally {
	await browser.close();
}
