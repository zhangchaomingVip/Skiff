import assert from "node:assert/strict";
import test from "node:test";
import { DiffPreviewCache } from "../src/workbench/diffPreviewCache";
import { GitStatusCache } from "../src/workbench/gitStatusCache";
import type { DiffPreview } from "../src/workbench/projectWorkbench";

const diff = (path: string, content = "+change"): DiffPreview => ({ path, content, kind: "text", truncated: false, version: "1" });
const deferred = () => { let resolve!: (value: DiffPreview) => void; const promise = new Promise<DiffPreview>((done) => { resolve = done; }); return { promise, resolve }; };
const until = async (condition: () => boolean) => {
	const deadline = Date.now() + 3000;
	while (!condition()) { assert.ok(Date.now() < deadline, "Timed out waiting for preload"); await new Promise((resolve) => setTimeout(resolve, 5)); }
};

test("startup warming is bounded, deduplicated and shared with foreground requests", async () => {
	const pending = new Map<string, ReturnType<typeof deferred>>();
	const calls: string[] = [];
	const cache = new DiffPreviewCache((_root, path) => { calls.push(path); const request = deferred(); pending.set(path, request); return request.promise; });
	cache.retainRoots(["a"]);
	cache.prefetch("a", ["first", "second", "third", "first"], "1");
	await until(() => calls.length === 2);
	assert.deepEqual(calls, ["first", "second"]);
	const foreground = cache.load("a", "first");
	pending.get("first")!.resolve(diff("first")); await foreground;
	assert.equal(calls.filter((path) => path === "first").length, 1);
	await until(() => calls.length === 3);
	pending.get("second")!.resolve(diff("second")); pending.get("third")!.resolve(diff("third"));
	await until(() => !!cache.get("a", "third"));
	cache.prefetch("a", ["fourth"], "1");
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(calls.length, 3, "Unchanged polling must not restart warming");
});

test("preload queues discard obsolete versions and removed projects, and failures can retry", async () => {
	const old = deferred();
	let calls = 0;
	const cache = new DiffPreviewCache(async (_root, path) => { calls++; if (path === "old") return old.promise; if (path === "fail" && calls < 5) throw new Error("read failed"); return diff(path); });
	cache.retainRoots(["a"]);
	cache.prefetch("a", ["old", "fail", "obsolete"], "1");
	await until(() => calls === 2);
	cache.prefetch("a", ["new"], "2");
	await until(() => !!cache.get("a", "new"));
	old.resolve(diff("old", "stale"));
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(cache.get("a", "old"), undefined);
	assert.equal(cache.get("a", "obsolete"), undefined);
	assert.equal(calls, 3);
	await assert.rejects(cache.load("a", "fail")); await cache.load("a", "fail");
	cache.prefetch("a", ["removed"], "3"); cache.retainRoots([]);
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(calls, 5);
	assert.equal(cache.get("a", "new"), undefined);
});

test("warming limits startup work per project and continues after a failed file", async () => {
	const calls: string[] = [];
	const cache = new DiffPreviewCache(async (_root, path) => { calls.push(path); if (path === "0") throw new Error("failure"); return diff(path); });
	cache.prefetch("a", Array.from({ length: 100 }, (_, index) => String(index)), "1");
	await until(() => !!cache.get("a", "23"));
	assert.equal(calls.length, 24);
	assert.equal(cache.get("a", "0"), undefined);
});

test("repeat Diff reads coalesce, normalize relative paths and isolate project roots", async () => {
	const pending = deferred();
	let calls = 0;
	const cache = new DiffPreviewCache(async (_root, path) => { calls++; return pending.promise; });
	const first = cache.load("a", "src/file.ts");
	const second = cache.load("a", "src\\file.ts");
	assert.equal(first, second);
	pending.resolve(diff("src/file.ts"));
	const value = await first;
	assert.equal(await cache.load("a", "src/file.ts"), value);
	assert.equal(cache.get("a", "src/file.ts"), value);
	assert.equal(cache.get("b", "src/file.ts"), undefined);
	await cache.load("b", "src/file.ts");
	assert.equal(calls, 2);
});

