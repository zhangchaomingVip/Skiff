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
	await page.waitForFunction(() => document.querySelector(".sidebar-footer")?.textContent.includes("pi 已连接"));
	await page.keyboard.press("Control+Comma");
	await dialog().waitFor();
	await button("供应商").click();

	// OpenAI is the default protocol and stays implicit in the list.
	await button("编辑 官方直连").waitFor();
	assert.equal(await dialog().locator(".provider-protocol-tag").count(), 0);
	assert.doesNotMatch(await dialog().locator(".provider-row-meta").first().textContent(), /OpenAI/);

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
	const officialRow = dialog().locator(".provider-relay-row").filter({ hasText: /^官方直连/ }).first();
	const protocolBadge = officialRow.locator(".provider-row-title .provider-protocol-tag");
	assert.deepEqual(await protocolBadge.allTextContents(), ["Anthropic"]);
	assert.equal(await protocolBadge.evaluate((node) => node.previousElementSibling?.tagName), "STRONG");
	assert.ok((await protocolBadge.getAttribute("class")).includes("muted-tag"), "Non-default protocols use the muted badge style");
	assert.doesNotMatch(await officialRow.locator(".provider-row-meta").textContent(), /Anthropic|OpenAI/);
	await shot("provider-protocol-saved");

	// Long Aliyun endpoints keep a compact host label and expose the safe full URL on hover.
	await button("编辑 官方直连").click();
	await page.locator("#relay-protocol").selectOption("openai");
	await page.locator("#relay-base").fill("https://ws-u4rxmkejbrrkfhif.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
	await button("保存").click();
	await page.locator("#relay-name").waitFor({ state: "detached" });
	await button("编辑 官方直连").waitFor();
	const endpoint = dialog().locator(".provider-row-endpoint").filter({ hasText: "ws-u4rxmke" });
	assert.equal(await endpoint.count(), 1);
	assert.equal(await endpoint.textContent(), "ws-u4rxmke…aliyuncs.com");
	assert.equal(await endpoint.getAttribute("title"), "https://ws-u4rxmkejbrrkfhif.cn-beijing.maas.aliyuncs.com/compatible-mode/v1");
	assert.equal(await dialog().locator(".provider-protocol-tag").count(), 0, "OpenAI remains implicit after changing the endpoint");
	await shot("provider-aliyun-short");

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
