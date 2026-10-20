import assert from "node:assert/strict";
import test from "node:test";
import { reduce } from "../src/chat/reducer.ts";
import { initialSessionState } from "../src/chat/types.ts";
import { DialogRuntime, extensionDialog, queueSize } from "../src/chat/interactions.ts";
import { prepareDraft, persistedAttachmentBytes, type DraftRecord } from "../src/chat/drafts.ts";

test("routine completion notifications stay quiet while extension warnings and errors remain visible", () => {
	let state = initialSessionState;
	for (const message of ["Agent finished its current task.", " Agent finished its current task. "]) {
		state = reduce(state, { type: "extension_ui_request", method: "notify", notifyType: "info", message });
	}
	assert.equal(state.notices.length, 0);
	for (const [notifyType, message] of [["warning", "Agent finished its current task."], ["error", "工具执行失败"], ["info", "已开启联网搜索"]]) {
		state = reduce(state, { type: "extension_ui_request", method: "notify", notifyType, message });
	}
	assert.deepEqual(state.notices.map(({ kind }) => kind), ["warning", "error", "info"]);
});

test("queue updates replace both snapshots, including an empty snapshot", () => {
	let state = reduce(initialSessionState, { type: "queue_update", steering: ["a"], followUp: ["b"] });
	state = reduce(state, { type: "queue_update", steering: ["c"], followUp: [] });
	assert.deepEqual(state.queue, { steering: ["c"], followUp: [] });
	state = reduce(state, { type: "queue_update", steering: [], followUp: [] });
	assert.equal(queueSize(state.queue), 0);
});

test("agent_end keeps the run and dialogs alive until agent_settled", () => {
	let state = reduce(initialSessionState, { type: "agent_start", startedAt: 1000, voyageAt: 1000 });
	state = reduce(state, { type: "extension_ui_request", id: "pi-id", method: "confirm", title: "Question", voyageAt: 1100 });
	const run = state.activeRun;
	state = reduce(state, { type: "agent_end", voyageAt: 1200 });
	assert.equal(state.isStreaming, true); assert.equal(state.activeRun, run);
	assert.equal(state.voyageTimeline?.endedAt, undefined); assert.equal(state.dialogs?.length, 1);
	state = reduce(state, { type: "agent_settled", voyageAt: 1500 });
	assert.equal(state.isStreaming, false); assert.equal(state.dialogs?.length, 1);
	assert.equal(state.voyageTimeline?.endedAt, 1500);
});

test("length result survives intermediate lifecycle events and settles as truncated", () => {
	let state = reduce(initialSessionState, { type: "agent_start", startedAt: 1000, voyageAt: 1000 });
	state = reduce(state, { type: "message_start", message: { role: "user", content: "task" } });
	state = reduce(state, { type: "message_start", message: { role: "assistant" } });
	state = reduce(state, { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "length" }, voyageAt: 2000 });
	assert.equal(state.voyageTimeline?.endedAt, undefined);
	state = reduce(state, { type: "agent_end", voyageAt: 2100 });
	state = reduce(state, { type: "agent_settled", voyageAt: 2200 });
	assert.equal(state.lastOutcome?.reason, "length"); assert.equal(state.voyageTimeline?.outcome, "truncated");
});

test("manual stop without an assistant retains a receipt on its user turn", () => {
	let state = reduce(initialSessionState, { type: "agent_start", startedAt: 1000 });
	state = reduce(state, { type: "message_start", message: { role: "user", content: "task" } });
	const turnId = state.activeRun?.turnId;
	state = reduce(state, { type: "agent_settled" });
	state = reduce(state, { type: "stop_finished", success: true, turnId });
	assert.equal(state.lastOutcome?.reason, "manual"); assert.equal(state.messages[0].turnResult, "manual");
	assert.equal(reduce(state, { type: "stop_finished", success: false }).messages[0].turnResult, "manual");
});

test("dialogs are FIFO and repeated ids do not create another pending request", () => {
	let state = initialSessionState;
	for (const id of ["one", "two", "one"]) state = reduce(state, { type: "extension_ui_request", id, method: "input", placeholder: "type", voyageAt: 1000, timeout: 500 });
	assert.deepEqual(state.dialogs?.map((dialog) => dialog.id), ["one", "two"]);
	assert.equal(state.dialogs?.[0].expiresAt, 1500);
	state = reduce(state, { type: "dialog_replied", id: "one" });
	assert.deepEqual(state.dialogs?.map((dialog) => dialog.id), ["two"]);
	state = reduce(state, { type: "dialog_expired", id: "two" });
	assert.equal(state.dialogs?.length, 0); assert.match(state.notices.at(-1)!.text, /等待已超时/);
});

