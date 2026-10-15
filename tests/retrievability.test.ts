import test from "node:test";
import assert from "node:assert/strict";
import { calendarGroup, conversationLabel, deriveTitle } from "../src/chat/conversationDisplay.ts";
import { backgroundSessions, conversationStatus } from "../src/chat/sessionStatus.ts";
import { bodyMatches, HistorySearch, locateMessage, mergeHistory, type HistoryProjection } from "../src/chat/historySearch.ts";
import { draftLimits, prepareDraft, persistedAttachmentBytes, type DraftRecord } from "../src/chat/drafts.ts";
import { persistableConversations, type Conversation } from "../src/chat/workspace.ts";

const chat = (id: string): Conversation => ({ id, projectId: "p", title: "你好", hasMessages: true, updatedAt: 0, sessionFile: `${id}.jsonl` });
test("titles normalize prose, count Unicode, preserve manual names and disambiguate stably", () => {
	assert.equal(deriveTitle([{ id: "u", role: "user", blocks: [{ kind: "text", text: "  你好\n\t世界  " }] }]), "你好 世界");
	assert.equal(Array.from(deriveTitle([{ id: "u", role: "user", blocks: [{ kind: "text", text: "😀".repeat(40) }] }])).length, 32);
	assert.equal(deriveTitle([{ id: "u", role: "user", blocks: [{ kind: "image", data: "", mimeType: "image/png" }] }]), "图片聊天");
	const peers = [chat("first-111111"), chat("second-222222")];
	assert.match(conversationLabel(peers[0], peers), /111111$/);
	assert.equal(conversationLabel(peers[0], peers), conversationLabel({ ...peers[0], updatedAt: 9999 }, [...peers].reverse()));
	assert.equal(conversationLabel({ ...peers[0], customTitle: true, modelAlias: "别名" }, peers), "你好");
	assert.equal(conversationLabel({ ...chat("solo"), modelAlias: "短别名", selectedModel: { provider: "p", id: "must-not-display" } }, []), "你好 · 短别名");
});
test("calendar buckets use local days at month/year boundaries and both DST transitions", () => {
	const original = process.env.TZ; process.env.TZ = "America/New_York";
	try {
		for (const [today, yesterday] of [["2026-03-09T00:05:00", "2026-03-08T00:01:00"], ["2026-11-02T00:05:00", "2026-11-01T00:01:00"], ["2026-01-01T00:01:00", "2025-12-31T23:59:00"]]) assert.equal(calendarGroup(+new Date(yesterday), +new Date(today)), "昨天");
		assert.match(calendarGroup(+new Date("2025-12-30T12:00:00"), +new Date("2026-01-01T12:00:00")), /12\/30/);
		assert.equal(calendarGroup(+new Date("2025-11-30T12:00:00"), +new Date("2026-01-01T12:00:00")), "2025年11月");
	} finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
test("status priority and background counts exclude the current chat", () => {
	assert.equal(conversationStatus({ needsConfirmation: true, error: "failed", running: true }), "needsConfirmation");
	assert.equal(conversationStatus({ error: "failed", running: true }), "failed");
	assert.deepEqual(backgroundSessions(new Map([["active", "running"], ["r", "running"], ["f", "failed"], ["c", "needsConfirmation"], ["i", "idle"]]), "active").map(([id]) => id), ["c", "f", "r"]);
});
test("message identities distinguish repeated text and reject ambiguous compacted duplicates", () => {
	const messages = [{ role: "user" as const, text: "same", timestamp: 1000 }, { role: "user" as const, text: "same", timestamp: 1000 }];
	const hits = bodyMatches(chat("a"), { version: "v", messages }, "same");
	assert.equal(locateMessage(messages, hits[1].location), 1);
	assert.equal(locateMessage(messages.slice(1), hits[1].location), undefined);
	const stable = messages.map((message, index) => ({ ...message, entryId: `e${index}` }));
	assert.equal(locateMessage(stable.slice(1), bodyMatches(chat("a"), { version: "v", messages: stable }, "same")[1].location), 0);
	assert.equal(mergeHistory(messages, messages).length, 2);
	assert.equal(mergeHistory(messages.slice(0, 1), messages).length, 2);
});
test("history scans past the LRU boundary, reports failures and never exceeds two reads", async () => {
	let active = 0, peak = 0;
	const engine = new HistorySearch(async (target) => {
		active++; peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 1)); active--;
		if (target.id === "bad") throw new Error("unreadable");
		return { version: "v", messages: [{ role: "assistant", text: `needle ${target.id}` }] };
	});
	const chats = Array.from({ length: 61 }, (_, i) => chat(String(i))); chats.push(chat("bad"));
	let final;
	await engine.search(chats, "needle", new Map(), (result) => { final = result; });
	assert.equal(peak, 2); assert.equal(engine.cacheSize, 50);
	assert.equal(final!.matches.length, 61); assert.deepEqual(final!.failures, ["bad"]); assert.equal(final!.loading, false);
});
test("cancelled queries cannot publish and late reads cannot resurrect removed cache entries", async () => {
	const pending: Array<(value: HistoryProjection) => void> = [];
	const engine = new HistorySearch(() => new Promise((resolve) => pending.push(resolve)));
	const target = chat("a"); engine.prune([target]);
	let published = 0;
	const searching = engine.search([target], "old", new Map(), () => { published++; });
	engine.prune([]);
	pending[0]({ version: "old", messages: [{ role: "user", text: "old" }] });
	await searching;
	assert.equal(published, 1); assert.equal(engine.cacheSize, 0);
});
test("oversized history remains searchable without occupying the bounded cache", async () => {
	const engine = new HistorySearch(async () => ({ version: "v", messages: [{ role: "user", text: "x".repeat(10000) + "needle" }] }), 50, 100);
	let result;
	await engine.search([chat("large")], "needle", new Map(), (value) => { result = value; });
	assert.equal(engine.cacheSize, 0); assert.equal(result!.matches.length, 1);
	assert.ok(result!.matches[0].snippet.length < 150); assert.ok(result!.matches[0].location.fingerprint.length < 64);
});
test("an older overlapping read cannot replace a freshly validated version", async () => {
	const pending: Array<(value: HistoryProjection) => void> = [];
	const known: Array<string | undefined> = [];
	const engine = new HistorySearch((_chat, version) => { known.push(version); return new Promise((resolve) => pending.push(resolve)); });
	const first = engine.history(chat("a")), second = engine.history(chat("a"), true);
	pending[1]({ version: "new", messages: [] }); await second;
	pending[0]({ version: "old", messages: [] }); await first;
	const third = engine.history(chat("a")); assert.equal(known[2], "new");
	pending[2]({ version: "new", messages: [], unchanged: true }); assert.equal((await third).version, "new");
});
test("draft capacity counts serialized UTF8 bytes and retains overflow metadata without truncating text", () => {
	const record: DraftRecord = { chatId: "a", cwd: "p", revision: 1, text: "keep text", attachments: [{ id: "f", kind: "text", name: "large.txt", body: "汉".repeat(400000), bytes: 1200002 }] };
	const prepared = prepareDraft(record);
	assert.equal(prepared.text, record.text); assert.equal(prepared.attachments[0].body, undefined); assert.equal(prepared.attachments[0].needsReattach, true);
	const small = { ...record, attachments: [{ ...record.attachments[0], body: "汉" }] };
	assert.equal(persistedAttachmentBytes(small), 5);
	assert.equal(prepareDraft(small, draftLimits.total - 4).attachments[0].needsReattach, true);
	assert.equal(prepareDraft(small, 0, true).attachments[0].body, undefined);
	assert.equal(persistableConversations([{ ...chat("draft"), hasMessages: false, hasDraft: true }], "other").length, 1);
});
