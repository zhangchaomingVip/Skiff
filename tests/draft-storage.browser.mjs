import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "../.playwright-cli/node_modules/playwright-core");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] ?? "http://localhost:1421";

async function scenario(name, run, check) {
	const context = await browser.newContext();
	try {
		const page = await context.newPage(), errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/draft-storage.html`);
		await page.waitForFunction(() => !!window.storageFixture);
		check(await page.evaluate(run));
		assert.deepEqual(errors, []);
		console.log(`PASS ${name}`);
	} finally { await context.close(); }
}

try {
	await scenario("v1 migration preserves current/previous/missing attachments and uses atomic references", async () => {
		const { seedV1, DraftStore, inspect } = window.storageFixture;
		const attachment = { id: "image", name: "image.png", kind: "image", body: btoa("a".repeat(1024 * 1024)), bytes: 1 };
		await seedV1([{ chatId: "legacy", cwd: "p", revision: 7, text: "unsent", attachments: [attachment, { id: "missing", name: "missing.txt", kind: "text", bytes: 10, needsReattach: true }], edit: { target: { chatId: "legacy", version: "v", fingerprint: "f", occurrence: 0, occurrences: 1 }, branchVersion: "v", previous: { text: "original", attachments: [attachment] } } }]);
		const store = new DraftStore(); await store.hydrate(["legacy"]);
		const raw = await inspect();
		const reopened = new DraftStore(); await reopened.hydrate(["legacy"]);
		const recovered = reopened.get("legacy");
		return { version: raw.drafts[0].storageVersion, inline: raw.drafts[0].attachments[0].body, assets: raw.attachments.length, blobSize: raw.attachments[0].blob.size, charged: raw.sizes[0].bytes, restored: recovered.attachments[0].body === attachment.body, previous: recovered.edit.previous.attachments[0].body === attachment.body, missing: recovered.attachments[1].needsReattach, text: recovered.text, original: recovered.edit.previous.text, revision: recovered.revision };
	}, (value) => assert.deepEqual(value, { version: 2, inline: undefined, assets: 1, blobSize: 1024 * 1024, charged: 1024 * 1024, restored: true, previous: true, missing: true, text: "unsent", original: "original", revision: 7 }));

	await scenario("edit backup retains shared blobs until the final reference is cleared", async () => {
		const { DraftStore, inspect } = window.storageFixture;
		const store = new DraftStore(); await store.hydrate(["shared"]);
		const attachment = { id: "shared", name: "shared.txt", kind: "text", body: "keep", bytes: 4 };
		store.save({ chatId: "shared", cwd: "p", text: "edit", attachments: [attachment], edit: { target: { chatId: "shared", version: "v", fingerprint: "f", occurrence: 0, occurrences: 1 }, branchVersion: "v", previous: { text: "original", attachments: [attachment] } } }); await store.flush();
		const initial = await inspect();
		store.save({ ...store.get("shared"), attachments: [] }); await store.flush();
		const retained = await inspect();
		const reopened = new DraftStore(); await reopened.hydrate(["shared"]);
		const body = reopened.get("shared").edit.previous.attachments[0].body;
		store.save({ chatId: "shared", cwd: "p", text: "", attachments: [] }); await store.flush();
		const cleared = await inspect();
		return { shared: initial.drafts[0].attachments[0].contentId === initial.drafts[0].edit.previous.attachments[0].contentId, retained: retained.attachments.length, bytes: retained.sizes[0].bytes, body, cleared: [cleared.drafts.length, cleared.attachments.length, cleared.sizes.length] };
	}, (value) => assert.deepEqual(value, { shared: true, retained: 1, bytes: 4, body: "keep", cleared: [0, 0, 0] }));

	await scenario("failed migration keeps the v1 body for the next launch", async () => {
		const { seedV1, DraftStore, inspect } = window.storageFixture;
		await seedV1([{ chatId: "legacy", cwd: "p", revision: 1, text: "keep", attachments: [{ id: "file", name: "f", kind: "text", body: "last good copy", bytes: 14 }] }]);
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === "attachments") throw new DOMException("full", "QuotaExceededError"); return original.call(this, value, ...args); };
		const store = new DraftStore(); await store.hydrate(["legacy"]);
		store.save({ ...store.get("legacy"), text: "edited while migration is blocked" }); await store.flush();
		IDBObjectStore.prototype.put = original;
		const raw = await inspect();
		const next = new DraftStore(); await next.hydrate(["legacy"]);
		return { status: store.status("legacy"), retained: raw.drafts[0].attachments[0].body, recovered: next.get("legacy").attachments[0].body, migrated: (await inspect()).drafts[0].storageVersion };
	}, (value) => assert.deepEqual(value, { status: "error", retained: "last good copy", recovered: "last good copy", migrated: 2 }));

	await scenario("new attachments cannot evict saved content when the app budget is full", async () => {
		const { DraftStore, draftLimits, inspect } = window.storageFixture;
		const store = new DraftStore({ ...draftLimits, total: 1024 }); await store.hydrate(["priority"]);
		const old = { id: "old", name: "old", kind: "text", body: "x".repeat(600), bytes: 600 };
		store.save({ chatId: "priority", cwd: "p", text: "", attachments: [old] }); await store.flush();
		store.save({ ...store.get("priority"), attachments: [{ ...old, id: "new", name: "new" }, old] }); await store.flush();
		const raw = await inspect();
		return { status: store.status("priority"), names: store.problem("priority").names, newMissing: raw.drafts[0].attachments[0].needsReattach, oldSaved: !!raw.drafts[0].attachments[1].contentId, bytes: raw.sizes[0].bytes, blobs: raw.attachments.length };
	}, (value) => assert.deepEqual(value, { status: "limited", names: ["new"], newMissing: true, oldSaved: true, bytes: 600, blobs: 1 }));

	await scenario("maximum allowed attachments restore and typing does not read or rewrite blobs", async () => {
		const { DraftStore, inspect } = window.storageFixture;
		const store = new DraftStore(); await store.hydrate(["large"]);
		const image = btoa("a".repeat(5 * 1024 * 1024)), text = "\u001f".repeat(512 * 1024);
		const attachments = [...Array.from({ length: 4 }, (_, i) => ({ id: `i${i}`, name: `${i}.png`, kind: "image", body: image, bytes: 0 })), ...Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, name: `${i}.txt`, kind: "text", body: text, bytes: 0 }))];
		store.save({ chatId: "large", cwd: "p", text: "first", attachments }); await store.flush();
		const originalPut = IDBObjectStore.prototype.put, originalGetAll = IDBObjectStore.prototype.getAll, originalGet = IDBObjectStore.prototype.get;
		let blobWrites = 0, contentReads = 0;
		IDBObjectStore.prototype.put = function(...args) { if (this.name === "attachments") blobWrites++; return originalPut.apply(this, args); };
		IDBObjectStore.prototype.getAll = function(...args) { if (this.name !== "sizes") contentReads++; return originalGetAll.apply(this, args); };
		IDBObjectStore.prototype.get = function(...args) { if (this.name === "attachments") contentReads++; return originalGet.apply(this, args); };
		for (let i = 0; i < 5; i++) { store.save({ ...store.get("large"), text: `edit ${i}` }); await store.flush(); }
		IDBObjectStore.prototype.put = originalPut; IDBObjectStore.prototype.getAll = originalGetAll; IDBObjectStore.prototype.get = originalGet;
		const raw = await inspect();
		const next = new DraftStore(); await next.hydrate(["large"]);
		return { status: store.status("large"), blobWrites, contentReads, count: raw.attachments.length, bytes: raw.sizes[0].bytes, restored: next.get("large").attachments.every((item) => item.body === (item.kind === "image" ? image : text)), text: next.get("large").text };
	}, (value) => assert.deepEqual(value, { status: "saved", blobWrites: 0, contentReads: 0, count: 8, bytes: 22 * 1024 * 1024, restored: true, text: "edit 4" }));

	await scenario("quota fallback retains saved content and retry persists the new attachment", async () => {
		const { DraftStore, inspect } = window.storageFixture;
		const store = new DraftStore(); await store.hydrate(["quota"]);
		const old = { id: "old", name: "old.txt", kind: "text", body: "saved", bytes: 5 };
		store.save({ chatId: "quota", cwd: "p", text: "before", attachments: [old] }); await store.flush();
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === "attachments") throw new DOMException("full", "QuotaExceededError"); return original.call(this, value, ...args); };
		store.save({ ...store.get("quota"), text: "after", attachments: [old, { id: "new", name: "new.txt", kind: "text", body: "new content", bytes: 11 }] }); await store.flush();
		IDBObjectStore.prototype.put = original;
		const fallback = await inspect();
		const result = { status: store.status("quota"), reason: store.problem("quota").reason, names: store.problem("quota").names, oldSaved: !!fallback.drafts[0].attachments[0].contentId, newMissing: fallback.drafts[0].attachments[1].needsReattach, text: fallback.drafts[0].text, memory: store.get("quota").attachments[1].body };
		await store.retry("quota");
		return { ...result, retry: store.status("quota"), count: (await inspect()).attachments.length };
	}, (value) => assert.deepEqual(value, { status: "limited", reason: "quota", names: ["new.txt"], oldSaved: true, newMissing: true, text: "after", memory: "new content", retry: "saved", count: 2 }));

	await scenario("unknown errors preserve the last committed draft and do not claim quota exhaustion", async () => {
		const { DraftStore, inspect } = window.storageFixture;
		const store = new DraftStore(); await store.hydrate(["error"]);
		store.save({ chatId: "error", cwd: "p", text: "committed", attachments: [{ id: "old", name: "old", kind: "text", body: "old", bytes: 3 }] }); await store.flush();
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === "drafts") throw new DOMException("device error", "UnknownError"); return original.call(this, value, ...args); };
		store.save({ ...store.get("error"), text: "new", attachments: [{ id: "new", name: "new", kind: "text", body: "new", bytes: 3 }] }); await store.flush();
		IDBObjectStore.prototype.put = original;
		const raw = await inspect();
		const result = { status: store.status("error"), problem: store.problem("error"), text: raw.drafts[0].text, oldId: raw.drafts[0].attachments[0].id, blobs: raw.attachments.length, memory: store.get("error").text };
		IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === "attachments") throw new DOMException("full", "QuotaExceededError"); return original.call(this, value, ...args); };
		store.save({ ...store.get("error"), attachments: [{ id: "old", name: "old", kind: "text", body: "old", bytes: 3 }] }); await store.flush();
		IDBObjectStore.prototype.put = original;
		return { ...result, reusedAfterFailure: store.status("error"), sameReference: (await inspect()).drafts[0].attachments[0].contentId === raw.drafts[0].attachments[0].contentId };
	}, (value) => assert.deepEqual(value, { status: "error", problem: undefined, text: "committed", oldId: "old", blobs: 1, memory: "new", reusedAfterFailure: "saved", sameReference: true }));

	await scenario("concurrent owners and exit writes respect shared budget; cleanup and retry reclaim space", async () => {
		const { DraftStore, draftLimits, inspect } = window.storageFixture;
		const limits = { ...draftLimits, total: 1024 };
		const a = new DraftStore(limits), b = new DraftStore(limits);
		await a.hydrate(["a", "b", "deleted"]); await b.hydrate(["a", "b", "deleted"]);
		for (const [store, id] of [[a, "a"], [b, "b"]]) store.save({ chatId: id, cwd: "p", text: id, attachments: [{ id, name: id, kind: "text", body: "x".repeat(600), bytes: 600 }] });
		a.flushOnExit(); b.flushOnExit(); await Promise.all([a.flush(), b.flush()]);
		const charged = (await inspect()).sizes.reduce((sum, item) => sum + item.bytes, 0);
		const saved = a.status("a") === "saved" ? a : b, limited = saved === a ? b : a;
		const savedId = saved === a ? "a" : "b", limitedId = limited === a ? "a" : "b";
		const reason = limited.problem(limitedId).reason;
		saved.remove(savedId); await saved.flush(); await limited.retry(limitedId);
		limited.save({ chatId: "deleted", cwd: "p", text: "late", attachments: [] }); const writing = limited.flush(); limited.remove("deleted"); limited.save({ chatId: "deleted", cwd: "p", text: "resurrect", attachments: [] }); await writing; await limited.flush();
		const raw = await inspect();
		return { charged, reason, retry: limited.status(limitedId), blobs: raw.attachments.length, records: raw.drafts.map((item) => item.chatId), expectedId: limitedId, deleted: limited.get("deleted") };
	}, ({ records, expectedId, ...value }) => { assert.deepEqual(records, [expectedId]); assert.deepEqual(value, { charged: 600, reason: "budget", retry: "saved", blobs: 1, deleted: undefined }); });
} finally { await browser.close(); }
