import assert from "node:assert/strict";

/** Run in the harness's isolated WebView profile, before its first model request. */
export async function verifyDraftAttachments(page) {
	const input = page.getByRole("textbox", { name: "聊天消息", exact: true });
	await input.fill("CDP 附件草稿恢复验证");
	const chooser = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "添加图片、文本或 Word 文件", exact: true }).click();
	await (await chooser).setFiles({ name: "cdp-draft.txt", mimeType: "text/plain", buffer: Buffer.alloc(512 * 1024, 92) });
	await page.getByRole("button", { name: "移除文件 cdp-draft.txt", exact: true }).waitFor();
	const saved = async (expectAttachment) => {
		const chatId = JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId;
		const db = await new Promise((resolve, reject) => { const request = indexedDB.open("skiff-drafts"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		try {
			const record = await new Promise((resolve) => { const request = db.transaction("drafts").objectStore("drafts").get(chatId); request.onsuccess = () => resolve(request.result); });
			if (expectAttachment) {
				if (!record?.attachments[0]?.contentId || record.attachments[0].body !== undefined) return false;
				const asset = await new Promise((resolve) => { const request = db.transaction("attachments").objectStore("attachments").get(record.attachments[0].contentId); request.onsuccess = () => resolve(request.result); });
				return asset?.blob?.size === 512 * 1024 && await asset.blob.text() === "\\".repeat(512 * 1024);
			}
			const count = await new Promise((resolve) => { const request = db.transaction("attachments").objectStore("attachments").index("chatId").count(chatId); request.onsuccess = () => resolve(request.result); });
			return !record?.attachments.length && count === 0;
		} finally { db.close(); }
	};
	await page.waitForFunction(saved, true);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "移除文件 cdp-draft.txt", exact: true }).waitFor({ timeout: 60000 });
	assert.equal(await input.inputValue(), "CDP 附件草稿恢复验证");
	await page.waitForFunction(saved, true);
	await page.getByRole("button", { name: "移除文件 cdp-draft.txt", exact: true }).click();
	await page.waitForFunction(saved, false);
	console.log("附件草稿全链路通过：真实 WebView2 保存 512 KiB 转义文本为 Blob，刷新恢复全文，移除后清理实体。");
}
