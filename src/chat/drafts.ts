import type { ImageAttachment } from "./types";
import type { TextAttachment } from "./textAttachments";
import type { MessageLocation } from "./historySearch";

export interface DraftAttachment { id: string; name: string; kind: "image" | "text"; mimeType?: string; body?: string; bytes: number; needsReattach?: boolean }
export interface DraftContent { text: string; attachments: DraftAttachment[] }
export interface DraftRecord extends DraftContent {
	chatId: string; cwd: string; sessionFile?: string; revision: number;
	/** Reserved for 018: never replay an edit against another branch. */
	edit?: { target: MessageLocation; branchVersion: string; previous: DraftContent };
}
export type DraftStatus = "saving" | "saved" | "limited" | "error";
export const draftLimits = { attachment: 1024 * 1024, perDraft: 4 * 1024 * 1024, total: 20 * 1024 * 1024 };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const hasDraft = (draft: (DraftContent & { edit?: DraftRecord["edit"] }) | undefined) => !!draft && (!!draft.text || !!draft.attachments.length || !!draft.edit);
export function draftAttachments(images: ImageAttachment[], files: TextAttachment[]): DraftAttachment[] {
	return [...images.map((image): DraftAttachment => ({ id: image.id, name: image.name, mimeType: image.mimeType, kind: "image", body: image.data, bytes: bytes(image.data) })), ...files.map((file): DraftAttachment => ({ id: file.id, name: file.name, kind: "text", body: file.text, bytes: bytes(file.text) }))];
}
export function prepareDraft(draft: DraftRecord, otherBytes = 0, metadataOnly = false): DraftRecord {
	let own = 0;
	const prepare = (attachments: DraftAttachment[]) => attachments.map((attachment) => {
		const size = attachment.body === undefined ? 0 : bytes(attachment.body);
		const retain = !metadataOnly && attachment.body !== undefined && size <= draftLimits.attachment && own + size <= draftLimits.perDraft && otherBytes + own + size <= draftLimits.total;
		if (retain) own += size;
		return { ...attachment, body: retain ? attachment.body : undefined, bytes: attachment.bytes, needsReattach: !retain };
	});
	return { ...draft, attachments: prepare(draft.attachments), ...(draft.edit ? { edit: { ...draft.edit, previous: { ...draft.edit.previous, attachments: prepare(draft.edit.previous.attachments) } } } : {}) };
}
export const persistedAttachmentBytes = (draft: DraftRecord) => [...draft.attachments, ...(draft.edit?.previous.attachments ?? [])].reduce((total, attachment) => total + (attachment.body === undefined ? 0 : bytes(attachment.body)), 0);
const draftLimited = (draft: DraftRecord) => [...draft.attachments, ...(draft.edit?.previous.attachments ?? [])].some((attachment) => attachment.needsReattach);
const validEdit = (edit: DraftRecord["edit"]) => !edit || (typeof edit.branchVersion === "string" && typeof edit.target?.chatId === "string" && typeof edit.target.fingerprint === "string" && typeof edit.target.version === "string" && Number.isSafeInteger(edit.target.occurrence) && Number.isSafeInteger(edit.target.occurrences) && typeof edit.previous?.text === "string" && Array.isArray(edit.previous.attachments) && edit.previous.attachments.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && (item.kind === "text" || item.kind === "image") && (item.body === undefined || typeof item.body === "string")));

