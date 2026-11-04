import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "../.playwright-cli/node_modules/playwright-core");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] || "http://localhost:1421";
await mkdir("dist", { recursive: true });
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/preview.html?fixture=message-images&theme=${theme}`);
		const row = page.locator(".msg.user > .message-attachments");
		await row.first().waitFor();
		const thumbs = row.first().locator(".message-image");
		assert.equal(await thumbs.count(), 2, `${theme}: sent images share one attachment row`);
		const thumb = await thumbs.first().boundingBox();
		assert.equal(Math.round(thumb.width), 100, `${theme}: thumbnails stay small`);
		assert.equal(Math.round(thumb.height), 76);
		const bubble = await page.locator(".msg.user .message-bubble").first().boundingBox();
		const rowBox = await row.first().boundingBox();
		assert.ok(rowBox.y + rowBox.height <= bubble.y, `${theme}: thumbnails sit above the text bubble`);
		assert.ok(Math.abs(rowBox.x + rowBox.width - (bubble.x + bubble.width)) < 1, `${theme}: thumbnails align with the bubble edge`);
		assert.equal(await page.locator(".msg.user .message-bubble .message-attachments .message-image").count(), 1, `${theme}: an image-only message keeps its thumbnail inside the bubble`);
		await page.screenshot({ path: `dist/message-images-${theme}.png` });
		await thumbs.first().click();
		const dialog = page.getByRole("dialog", { name: "图片预览", exact: true });
		await dialog.waitFor();
		assert.match(await dialog.locator("img").getAttribute("src"), /^data:image\/png;base64,/, `${theme}: the lightbox shows the full image`);
		await page.getByRole("button", { name: "关闭图片预览", exact: true }).click();
		await dialog.waitFor({ state: "detached" });
		assert.deepEqual(errors, [], `${theme}: no browser errors`);
		console.log(`PASS ${theme}: 100x76 thumbnails above the bubble, image-only bubble, click opens the lightbox`);
		await page.close();
	}
} finally {
	await browser.close();
}
