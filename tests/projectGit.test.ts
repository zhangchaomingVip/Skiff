import assert from "node:assert/strict";
import test from "node:test";
import { GIT_REFRESH_MS, GitStatusCache } from "../src/workbench/gitStatusCache";
import { ProjectGitActivity } from "../src/workbench/projectGitActivity";
import type { GitStatus } from "../src/workbench/projectWorkbench";
import type { ChatMessage } from "../src/chat/types";

const status = (root: string, version = "1"): GitStatus => ({ repositoryRoot: root, scope: "", branch: "main", version, entries: [] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

test("background status caches all projects, coalesces reads and uses a five-minute interval", async () => {
	assert.equal(GIT_REFRESH_MS, 300_000);
	const calls: string[] = [];
	const pending = deferred<GitStatus>();
	const cache = new GitStatusCache(async (root) => { calls.push(root); return root === "a" ? pending.promise : status(root); });
	cache.setProjects(["a", "b", "c", "d", "e"]);
	const first = cache.refreshAll();
	const second = cache.refresh("a");
	pending.resolve(status("a"));
	await Promise.all([first, second]);
	assert.deepEqual(calls, ["a", "b", "c", "d", "e"]);
	assert.equal(cache.get("b").status?.repositoryRoot, "b");
});

test("non-repositories are local projects; real errors remain errors and can recover", async () => {
	let mode = "local";
	const cache = new GitStatusCache(async (root) => {
		if (mode === "local") throw new Error("无法识别 Git 仓库：fatal: not a git repository (or any of the parent directories): .git");
		if (mode === "error") throw new Error("未安装 Git，或 Git 不在 PATH 中");
		return status(root);
	});
	cache.setProjects(["a"]);
	await cache.refreshAll();
	assert.deepEqual(cache.get("a"), { local: true, loading: false });
	mode = "error";
	await cache.refreshAll();
	assert.match(cache.get("a").error!, /未安装 Git/);
	assert.equal(cache.get("a").local, undefined);
	mode = "git";
	await cache.refreshAll();
	assert.equal(cache.get("a").status?.branch, "main");
});

test("removed projects discard cached state and ignore late reads", async () => {
	const pending = deferred<GitStatus>();
	const cache = new GitStatusCache(() => pending.promise);
	cache.setProjects(["a"]);
	const read = cache.refresh("a");
	cache.setProjects([]);
	pending.resolve(status("a"));
	await read;
	assert.deepEqual(cache.get("a"), { loading: false });
});

test("writes pause polling, invalidate old reads and refresh queued AI changes on resume", async () => {
	const old = deferred<GitStatus>();
	let calls = 0;
	const cache = new GitStatusCache(async (root) => ++calls === 1 ? old.promise : status(root, String(calls)));
	cache.setProjects(["a"]);
	const read = cache.refresh("a");
	cache.pause("a", true);
	await cache.refreshAll();
	assert.equal(calls, 1);
	await cache.refreshChanged("a");
	await cache.refresh("a");
	old.resolve(status("a", "stale"));
	await read;
	assert.equal(cache.get("a").status?.version, "2");
	cache.pause("a", false);
	await cache.refresh("a");
	assert.equal(cache.get("a").status?.version, "3");
});

test("AI changes during a pending read schedule a fresh read after it finishes", async () => {
	const old = deferred<GitStatus>();
	let calls = 0;
	const cache = new GitStatusCache(async (root) => ++calls === 1 ? old.promise : status(root, "new"));
	cache.setProjects(["a"]);
	void cache.refresh("a");
	const changes = [cache.refreshChanged("a"), cache.refreshChanged("a")];
	old.resolve(status("a", "old"));
	await Promise.all(changes);
	assert.equal(calls, 2);
	assert.equal(cache.get("a").status?.version, "new");
});

test("AI tool results and run completion refresh the owning background project only", () => {
	const activity = new ProjectGitActivity();
	const roots = new Map([["chat-a", "a"], ["chat-b", "b"]]);
	const tool = (id: string, name: string): ChatMessage => ({ id, role: "assistant", blocks: [{ kind: "toolResult", id, name, text: "ok", isError: false }] });
	const messages = new Map([["chat-a", [tool("historical", "edit")]], ["chat-b", [] as ChatMessage[]]]);
	assert.equal(activity.update(messages, new Set(), roots).size, 0, "History hydration must not count as a new change");
	messages.get("chat-b")!.push(tool("read", "read"));
	assert.equal(activity.update(messages, new Set(["chat-b"]), roots).size, 0);
	messages.get("chat-b")!.push(tool("edit", "edit"));
	assert.deepEqual([...activity.update(messages, new Set(["chat-b"]), roots)], ["b"]);
	assert.equal(activity.update(messages, new Set(["chat-b"]), roots).size, 0);
	messages.get("chat-b")!.push(tool("command", "bash"));
	assert.deepEqual([...activity.update(messages, new Set(["chat-b"]), roots)], ["b"]);
	assert.deepEqual([...activity.update(messages, new Set(), roots)], ["b"]);
	assert.equal(activity.update(messages, new Set(), roots).size, 0);
});
