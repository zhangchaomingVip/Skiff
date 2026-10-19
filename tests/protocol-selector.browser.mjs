// Verifies the provider editor's API protocol selector end to end on the mock
// bridge. Run on the preview port: node tests/protocol-selector.browser.mjs http://127.0.0.1:1423
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://127.0.0.1:1423";
const output = new URL("../features/023-unified-settings-entry/screenshots/", import.meta.url);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = () => page.getByRole("dialog", { name: "设置", exact: true });
const button = (name) => dialog().getByRole("button", { name, exact: true });
const loose = (pattern) => dialog().getByRole("button", { name: pattern });
const shot = (name) => page.screenshot({ animations: "disabled", path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });

try {
	await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=light`);
	await page.waitForFunction(() => document.querySelector(".settings-trigger")?.textContent.includes("pi 已连接"));
	await page.keyboard.press("Control+Comma");
	await dialog().waitFor();
	await button("供应商").click();

	// The list shows each provider's protocol.
	await button("编辑 官方直连").waitFor();
	assert.match(await dialog().getByText(/· OpenAI ·/).first().textContent(), /OpenAI/);

	// Existing provider: the selector appears between 名称 and API 密钥 and defaults to OpenAI.
	await button("编辑 官方直连").click();
	await page.locator("#relay-protocol").waitFor();
	assert.equal(await page.locator("#relay-protocol").inputValue(), "openai");
	const labels = await page.locator("#relay-protocol option").allTextContents();
	assert.deepEqual(labels, ["Kimi", "OpenAI", "OpenAI Responses", "Anthropic", "Google GenAI", "Vertex AI"]);
	assert.equal(await page.locator("label[for=relay-protocol]").textContent(), "API协议");
	await shot("provider-protocol-openai");

	// Choosing a protocol re-shapes the endpoint hint.
	await page.locator("#relay-protocol").selectOption("anthropic");
	assert.match(await page.locator("#relay-base + small").textContent(), /Anthropic/);
	await shot("provider-protocol-anthropic");
	await page.locator("#relay-protocol").selectOption("google-genai");
	assert.match(await page.locator("#relay-base + small").textContent(), /Google/);

	// Saving persists the protocol and the list row reflects it.
	await page.locator("#relay-protocol").selectOption("anthropic");
	await button("保存").click();
	await button("编辑 官方直连").waitFor();
	assert.match(await dialog().getByText(/· Anthropic ·/).first().textContent(), /Anthropic/);
	await shot("provider-protocol-saved");

	// A Kimi preset starts on the Kimi protocol instead of OpenAI.
	await button("添加供应商").click();
	await loose(/^Kimi（月之暗面）/).click();
	await page.locator("#relay-protocol").waitFor();
	assert.equal(await page.locator("#relay-protocol").inputValue(), "kimi");
	await button("返回列表").click();

	await button("关闭设置").click();
	await dialog().waitFor({ state: "detached" });
	assert.deepEqual(errors, []);
	console.log("PASS protocol selector: options, default, hint, persistence, row label and Kimi preset");
} catch (error) {
	await shot("protocol-failure");
	console.error(errors);
	throw error;
} finally { await browser.close(); }
