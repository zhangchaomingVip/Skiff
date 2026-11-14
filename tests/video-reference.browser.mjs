import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";
import { testImage } from "./imageFixture.mjs";

// A cross-origin image without CORS headers reproduces the tainted-canvas case:
// the old <img> + canvas path threw "SecurityError: Tainted canvases may not be exported".
const origin = process.argv[2] ?? "http://localhost:1421";
const bytes = testImage();
const server = createServer((request, response) => { response.writeHead(200, { "Content-Type": "image/png" }); response.end(bytes); });
await new Promise((resolve) => server.listen(1423, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
try {
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
	await page.locator(".composer-input").waitFor();
	const local = await page.evaluate(async (dataUrl) => (await import("/src/workbench/videoGeneration.ts")).prepareVideoReference(dataUrl), `data:image/png;base64,${bytes.toString("base64")}`);
	assert.match(local, /^data:image\/jpeg;base64,/, "A local reference still compresses to JPEG");
	const foreign = await page.evaluate(async (url) => {
		try { return { ok: true, data: await (await import("/src/workbench/videoGeneration.ts")).prepareVideoReference(url) }; }
		catch (error) { return { ok: false, message: String(error) }; }
	}, "http://127.0.0.1:1423/reference.png");
	assert.equal(foreign.ok, false, "A cross-origin image without CORS cannot be exported");
	assert.match(foreign.message, /无法读取首帧参考图/);
	assert.doesNotMatch(foreign.message, /SecurityError|tainted/i, "The canvas never ends up tainted");
	assert.deepEqual(errors, []);
	console.log("PASS: local references compress, cross-origin references fail with a readable message");
} finally { await browser.close(); server.close(); }
