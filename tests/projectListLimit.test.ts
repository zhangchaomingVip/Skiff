import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PROJECTS, addWorkspaceProject, hideProject, projectPathKey, visibleProjects, type Workspace } from "../src/chat/workspace";

const workspace = (): Workspace => ({ version: 1, projects: Array.from({ length: MAX_PROJECTS }, (_, index) => ({ id: String(index), name: `Project ${index}`, path: `D:\\project-${index}` })), chats: [{ id: "chat", projectId: "0", title: "Keep", updatedAt: 1, hasMessages: true, sessionFile: "keep.jsonl", hasDraft: true }], activeId: "chat" });
const incoming = { id: "new", name: "New", path: "D:\\new" };
const draft = (projectId: string) => ({ id: "draft", projectId, title: "New chat", updatedAt: 2, hasMessages: false });
const overLimit = new RegExp(`最多保留 ${MAX_PROJECTS}`);

test("a project beyond the limit requires a deliberate replacement and retains chats and drafts", () => {
	const before = workspace();
	assert.throws(() => addWorkspaceProject(before, incoming, [], draft), overLimit);
	const next = addWorkspaceProject(before, incoming, ["0"], draft);
	assert.equal(visibleProjects(next.projects).length, MAX_PROJECTS);
	assert.equal(next.projects.find((project) => project.id === "0")?.hiddenAt !== undefined, true);
	assert.deepEqual(next.chats[0], before.chats[0]);
	assert.equal(next.activeId, "draft");
	assert.equal(before.projects[0].hiddenAt, undefined);
});

test("re-adding a removed folder restores its existing identity and chat without exceeding the limit", () => {
	const hidden = addWorkspaceProject(workspace(), incoming, ["0"], draft);
	const restored = addWorkspaceProject(hidden, { id: "duplicate", name: "Different", path: "d:/PROJECT-0/" }, ["new"], draft);
	assert.equal(visibleProjects(restored.projects).length, MAX_PROJECTS);
	assert.equal(restored.projects.some((project) => project.id === "duplicate"), false);
	assert.equal(restored.activeId, "chat");
	assert.equal(restored.chats[0].sessionFile, "keep.jsonl");
	assert.equal(restored.chats[0].hasDraft, true);
	assert.equal(projectPathKey("D:/project/"), projectPathKey("d:\\PROJECT"));
});

test("legacy lists above the limit require enough removals and preserve their catalogue", () => {
	const before = workspace();
	before.projects.push({ id: "extra", name: "Extra", path: "D:\\extra" });
	assert.throws(() => addWorkspaceProject(before, incoming, ["0"], draft), overLimit);
	const next = hideProject(before, "0", 10, draft);
	assert.equal(visibleProjects(next.projects).length, MAX_PROJECTS);
	assert.deepEqual(next.chats[0], before.chats[0]);
});
