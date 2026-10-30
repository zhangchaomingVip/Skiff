import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "../.playwright-cli/node_modules/playwright-core");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] ?? "http://localhost:1421";
await fs.mkdir("dist", { recursive: true });

try {
	for (const theme of ["light", "dark"]) {
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
		try {
			const page = await context.newPage(), errors = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto(`${base}/tests/draft-storage.html`);
			await page.waitForFunction(() => !!window.storageFixture);
			await page.evaluate(() => window.storageFixture.seedV1([{ chatId: "s0", cwd: "D:\\workspace\\Skiff", sessionFile: "s0.jsonl", revision: 1, text: "保留的草稿", attachments: [{ id: "old", name: "old.txt", kind: "text", bytes: 10, needsReattach: true }, { id: "other", name: "other.txt", kind: "text", bytes: 10, needsReattach: true }] }]));
			const ready = async () => {
				await page.waitForFunction(() => !!document.querySelector(".composer") && !document.querySelector(".session-loading") && document.querySelector(".sidebar")?.dataset.connected === "true");
				await page.evaluate((theme) => { localStorage.setItem("skiff.theme", theme); document.documentElement.dataset.theme = theme; }, theme);
			};
			await page.goto(`${base}/tests/retrievability.html`); await ready();
			const input = page.getByRole("textbox", { name: "聊天消息", exact: true });
			const add = page.getByRole("button", { name: "添加图片、文本或 Word 文件", exact: true });
			const send = page.getByRole("button", { name: "发送消息", exact: true });
			assert.equal(await input.inputValue(), "保留的草稿");
			assert.equal(await add.isEnabled(), true);
			assert.equal(await send.isEnabled(), false);
			await input.fill("缺失附件时仍可编辑"); await input.press("Enter");
			assert.equal(await input.inputValue(), "缺失附件时仍可编辑", "Enter must not send an incomplete draft");
			await page.screenshot({ path: `dist/draft-attachments-missing-${theme}.png` });
			const choose = async (button, file) => { const chooser = page.waitForEvent("filechooser"); await button.click(); await (await chooser).setFiles(file); };
			await choose(page.getByRole("button", { name: "重新添加 old.txt", exact: true }), { name: "renamed.txt", mimeType: "text/plain", buffer: Buffer.alloc(512 * 1024, 92) });
			await page.getByRole("button", { name: "移除文件 renamed.txt", exact: true }).waitFor();
			assert.equal(await page.getByRole("button", { name: "重新添加 old.txt", exact: true }).count(), 0);
			assert.equal(await send.isEnabled(), false, "The unrelated missing attachment still blocks sending");
			await page.getByRole("button", { name: "移除缺失附件 other.txt", exact: true }).click();
			assert.equal(await send.isEnabled(), true);
			await page.evaluate(() => window.retrievalFixture.drafts.flush());
			await page.goto(`${base}/tests/retrievability.html?restore=1`); await ready();
			await page.getByRole("button", { name: "移除文件 renamed.txt", exact: true }).waitFor();
			assert.equal(await send.isEnabled(), true);
			assert.equal(await page.getByText(/附件超出草稿保存上限|本地存储配额不足/).count(), 0);
			assert.equal(await page.evaluate(() => window.retrievalFixture.drafts.get("s0").attachments[0].body === "\\".repeat(512 * 1024)), true);

			const png = Buffer.alloc(5 * 1024 * 1024);
			Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=", "base64").copy(png);
			await choose(add, { name: "maximum.png", mimeType: "image/png", buffer: png });
			await page.getByRole("button", { name: "移除图片 maximum.png", exact: true }).waitFor();
			await page.evaluate(() => window.retrievalFixture.drafts.flush());
			await page.goto(`${base}/tests/retrievability.html?restore=1`); await ready();
			await page.getByRole("img", { name: "maximum.png", exact: true }).waitFor();
			assert.equal(await page.evaluate(() => atob(window.retrievalFixture.drafts.get("s0").attachments.find((item) => item.kind === "image").body).length), png.length);
			await page.getByRole("button", { name: "移除图片 maximum.png", exact: true }).click();
			await page.evaluate(() => window.retrievalFixture.drafts.flush());

			await page.evaluate(() => {
				window.originalDraftPut = IDBObjectStore.prototype.put;
				IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === "attachments") throw new DOMException("full", "QuotaExceededError"); return window.originalDraftPut.call(this, value, ...args); };
			});
			await choose(add, { name: "quota.txt", mimeType: "text/plain", buffer: Buffer.from("new content") });
			await page.getByText(/本地存储配额不足.*quota.txt/).waitFor();
			assert.equal(await send.isEnabled(), true, "Memory-only content remains sendable");
			await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalDraftPut; });
			await page.getByRole("button", { name: "重试保存", exact: true }).click();
			await page.getByText(/本地存储配额不足/).waitFor({ state: "detached" });
			await page.evaluate(() => window.retrievalFixture.drafts.flush());
			await page.goto(`${base}/tests/retrievability.html?restore=1`); await ready();
			await page.getByRole("button", { name: "移除文件 quota.txt", exact: true }).waitFor();
			assert.equal(await send.isEnabled(), true);
			await page.screenshot({ path: `dist/draft-attachments-restored-${theme}.png` });
			assert.deepEqual(errors, []);
			console.log(`PASS ${theme}: visible reattachment, rename/remove, Enter guard, escaped 512KiB text, 5MiB image, reload, quota/retry`);
		} finally { await context.close(); }
	}
} finally { await browser.close(); }
