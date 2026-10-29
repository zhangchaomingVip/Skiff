import type { GitStatus } from "./projectWorkbench";

export interface GitSnapshot {
	status?: GitStatus;
	local?: boolean;
	error?: string;
	loading: boolean;
}

const emptySnapshot: GitSnapshot = { loading: false };
export const GIT_REFRESH_MS = 5 * 60_000;

/** Shared across panels so closing the sidebar doesn't stop background reads. */
export class GitStatusCache {
	private snapshots = new Map<string, GitSnapshot>();
	private pending = new Map<string, Promise<void>>();
	private tickets = new Map<string, object>();
	private roots = new Set<string>();
	private paused = new Set<string>();
	private dirty = new Set<string>();
	private listeners = new Set<() => void>();

	private read: (root: string) => Promise<GitStatus>;
	private onChange?: (root: string, snapshot: GitSnapshot) => void;
	constructor(read: (root: string) => Promise<GitStatus>, onChange?: (root: string, snapshot: GitSnapshot) => void) { this.read = read; this.onChange = onChange; }

	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	get = (root?: string): GitSnapshot => root ? this.snapshots.get(root) ?? emptySnapshot : emptySnapshot;
	private publish(root: string, snapshot: GitSnapshot) {
		this.snapshots.set(root, snapshot);
		this.onChange?.(root, snapshot);
		for (const listener of this.listeners) listener();
	}

	setProjects(roots: string[]) {
		this.roots = new Set(roots);
		for (const root of this.snapshots.keys()) if (!this.roots.has(root)) {
			this.snapshots.delete(root); this.pending.delete(root); this.tickets.delete(root); this.paused.delete(root); this.dirty.delete(root);
		}
	}

	pause(root: string, paused: boolean) {
		if (paused) {
			this.paused.add(root);
			// A read started before a write must never replace its resulting state.
			this.tickets.delete(root); this.pending.delete(root);
		} else {
			this.paused.delete(root);
			if (this.dirty.has(root)) void this.refreshChanged(root);
		}
	}

	refreshChanged = async (root: string) => {
		if (!this.roots.has(root)) return;
		this.dirty.add(root);
		await this.pending.get(root);
		if (this.paused.has(root) || !this.dirty.delete(root)) return;
		await this.refresh(root);
	};

	refreshAll = () => Promise.all(Array.from(this.roots).filter((root) => !this.paused.has(root)).map((root) => this.refresh(root)));

	refresh = (root: string): Promise<void> => {
		if (!this.roots.has(root)) return Promise.resolve();
		const pending = this.pending.get(root);
		if (pending) return pending;
		const ticket = {};
		this.tickets.set(root, ticket);
		this.publish(root, { ...this.get(root), loading: true });
		const request = (async () => {
			try {
				const status = await this.read(root);
				if (this.tickets.get(root) === ticket) this.publish(root, { status, loading: false });
			} catch (reason) {
				if (this.tickets.get(root) !== ticket) return;
				const error = String(reason);
				// Only absence of a repository is a normal local-project state.
				this.publish(root, /not a git repository/i.test(error) ? { local: true, loading: false } : { error, loading: false });
			} finally {
				if (this.tickets.get(root) === ticket) { this.pending.delete(root); this.tickets.delete(root); }
			}
		})();
		this.pending.set(root, request);
		return request;
	};
}
