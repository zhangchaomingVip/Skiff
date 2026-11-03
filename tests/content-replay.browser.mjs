import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.SKIFF_BROWSER_CHANNEL ?? "msedge" });
const base = process.argv[2] ?? "http://localhost:1421";
const shots = process.argv[3] ?? "docs/screenshots/content-replay";
const expected = {
	"content-replay-a": [
		"旁白 A：先运行命令并搜索资料，随后读取说明文件。",
		"尾段正文 A：三种工具的结果都已核对，完整回答保留在这里。",
	],
	"content-replay-b": [
		"首段正文 B：先说明本轮的检查目标。",
		"中段旁白 B：接下来同时运行命令并搜索资料。",
		"尾段正文 B：所有阶段均完成，文字保持原样。",
	],
};
await mkdir(shots, { recursive: true });
try {
	for (const theme of ["light", "dark"]) {
		for (const [fixture, texts] of Object.entries(expected)) {
			const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
			const errors = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto(`${base}/tests/preview.html?fixture=${fixture}&theme=${theme}&static=1`);
			await page.locator(".msg.assistant .md").first().waitFor();
			assert.equal(await page.locator(".assistant-reply").count(), 1, `${fixture} ${theme}: all tool steps share one reply container`);
			assert.equal(await page.locator(".assistant-reply .message-bubble").count(), 0, `${fixture} ${theme}: no separate bubbles around pi fragments`);
			const bodyTexts = await page.locator(".msg.assistant .msg-body > .md").allTextContents();
			assert.deepEqual(bodyTexts.map((text) => text.trim()), texts, `${fixture} ${theme}: every content block remains in reply order`);
			const labels = await page.locator(".msg.assistant .turn-process > summary .process-row-label").allTextContents();
			assert.ok(labels.some((label) => /执行了 1 条命令 · 联网搜索了 1 次/.test(label)), `${fixture} ${theme}: settled rows show final counts`);
			assert.ok(labels.every((label) => !/旁白 [AB]/.test(label)), `${fixture} ${theme}: settled rows no longer show narration`);
			const mixed = page.locator(".msg.assistant .tool-run").filter({ hasText: "执行了命令" }).filter({ hasText: "搜索网页" });
			assert.equal(await mixed.count(), 1, `${fixture} ${theme}: mixed command and web group exists`);
			const iconPath = await mixed.locator(":scope > summary .process-row-icon path").getAttribute("d");
			assert.equal(iconPath, "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 18l9 5 9-5", `${fixture} ${theme}: mixed group uses the layers icon`);
			assert.deepEqual(errors, [], `${fixture} ${theme}: no browser errors`);
			const shot = `${shots}/${fixture}-${theme}.png`;
			await page.screenshot({ path: shot, fullPage: true });
			const groupRow = mixed.locator(":scope > summary");
			const processRow = mixed.locator("xpath=ancestor::details[contains(@class, 'turn-process')][1]/summary");
			await processRow.click();
			await groupRow.click();
			const expandedShot = `${shots}/${fixture}-${theme}-expanded.png`;
			await page.screenshot({ path: expandedShot, fullPage: true });
			console.log(`${fixture} ${theme}: text=${bodyTexts.length}, labels=${labels.join(" | ")}, icon=layers, screenshots=${shot}, ${expandedShot}`);
			await page.close();
		}
	}
} finally {
	await browser.close();
}