/** One application-side owner of writes; tombstones and revisions guard late saves. */
export class DraftStore {
	private records = new Map<string, DraftRecord>();
	private statuses = new Map<string, DraftStatus>();
	private allowed = new Set<string>();
	private revisions = new Map<string, number>();
	private timers = new Map<string, ReturnType<typeof setTimeout>>();
	private listeners = new Set<() => void>();
	private database?: Promise<IDBDatabase>;
	private connection?: IDBDatabase;
	private persistedSizes = new Map<string, number>();
	private serial: Promise<void> = Promise.resolve();
	private hydrated = false;
	private loadError = false;
	get loadFailed() { return this.loadError; }
	private hydratePromise?: Promise<void>;
	get ready() { return this.hydrated; }
	get(id: string) { return this.records.get(id); }
	status(id: string) { return this.statuses.get(id); }
	subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
	private notify() { for (const listener of this.listeners) listener(); }
	private open() {
		return this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
			if (!globalThis.indexedDB) { reject(new Error("草稿存储不可用")); return; }
			const request = indexedDB.open("skiff-drafts", 1);
			request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "chatId" });
			request.onsuccess = () => { this.connection = request.result; resolve(request.result); };
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error("草稿存储被其他窗口占用"));
		});
	}
	async hydrate(validIds: readonly string[]) {
		this.allowed = new Set(validIds);
		if (this.hydratePromise) return this.hydratePromise;
		this.hydratePromise = (async () => {
			try {
				const database = await this.open();
				const stored = await new Promise<DraftRecord[]>((resolve, reject) => { const request = database.transaction("drafts").objectStore("drafts").getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
				for (const draft of stored) {
					if (!draft || typeof draft.chatId !== "string" || typeof draft.cwd !== "string" || typeof draft.text !== "string" || !Number.isSafeInteger(draft.revision) || !Array.isArray(draft.attachments) || !draft.attachments.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && (item.kind === "image" || item.kind === "text") && (item.body === undefined || typeof item.body === "string"))) { this.loadError = true; continue; }
					if (!validEdit(draft.edit)) { draft.edit = undefined; this.loadError = true; }
					this.persistedSizes.set(draft.chatId, persistedAttachmentBytes(draft));
					if (this.allowed.has(draft.chatId) && !this.records.has(draft.chatId) && !this.revisions.has(draft.chatId) && typeof draft.text === "string" && Array.isArray(draft.attachments)) { this.records.set(draft.chatId, draft); this.revisions.set(draft.chatId, draft.revision); }
					else if (!this.allowed.has(draft.chatId)) await this.deletePersisted(draft.chatId);
				}
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
		const revision = (this.revisions.get(draft.chatId) ?? 0) + 1;
		this.revisions.set(draft.chatId, revision);
		this.records.set(draft.chatId, { ...draft, revision });
		this.statuses.set(draft.chatId, "saving");
		clearTimeout(this.timers.get(draft.chatId));
		this.timers.set(draft.chatId, setTimeout(() => { this.timers.delete(draft.chatId); void this.persist(draft.chatId); }, 180));
		this.notify();
	}
	flush() { for (const [id, timer] of this.timers) { clearTimeout(timer); void this.persist(id); } this.timers.clear(); return this.serial; }
	/** Start transactions in the lifecycle event itself; a queued Promise may not run on reload. */
	flushOnExit() {
		if (!this.connection) { void this.flush(); return; }
		for (const [id, draft] of this.records) {
			if (!this.allowed.has(id) || this.statuses.get(id) !== "saving") continue;
			clearTimeout(this.timers.get(id)); this.timers.delete(id);
			const current = () => this.allowed.has(id) && this.revisions.get(id) === draft.revision;
			const write = (metadataOnly: boolean) => {
				const previousSize = this.persistedSizes.get(id) ?? 0;
				try {
					const used = [...this.persistedSizes].reduce((sum, [key, size]) => sum + (key === id ? 0 : size), 0);
					const prepared = prepareDraft(draft, used, metadataOnly);
					const transaction = this.connection!.transaction("drafts", "readwrite");
					const store = transaction.objectStore("drafts");
					if (hasDraft(prepared)) store.put(prepared); else store.delete(id);
					this.persistedSizes.set(id, persistedAttachmentBytes(prepared));
					transaction.oncomplete = () => { if (current()) { this.statuses.set(id, draftLimited(prepared) ? "limited" : "saved"); this.notify(); } };
					transaction.onabort = () => { this.persistedSizes.set(id, previousSize); if (current()) { if (!metadataOnly) write(true); else { this.statuses.set(id, "error"); this.notify(); } } };
					transaction.commit?.();
				} catch { if (!metadataOnly) write(true); else { this.statuses.set(id, "error"); this.notify(); } }
			};
			write(false);
		}
	}
	private persist(id: string) {
		const draft = this.records.get(id);
		if (!draft) return this.serial;
		const current = () => this.allowed.has(id) && this.revisions.get(id) === draft.revision;
		this.serial = this.serial.then(async () => {
			if (!current()) return;
			try {
				const database = await this.open();
				const write = (metadataOnly: boolean) => new Promise<DraftRecord | undefined>((resolve, reject) => {
					const transaction = database.transaction("drafts", "readwrite"), store = transaction.objectStore("drafts"), read = store.getAll();
					let prepared: DraftRecord | undefined;
					read.onsuccess = () => {
						if (!current()) return;
						try {
							const used = (read.result as DraftRecord[]).filter((entry) => entry.chatId !== id).reduce((total, entry) => total + persistedAttachmentBytes(entry), 0);
							prepared = prepareDraft(draft, used, metadataOnly);
							if (hasDraft(prepared)) store.put(prepared); else store.delete(id);
						} catch (error) { transaction.abort(); reject(error); }
					};
					transaction.oncomplete = () => resolve(prepared);
					transaction.onerror = () => reject(transaction.error);
					transaction.onabort = () => reject(transaction.error);
				});
				let prepared: DraftRecord | undefined;
				try { prepared = await write(false); } catch { prepared = await write(true); }
				if (prepared) this.persistedSizes.set(id, persistedAttachmentBytes(prepared));
				if (current() && prepared) this.statuses.set(id, draftLimited(prepared) ? "limited" : "saved");
			} catch { if (current()) this.statuses.set(id, "error"); }
			this.notify();
		});
		return this.serial;
	}
	private async deletePersisted(id: string) { const database = await this.open(); await new Promise<void>((resolve, reject) => { const transaction = database.transaction("drafts", "readwrite"); transaction.objectStore("drafts").delete(id); transaction.oncomplete = () => { this.persistedSizes.delete(id); resolve(); }; transaction.onerror = () => reject(transaction.error); }); }
	remove(id: string) {
		this.allowed.delete(id);
		clearTimeout(this.timers.get(id)); this.timers.delete(id);
		this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
		this.records.delete(id); this.statuses.delete(id);
		this.serial = this.serial.then(() => this.deletePersisted(id)).catch(() => { this.statuses.set(id, "error"); this.notify(); });
		this.notify();
	}
}
export const drafts = new DraftStore();
