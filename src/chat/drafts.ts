import { allDraftAttachments, draftLimits, type DraftLimits, type DraftRecord } from "./draftContent";
import { DraftDatabase } from "./draftStorage";
export * from "./draftContent";

export type DraftStatus = "saving" | "saved" | "limited" | "error";
export interface DraftProblem { reason: "budget" | "quota" | "missing"; names: string[] }
const quotaExceeded = (error: unknown) => error instanceof DOMException && error.name === "QuotaExceededError";

/** One application-side owner of writes; tombstones and revisions guard late saves. */
export class DraftStore {
	private records = new Map<string, DraftRecord>();
	private recovered = new Set<string>();
	private statuses = new Map<string, DraftStatus>();
	private problems = new Map<string, DraftProblem>();
	private legacy = new Set<string>();
	private allowed = new Set<string>();
	private revisions = new Map<string, number>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private listeners = new Set<() => void>();
	private database = new DraftDatabase();
	private serial: Promise<void> = Promise.resolve();
	private hydrated = false;
	private loadError = false;
	private hydratePromise?: Promise<void>;
	private limits: DraftLimits;
	constructor(limits: DraftLimits = draftLimits) { this.limits = limits; }
	get loadFailed() { return this.loadError; }
	get ready() { return this.hydrated; }
	get(id: string) { return this.records.get(id); }
	status(id: string) { return this.statuses.get(id); }
	problem(id: string) { return this.problems.get(id); }
	/** Hydrated content can announce one actual application, never a later in-memory save. */
	consumeRecovery(id: string) { const recovered = this.recovered.has(id); this.recovered.delete(id); return recovered; }
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	private notify() { for (const listener of this.listeners) listener(); }

	async hydrate(validIds: readonly string[]) {
		this.allowed = new Set(validIds);
		if (this.hydratePromise) return this.hydratePromise;
		this.hydratePromise = (async () => {
			try {
				const { records, legacyIds, failed } = await this.database.load();
				this.legacy = new Set(legacyIds);
				this.loadError = failed;
				for (const draft of records) {
					if (this.allowed.has(draft.chatId) && !this.records.has(draft.chatId) && !this.revisions.has(draft.chatId)) {
						this.records.set(draft.chatId, draft); this.recovered.add(draft.chatId); this.revisions.set(draft.chatId, draft.revision);
					} else if (!this.allowed.has(draft.chatId)) { await this.database.remove(draft.chatId); this.database.forget(draft.chatId); }
				}
				// v1 survives failed migration; successful writes replace inline bodies atomically.
				for (const id of legacyIds) if (this.allowed.has(id)) await this.persist(id, true);
			} catch { this.loadError = true; }
			this.hydrated = true; this.notify();
		})();
		return this.hydratePromise;
	}
	setAllowed(ids: readonly string[]) {
		const next = new Set(ids);
		for (const id of this.allowed) if (!next.has(id)) this.remove(id);
		this.allowed = next;
	}
	save(draft: Omit<DraftRecord, "revision">) {
		if (!this.allowed.has(draft.chatId)) return;
		this.recovered.delete(draft.chatId);
		const revision = (this.revisions.get(draft.chatId) ?? 0) + 1;
		this.revisions.set(draft.chatId, revision);
		this.records.set(draft.chatId, { ...draft, revision });
		this.statuses.set(draft.chatId, "saving");
		clearTimeout(this.timers.get(draft.chatId));
		this.timers.set(draft.chatId, setTimeout(() => { this.timers.delete(draft.chatId); void this.persist(draft.chatId); }, 180));
		this.notify();
	}
	retry(id: string) { const draft = this.records.get(id); if (draft) { this.save(draft); return this.flush(); } return this.serial; }
	flush() { for (const [id, timer] of this.timers) { clearTimeout(timer); void this.persist(id); } this.timers.clear(); return this.serial; }

	/** Start transactions in the lifecycle event itself; a queued Promise may not run on reload. */
	flushOnExit() {
		if (!this.database.connection) { void this.flush(); return; }
		for (const [id, draft] of this.records) {
			if (!this.allowed.has(id) || this.statuses.get(id) !== "saving") continue;
			clearTimeout(this.timers.get(id)); this.timers.delete(id);
			const writing = this.write(this.database.connection, draft);
			this.serial = Promise.all([this.serial, writing]).then(() => {});
		}
	}
	private async write(database: IDBDatabase, draft: DraftRecord, migration = false) {
		const id = draft.chatId;
		migration ||= this.legacy.has(id);
		const current = () => this.allowed.has(id) && this.revisions.get(id) === draft.revision;
		if (!current()) return;
		try {
			let prepared: DraftRecord | undefined, reason: DraftProblem["reason"] = "budget";
			const limits = migration ? { attachment: Infinity, textAttachment: Infinity, perDraft: Infinity, total: Infinity } : this.limits;
			try { prepared = await this.database.write(database, draft, current, limits); }
			catch (error) {
				// Only a proven quota error can trigger content fallback. Other failures keep the last disk version intact.
				if (migration || !quotaExceeded(error)) throw error;
				reason = "quota";
				prepared = await this.database.write(database, draft, current, this.limits, true);
			}
			if (prepared) this.legacy.delete(id);
			if (current() && prepared) {
				const missing = allDraftAttachments(prepared).filter((item) => item.needsReattach);
				const newlyMissing = missing.filter((item) => allDraftAttachments(draft).some((original) => original.id === item.id && original.kind === item.kind && original.body !== undefined));
				const names = [...new Set((newlyMissing.length ? newlyMissing : missing).map((item) => item.name))];
				this.statuses.set(id, names.length ? "limited" : "saved");
				if (names.length) this.problems.set(id, { reason: newlyMissing.length ? reason : "missing", names }); else this.problems.delete(id);
			}
		} catch { if (current()) { this.statuses.set(id, "error"); this.problems.delete(id); } }
		this.notify();
	}
	private persist(id: string, migration = false) {
		const draft = this.records.get(id);
		if (!draft) return this.serial;
		this.serial = this.serial.then(async () => {
			if (!this.allowed.has(id) || this.revisions.get(id) !== draft.revision) return;
			try { await this.write(await this.database.open(), draft, migration); }
			catch { if (this.allowed.has(id) && this.revisions.get(id) === draft.revision) { this.statuses.set(id, "error"); this.notify(); } }
		});
		return this.serial;
	}
	remove(id: string) {
		this.recovered.delete(id); this.allowed.delete(id);
		clearTimeout(this.timers.get(id)); this.timers.delete(id);
		this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
		this.records.delete(id); this.statuses.delete(id); this.problems.delete(id); this.legacy.delete(id); this.database.forget(id);
		this.serial = this.serial.then(() => this.database.remove(id)).catch(() => { this.statuses.set(id, "error"); this.notify(); });
		this.notify();
	}
}
export const drafts = new DraftStore();