test("Git changes invalidate only the affected root while unchanged polls keep cached Diffs", async () => {
	const cache = new DiffPreviewCache(async (_root, path) => diff(path));
	let version = "1";
	const git = new GitStatusCache(async (root) => ({ repositoryRoot: root, scope: "", branch: "main", version, entries: [] }), (root, snapshot) => { if (!snapshot.loading) cache.setVersion(root, snapshot.status?.version); });
	git.setProjects(["a", "b"]);
	await git.refreshAll();
	await Promise.all([cache.load("a", "file"), cache.load("b", "file")]);
	await git.refresh("a");
	assert.ok(cache.get("a", "file"));
	version = "2";
	await git.refresh("a");
	assert.equal(cache.get("a", "file"), undefined);
	assert.ok(cache.get("b", "file"));
});

test("manual invalidation ignores stale responses and keeps other cached files", async () => {
	const old = deferred();
	let calls = 0;
	const cache = new DiffPreviewCache(async (_root, path) => ++calls === 1 ? old.promise : diff(path, "+new"));
	const read = cache.load("a", "file");
	await Promise.resolve();
	await cache.load("a", "other");
	cache.invalidate("a", "file");
	await cache.load("a", "file");
	old.resolve(diff("file", "+stale"));
	await read;
	assert.equal(cache.get("a", "file")?.content, "+new");
	assert.ok(cache.get("a", "other"));
});

test("changed status during a pending read prevents late results from repopulating the cache", async () => {
	const pending = deferred();
	const cache = new DiffPreviewCache(() => pending.promise);
	cache.setVersion("a", "1");
	const read = cache.load("a", "file");
	cache.setVersion("a", "2");
	pending.resolve(diff("file"));
	await read;
	assert.equal(cache.get("a", "file"), undefined);
});

test("failed reads can retry, and binary/empty Diffs are cached normally", async () => {
	let calls = 0;
	const cache = new DiffPreviewCache(async (_root, path) => {
		if (++calls === 1) throw new Error("temporary failure");
		return path === "binary" ? { path, kind: "binary", version: "1", truncated: false } : diff(path, "");
	});
	await assert.rejects(cache.load("a", "empty"), /temporary failure/);
	assert.equal((await cache.load("a", "empty")).content, "");
	await cache.load("a", "empty");
	await cache.load("a", "binary");
	await cache.load("a", "binary");
	assert.equal(calls, 3);
});

test("LRU entry and byte limits bound memory; reads promote a cached file", async () => {
	const cache = new DiffPreviewCache(async (_root, path) => diff(path), 2);
	await cache.load("a", "first");
	await cache.load("a", "second");
	cache.get("a", "first");
	await cache.load("a", "third");
	assert.ok(cache.get("a", "first"));
	assert.equal(cache.get("a", "second"), undefined);
	const small = new DiffPreviewCache(async (_root, path) => diff(path, "+".repeat(100)), 20, 500);
	await small.load("a", "first");
	await small.load("a", "second");
	assert.equal(small.get("a", "first"), undefined);
	assert.ok(small.get("a", "second"));
	const oversized = new DiffPreviewCache(async (_root, path) => diff(path, "+".repeat(1000)), 20, 500);
	assert.ok(await oversized.load("a", "large"));
	assert.equal(oversized.get("a", "large"), undefined);
});

test("removed projects release results, ignore pending reads, and cannot refill the cache", async () => {
	const pending = deferred();
	const cache = new DiffPreviewCache(() => pending.promise);
	cache.retainRoots(["a"]);
	const read = cache.load("a", "file");
	cache.retainRoots([]);
	pending.resolve(diff("file"));
	await read;
	assert.equal(cache.get("a", "file"), undefined);
	await assert.rejects(cache.load("a", "file"), /已移出列表/);
});