test("dialog parser retains editor prefill and ignores fire-and-forget methods", () => {
	assert.equal(extensionDialog({ type: "extension_ui_request", method: "editor", id: "x", prefill: "a\nb" }, 0)?.prefill, "a\nb");
	for (const method of ["setStatus", "setWidget", "setTitle", "notify"]) assert.equal(extensionDialog({ type: "extension_ui_request", method, id: "x" }, 0), undefined);
});

test("runtime sends pi's exact id once while the write is in flight", async () => {
	let release!: () => void; const sent: unknown[] = [], events: unknown[] = [];
	const runtime = new DialogRuntime(async (event) => { sent.push(event); await new Promise<void>((resolve) => { release = resolve; }); }, (event) => events.push(event));
	runtime.add({ type: "extension_ui_request", id: "pi-original-id", method: "confirm" });
	const first = runtime.reply("pi-original-id", { confirmed: true });
	assert.equal(await runtime.reply("pi-original-id", { confirmed: false }), false);
	release(); assert.equal(await first, true);
	assert.equal(runtime.add({ type: "extension_ui_request", id: "pi-original-id", method: "confirm" }), false);
	assert.equal(await runtime.reply("pi-original-id", { confirmed: true }), false);
	assert.deepEqual(sent, [{ type: "extension_ui_response", id: "pi-original-id", confirmed: true }]);
	assert.equal(events.length, 2); runtime.dispose();
});

test("uncertain writes are never retried, including during stop cleanup", async () => {
	let writes = 0; const events: Array<{ type?: string }> = [];
	const runtime = new DialogRuntime(async () => { writes++; throw new Error("unknown write outcome"); }, (event) => events.push(event));
	runtime.add({ type: "extension_ui_request", id: "pi-id", method: "input" });
	assert.equal(await runtime.reply("pi-id", { value: "answer" }), false);
	await runtime.cancelAll(); assert.equal(writes, 1);
	assert.equal(events.at(-1)?.type, "dialog_uncertain"); runtime.dispose();
});

test("queued/background deadlines expire without sending a cancellation", async () => {
	const sent: unknown[] = [], expired: unknown[] = [];
	const runtime = new DialogRuntime(async (event) => { sent.push(event); }, (event) => expired.push(event));
	runtime.add({ type: "extension_ui_request", id: "first-no-timeout", method: "input" });
	runtime.add({ type: "extension_ui_request", id: "queued", method: "confirm", timeout: 15 });
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.ok(expired.some((event: any) => event.type === "dialog_expired" && event.id === "queued"));
	assert.equal(await runtime.reply("queued", { confirmed: true }), false); assert.equal(sent.length, 0);
	await runtime.cancelAll(); assert.deepEqual(sent, [{ type: "extension_ui_response", id: "first-no-timeout", cancelled: true }]); runtime.dispose();
});

test("generation disposal prevents old dialog ids from being sent", async () => {
	let writes = 0; const runtime = new DialogRuntime(async () => { writes++; }, () => {});
	runtime.add({ type: "extension_ui_request", id: "old", method: "editor", timeout: 10 }); runtime.dispose();
	assert.equal(await runtime.reply("old", { value: "late" }), false); await runtime.cancelAll(); assert.equal(writes, 0);
});

test("edit previous draft attachments share the same persistence capacity and quota fallback", () => {
	const image = { id: "image", name: "image", kind: "image" as const, body: "x".repeat(700000), bytes: 700000 };
	const draft: DraftRecord = { chatId: "c", cwd: "d", revision: 1, text: "edit", attachments: [image], edit: { target: { chatId: "c", version: "v", fingerprint: "f", query: "", occurrence: 0, occurrences: 1 }, branchVersion: "v", previous: { text: "normal", attachments: [image] } } };
	const prepared = prepareDraft(draft, 20 * 1024 * 1024 - 1000000);
	assert.ok(prepared.attachments[0].body); assert.equal(prepared.edit?.previous.attachments[0].body, undefined);
	assert.ok(persistedAttachmentBytes(prepared) < 1000000);
	const fallback = prepareDraft(draft, 0, true);
	assert.equal(fallback.attachments[0].body, undefined); assert.equal(fallback.edit?.previous.attachments[0].body, undefined);
	assert.equal(fallback.edit?.previous.text, "normal");
});
