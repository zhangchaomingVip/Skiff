import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRouteEvents } from "../src/chat/routeAudit.ts";
import { archiveConversation, deleteConversation, isArchived, normalizeRouteSnapshots, normalizeSelectedModel, normalizeWorkspace, persistableConversations, restoreConversation, visibleConversations, type Conversation, type Workspace } from "../src/chat/workspace.ts";

test("selected model keeps legacy provider/id and optional pinned offer identity", () => {
	assert.deepEqual(normalizeSelectedModel({ provider: "skiff-relay-r1-kimi", id: "kimi-k3" }), { provider: "skiff-relay-r1-kimi", id: "kimi-k3" });
	assert.deepEqual(normalizeSelectedModel({ provider: "skiff-relay-r1-kimi", id: "kimi-k3", routeId: "route-kimi-r1", modelId: "kimi-k3", offerId: "route-kimi-r1/kimi-k3", ignored: 1 }), {
		provider: "skiff-relay-r1-kimi", id: "kimi-k3", routeId: "route-kimi-r1", modelId: "kimi-k3", offerId: "route-kimi-r1/kimi-k3",
	});
	assert.equal(normalizeSelectedModel({ provider: "skiff-relay-r1-kimi" }), undefined);
});

test("route snapshot metadata is normalized and strips unknown or malformed fields", () => {
	assert.deepEqual(normalizeRouteSnapshots([{
		offerId: "route/deepseek-chat", providerKey: "provider", familyId: "deepseek", familyName: "DeepSeek", modelId: "deepseek-chat",
		relayId: "r1", relayName: "官方", billingAccountId: "wallet-a", currency: "CNY", inputCost: 1, outputCost: 4,
		apiKey: "must-drop",
	}, null, { providerKey: "broken" }]), [{
		offerId: "route/deepseek-chat", providerKey: "provider", familyId: "deepseek", familyName: "DeepSeek", modelId: "deepseek-chat",
		relayId: "r1", relayName: "官方", billingAccountId: "wallet-a", currency: "CNY", inputCost: 1, outputCost: 4,
	}, null, null]);
	assert.equal(normalizeRouteSnapshots("bad"), undefined);
});

test("route event metadata is normalized without accepting request contents", () => {
	const events = normalizeRouteEvents([{ timestamp: 1, sessionId: "chat", requestId: "req", source: { modelId: "m", relayName: "a", apiKey: "secret" }, target: { modelId: "m", relayName: "b" }, crossAccount: true, authorization: "once", automatic: true, retried: false, result: "switched", body: "secret" }]);
	assert.deepEqual(events?.[0], { timestamp: 1, sessionId: "chat", requestId: "req", source: { modelId: "m", relayName: "a" }, target: { modelId: "m", relayName: "b" }, crossAccount: true, authorization: "once", automatic: true, retried: false, result: "switched" });
});

test("workspace v1 without archive metadata remains an unarchived legacy workspace", () => {
	const workspace = normalizeWorkspace({
		version: 1,
		projects: [{ id: "p", name: "Project", path: "C:/project" }],
		chats: [{ id: "c", projectId: "p", title: "Old chat", updatedAt: 1, hasMessages: true, sessionFile: "chat.jsonl" }],
		activeId: "c",
	});
	assert.equal(workspace?.version, 1);
	assert.equal(workspace?.chats[0].archivedAt, undefined);
	assert.deepEqual(visibleConversations(workspace?.chats ?? []).map((chat) => chat.id), ["c"]);
});

test("archive, restore, active fallback and empty archived persistence retain session metadata", () => {
	const chat = (id: string, updatedAt: number, extras: Partial<Conversation> = {}): Conversation => ({ id, projectId: "p", title: id, updatedAt, hasMessages: true, ...extras });
	const workspace: Workspace = {
		version: 1,
		projects: [{ id: "p", name: "Project", path: "C:/project" }],
		chats: [chat("active", 30, { sessionFile: "active.jsonl" }), chat("candidate", 20), chat("already-archived", 40, { archivedAt: 10 })],
		activeId: "active",
	};
	const archived = archiveConversation(workspace, "active", 100);
	assert.equal(archived.activeId, "candidate");
	assert.equal(archived.chats.find((item) => item.id === "active")?.archivedAt, 100);
	assert.deepEqual(visibleConversations(archived.chats).map((item) => item.id), ["candidate"]);
	const restored = restoreConversation(archived, "active");
	assert.equal(restored.activeId, "active");
	assert.equal(restored.chats.find((item) => item.id === "active")?.archivedAt, undefined);
	assert.equal(restored.chats.find((item) => item.id === "active")?.sessionFile, "active.jsonl");

	const blank: Conversation = { id: "blank", projectId: "p", title: "空白", updatedAt: 50, hasMessages: false };
	const onlyBlank = { ...workspace, chats: [blank], activeId: blank.id };
	const withDraft = archiveConversation(onlyBlank, blank.id, 200, (projectId) => ({ id: "replacement", projectId, title: "新聊天", updatedAt: 201, hasMessages: false }));
	assert.equal(withDraft.activeId, "replacement");
	assert.deepEqual(persistableConversations(withDraft.chats, withDraft.activeId).map((item) => item.id).sort(), ["blank", "replacement"]);
	assert.equal(isArchived(withDraft.chats.find((item) => item.id === "blank")!), true);
});

test("deleting an archived chat removes only its workspace index entry", () => {
	const archived: Conversation = { id: "archived", projectId: "p", title: "Archived", updatedAt: 1, hasMessages: true, sessionFile: "kept.jsonl", archivedAt: 2 };
	const workspace: Workspace = { version: 1, projects: [{ id: "p", name: "Project", path: "C:/project" }], chats: [archived], activeId: "active" };
	const next = deleteConversation(workspace, archived.id);
	assert.equal(next.chats.some((chat) => chat.id === archived.id), false);
	assert.equal(archived.sessionFile, "kept.jsonl");
});

test("malformed optional archive metadata is ignored", () => {
	const normalized = normalizeWorkspace({
		version: 1,
		projects: [{ id: "p", name: "Project", path: "C:/project" }],
		chats: [{ id: "c", projectId: "p", title: "Chat", updatedAt: 1, hasMessages: false, archivedAt: "later" }],
		activeId: "c",
	});
	assert.equal(normalized?.chats[0].archivedAt, undefined);
});
