import type { DiffPreview } from "./projectWorkbench";

type Entry = { root: string; value?: DiffPreview; pending?: Promise<DiffPreview>; bytes: number };
type Preload = { root: string; path: string; token: object };
const keyFor = (root: string, path: string) => JSON.stringify([root, path.replaceAll("\\", "/")]);

/** A bounded, run-lifetime LRU. Invalidated requests may finish but cannot refill it. */
export class DiffPreviewCache {
	private entries = new Map<string, Entry>();
	private versions = new Map<string, string | undefined>();
	private roots?: Set<string>;
	private read: (root: string, path: string) => Promise<DiffPreview>;
	private maxEntries: number;
	private maxBytes: number;
	private preloaded = new Map<string, { version: string; token: object }>();
	private queue: Preload[] = [];
	private activePreloads = 0;
	private preloadTimer?: ReturnType<typeof setTimeout>;

	constructor(read: (root: string, path: string) => Promise<DiffPreview>, maxEntries = 128, maxBytes = 24 * 1024 * 1024) {
		this.read = read; this.maxEntries = maxEntries; this.maxBytes = maxBytes;
	}

	get(root: string, path: string): DiffPreview | undefined {
		const key = keyFor(root, path);
		const entry = this.entries.get(key);
		if (!entry) return undefined;
		this.entries.delete(key); this.entries.set(key, entry);
		return entry.value;
	}

	setVersion(root: string, version?: string) {
		if (this.versions.get(root) !== version) this.invalidateRoot(root);
		this.versions.set(root, version);
	}

	retainRoots(roots: string[]) {
		const allowed = new Set(roots);
		this.roots = allowed;
		for (const [key, entry] of this.entries) if (!allowed.has(entry.root)) this.entries.delete(key);
		for (const root of this.versions.keys()) if (!allowed.has(root)) this.versions.delete(root);
		for (const root of this.preloaded.keys()) if (!allowed.has(root)) this.preloaded.delete(root);
		this.queue = this.queue.filter((item) => allowed.has(item.root));
	}

	invalidate(root: string, path: string) {
		const key = keyFor(root, path);
		this.entries.delete(key);
		this.queue = this.queue.filter((item) => keyFor(item.root, item.path) !== key);
	}
	invalidateRoot(root: string) {
		for (const [key, entry] of this.entries) if (entry.root === root) this.entries.delete(key);
		this.preloaded.delete(root);
		this.queue = this.queue.filter((item) => item.root !== root);
	}

	/** Warm a bounded working set after startup/status refresh; clicks bypass the queue. */
	prefetch(root: string, paths: string[], version: string) {
		if (this.roots && !this.roots.has(root)) return;
		if (this.preloaded.get(root)?.version === version) return;
		this.setVersion(root, version);
		const token = {};
		this.preloaded.set(root, { version, token });
		// Five visible projects * 24 entries fit under the normal 128-entry limit.
		const unique = [...new Set(paths.map((path) => path.replaceAll("\\", "/")))];
		this.queue.push(...unique.slice(0, Math.min(24, this.maxEntries)).map((path) => ({ root, path, token })));
		this.schedulePreloads();
	}

	private schedulePreloads() {
		if (this.preloadTimer !== undefined || !this.queue.length || this.activePreloads >= 2) return;
		this.preloadTimer = setTimeout(() => {
			this.preloadTimer = undefined;
			while (this.activePreloads < 2 && this.queue.length) {
				const item = this.queue.shift()!;
				if (this.preloaded.get(item.root)?.token !== item.token || this.entries.has(keyFor(item.root, item.path))) continue;
				this.activePreloads++;
				void this.load(item.root, item.path).catch(() => { /* Opening the file can retry and report the error. */ }).finally(() => {
					this.activePreloads--;
					this.schedulePreloads();
				});
			}
		}, 50);
	}

	private trim() {
		let bytes = [...this.entries.values()].reduce((total, entry) => total + entry.bytes, 0);
		for (const [key, entry] of this.entries) {
			if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) break;
			this.entries.delete(key); bytes -= entry.bytes;
		}
	}

	load(root: string, path: string): Promise<DiffPreview> {
		if (this.roots && !this.roots.has(root)) return Promise.reject(new Error("项目已移出列表，请重新添加后查看 Diff"));
		const key = keyFor(root, path);
		const existing = this.entries.get(key);
		if (existing) {
			this.entries.delete(key); this.entries.set(key, existing);
			if (existing.value) return Promise.resolve(existing.value);
			if (existing.pending) return existing.pending;
		}
		const entry: Entry = { root, bytes: 0 };
		this.entries.set(key, entry);
		entry.pending = Promise.resolve().then(() => this.read(root, path)).then((value) => {
			if (this.entries.get(key) === entry) {
				entry.value = value; entry.pending = undefined;
				// Account for UTF-16 storage and a small per-entry overhead.
				entry.bytes = (value.content?.length ?? 0) * 2 + 256;
				this.trim();
			}
			return value;
		}, (reason: unknown) => {
			if (this.entries.get(key) === entry) this.entries.delete(key);
			throw reason;
		});
		this.trim();
		return entry.pending;
	}
}
