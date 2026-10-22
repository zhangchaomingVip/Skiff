import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "playwright");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.clock.install({ time: new Date("2026-10-22T00:00:00Z") });
	await page.clock.pauseAt(new Date("2026-10-22T00:00:01Z"));
	await page.goto(`${process.argv[2] || "http://localhost:1421"}/tests/draft-recovery.html`);
	const notice = page.locator(".draft-restored");
	const input = page.getByRole("textbox", { name: "聊天消息", exact: true });
	await notice.waitFor();
	assert.equal(await notice.textContent(), "已恢复上次输入");
	assert.equal(await input.inputValue(), "first restored");
	assert.equal(await notice.evaluate((node) => !!node.closest(".composer")), true);
	const height = await page.locator(".composer").evaluate((node) => node.clientHeight);
	await input.focus();
	await page.clock.fastForward(3999);
	assert.equal(await notice.count(), 1, "Focus alone retains the success status");
	await page.clock.fastForward(2);
	await notice.waitFor({ state: "detached" });
	assert.equal(await page.locator(".composer").evaluate((node) => node.clientHeight), height);
	await page.evaluate(() => window.draftRecovery.drafts.flush());
	assert.equal(await notice.count(), 0, "Save completion cannot repeat recovery");
	await page.getByRole("button", { name: "second", exact: true }).click();
	await notice.waitFor();
	await input.fill("edited");
	assert.equal(await notice.count(), 0);
	await page.getByRole("button", { name: "first", exact: true }).click();
	assert.equal(await notice.count(), 0, "Returning to an applied draft does not replay recovery");
	for (const id of ["empty", "missing", "incompatible"]) {
		await page.getByRole("button", { name: id, exact: true }).click();
		assert.equal(await notice.count(), 0, `${id} is not a successful recovery`);
		if (id === "missing") assert.equal(await page.getByRole("button", { name: "发送消息", exact: true }).isDisabled(), true);
		if (id === "incompatible") {
			assert.equal(await input.inputValue(), "");
			await page.clock.fastForward(5000);
			assert.match(await page.locator(".draft-notice").textContent(), /未自动应用/);
		}
	}
	await page.getByRole("button", { name: "attachment", exact: true }).click();
	await notice.waitFor();
	assert.match(await page.locator(".composer").textContent(), /saved.txt/);
	await input.fill("send with restored attachment");
	assert.equal(await notice.count(), 0);
	await page.getByRole("button", { name: "发送消息", exact: true }).click();
	assert.equal(await input.inputValue(), "");
	await page.getByRole("button", { name: "stale", exact: true }).click();
	await notice.waitFor();
	await input.press("End");
	await input.press("Control+Backspace");
	assert.equal(await notice.count(), 0, "Editing dismisses recovery immediately");
	await page.getByRole("button", { name: "removed", exact: true }).click();
	await notice.waitFor();
	await page.evaluate(() => window.draftRecovery.unmount());
	await notice.waitFor({ state: "detached" });
	await page.clock.fastForward(5000);
	await page.evaluate(() => window.draftRecovery.mount());
	await input.waitFor();
	assert.equal(await notice.count(), 0, "Unmount cleanup and consumed events prevent replay");
	for (const [id, action] of [["send", "Enter"], ["clear", "Escape"]]) {
		await page.getByRole("button", { name: id, exact: true }).click();
		await notice.waitFor();
		await input.press(action);
		await notice.waitFor({ state: "detached" });
		assert.equal(await input.inputValue(), "", `${id} dismisses recovery without a prior edit`);
	}
	await page.getByRole("button", { name: "removed", exact: true }).click();
	const markerChecks = await page.evaluate(async () => {
		const { DraftStore } = window.draftRecovery;
		const store = new DraftStore();
		await store.hydrate(["empty", "incompatible", "first", "second", "missing", "attachment", "stale", "removed"]);
		store.save({ chatId: "empty", cwd: "project", text: "new in memory", attachments: [] });
		store.save({ chatId: "incompatible", cwd: "other", text: "new compatible input", attachments: [] });
		store.remove("removed");
		return [store.consumeRecovery("empty"), store.consumeRecovery("incompatible"), store.consumeRecovery("removed")];
	});
	assert.deepEqual(markerChecks, [false, false, false]);
	await page.evaluate(async () => {
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function () { throw new DOMException("unavailable", "QuotaExceededError"); };
		const { drafts } = window.draftRecovery;
		drafts.save({ chatId: "removed", cwd: "project", text: "preserve", attachments: [] });
		await drafts.flush();
		IDBObjectStore.prototype.put = original;
	});
	await page.locator(".draft-notice").waitFor();
	await page.clock.fastForward(5000);
	assert.match(await page.locator(".draft-notice").textContent(), /未能持久化/);
	await page.goto(`${process.argv[2] || "http://localhost:1421"}/tests/draft-recovery.html?load-failure=1`);
	await page.locator(".draft-notice").waitFor();
	await page.clock.fastForward(5000);
	assert.match(await page.locator(".draft-notice").textContent(), /无法读取/);
	assert.equal(await notice.count(), 0);
	assert.deepEqual(errors, []);
	console.log("PASS: StrictMode recovery, actual content, 4s timeout, focus/edit/send, save updates, empty/missing/incompatible, target switches, unmount, stale markers and persistent errors");
} finally { await browser.close(); }
