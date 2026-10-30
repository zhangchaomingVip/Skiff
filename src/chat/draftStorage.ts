import { allDraftAttachments, hasDraft, mapDraftAttachments, persistedAttachmentBytes, prepareDraft, sameAttachmentContent, type DraftAttachment, type DraftLimits, type DraftRecord } from "./draftContent";

interface StoredAttachment extends DraftAttachment { contentId?: string }
interface StoredDraft extends DraftRecord { storageVersion?: number }
interface Asset { key: string; chatId: string; blob: Blob }
interface CachedAsset extends Asset { attachment: DraftAttachment }
interface SizeRecord { chatId: string; bytes: number }
const stores = ["drafts", "attachments", "sizes"];
const validAttachments = (value: unknown): value is StoredAttachment[] => Array.isArray(value) && value.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && (item.kind === "image" || item.kind === "text") && (item.body === undefined || typeof item.body === "string") && (item.contentId === undefined || typeof item.contentId === "string"));
const validRecord = (draft: StoredDraft) => draft && typeof draft.chatId === "string" && typeof draft.cwd === "string" && typeof draft.text === "string" && Number.isSafeInteger(draft.revision) && validAttachments(draft.attachments);
const validEdit = (edit: DraftRecord["edit"]) => !edit || (typeof edit.branchVersion === "string" && typeof edit.target?.chatId === "string" && typeof edit.target.fingerprint === "string" && typeof edit.target.version === "string" && Number.isSafeInteger(edit.target.occurrence) && Number.isSafeInteger(edit.target.occurrences) && typeof edit.previous?.text === "string" && validAttachments(edit.previous.attachments));
const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });

function attachmentBlob(attachment: DraftAttachment): Blob {
	if (attachment.kind === "text") return new Blob([attachment.body!], { type: "text/plain;charset=utf-8" });
	const binary = atob(attachment.body!);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new Blob([bytes], { type: attachment.mimeType ?? "application/octet-stream" });
}

async function attachmentBody(blob: Blob, kind: DraftAttachment["kind"]): Promise<string> {
	if (kind === "text") return blob.text();
	const bytes = new Uint8Array(await blob.arrayBuffer()), chunks: string[] = [];
	for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
	return btoa(chunks.join(""));
}

/** Metadata, content and byte accounting commit together. Typing never scans or rewrites stored blobs. */
export class DraftDatabase {
	connection?: IDBDatabase;
	private opening?: Promise<IDBDatabase>;
	private cache = new Map<string, CachedAsset[]>();

	open(): Promise<IDBDatabase> {
		if (this.opening) return this.opening;
		this.opening = new Promise<IDBDatabase>((resolve, reject) => {
			if (!globalThis.indexedDB) { reject(new Error("草稿存储不可用")); return; }
			const request = indexedDB.open("skiff-drafts", 2);
			let blocked = false;
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "chatId" });
				const assets = db.createObjectStore("attachments", { keyPath: "key" });
				assets.createIndex("chatId", "chatId");
				const sizes = db.createObjectStore("sizes", { keyPath: "chatId" });
				// Keep v1 bodies intact until their first successful atomic migration.
				const cursor = request.transaction!.objectStore("drafts").openCursor();
				cursor.onsuccess = () => {
					if (!cursor.result) return;
					const draft = cursor.result.value as StoredDraft;
					if (validRecord(draft)) sizes.put({ chatId: draft.chatId, bytes: persistedAttachmentBytes({ ...draft, edit: validEdit(draft.edit) ? draft.edit : undefined }) });
					cursor.result.continue();
				};
			};
			request.onsuccess = () => {
				if (blocked) { request.result.close(); return; }
				this.connection = request.result;
				request.result.onversionchange = () => { request.result.close(); this.connection = undefined; this.opening = undefined; };
				resolve(request.result);
			};
			request.onerror = () => reject(request.error);
			request.onblocked = () => { blocked = true; reject(new Error("草稿存储被其他窗口占用，请关闭旧窗口后重试")); };
		}).catch((error) => { this.opening = undefined; throw error; });
		return this.opening;
	}

	stage(draft: DraftRecord): CachedAsset[] {
		const previous = this.cache.get(draft.chatId) ?? [], next: CachedAsset[] = [];
		for (const attachment of allDraftAttachments(draft)) {
			if (attachment.body === undefined || next.some((item) => sameAttachmentContent(item.attachment, attachment))) continue;
			next.push(previous.find((item) => sameAttachmentContent(item.attachment, attachment)) ?? { key: crypto.randomUUID(), chatId: draft.chatId, attachment, blob: attachmentBlob(attachment) });
		}
		return next;
	}

	async load() {
		const db = await this.open();
		const stored = await requestResult<StoredDraft[]>(db.transaction("drafts").objectStore("drafts").getAll());
		const records: DraftRecord[] = [], legacyIds: string[] = [];
		let failed = false;
		for (const raw of stored) {
			if (!validRecord(raw)) { failed = true; continue; }
			if (!validEdit(raw.edit)) { raw.edit = undefined; failed = true; }
			const { storageVersion, ...draft } = raw;
			const references = allDraftAttachments(draft) as StoredAttachment[];
			const ids = [...new Set(references.flatMap((item) => item.contentId ? [item.contentId] : []))];
			const assets = new Map<string, Asset | undefined>();
			if (ids.length) {
				const store = db.transaction("attachments").objectStore("attachments");
				await Promise.all(ids.map(async (id) => assets.set(id, await requestResult<Asset | undefined>(store.get(id)))));
			}
			const restored = new Map<DraftAttachment, DraftAttachment>();
			const cached: CachedAsset[] = [];
			for (const attachment of references) {
				const { contentId, ...metadata } = attachment;
				const asset = contentId ? assets.get(contentId) : undefined;
				if (contentId) {
					if (asset?.chatId === draft.chatId && asset.blob instanceof Blob) {
						const existing = cached.find((item) => item.key === contentId);
						metadata.body = existing?.attachment.body ?? await attachmentBody(asset.blob, metadata.kind);
						metadata.needsReattach = false;
						cached.push({ ...asset, attachment: metadata });
					} else { metadata.body = undefined; metadata.needsReattach = true; }
				}
				restored.set(attachment, metadata);
			}
			this.cache.set(draft.chatId, cached);
			records.push(mapDraftAttachments(draft, (item) => restored.get(item)!));
			if (storageVersion !== 2) legacyIds.push(draft.chatId);
		}
		return { records, legacyIds, failed };
	}

	/** Starts the transaction synchronously, including from pagehide/beforeunload. */
	write(db: IDBDatabase, draft: DraftRecord, current: () => boolean, limits: DraftLimits, existingOnly = false): Promise<DraftRecord | undefined> {
		const staged = this.stage(draft);
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(stores, "readwrite");
			const metadata = transaction.objectStore("drafts"), assets = transaction.objectStore("attachments"), sizes = transaction.objectStore("sizes");
			const usage = sizes.getAll(), keys = assets.index("chatId").getAllKeys(draft.chatId);
			let pending = 2, prepared: DraftRecord | undefined, failure: unknown;
			const write = () => {
				if (--pending || !current()) return;
				try {
					const otherBytes = (usage.result as SizeRecord[]).reduce((sum, entry) => sum + (entry.chatId === draft.chatId ? 0 : entry.bytes), 0);
					const existing = new Set(keys.result);
					prepared = prepareDraft(draft, otherBytes, false, limits, staged.filter((item) => existing.has(item.key)).map((item) => item.attachment));
					const retained = new Set<string>();
					const encoded = mapDraftAttachments(prepared, (attachment): StoredAttachment => {
						if (attachment.body === undefined) return attachment;
						const asset = staged.find((item) => sameAttachmentContent(item.attachment, attachment))!;
						if (existingOnly && !existing.has(asset.key)) return { ...attachment, body: undefined, needsReattach: true };
						if (!existing.has(asset.key) && !retained.has(asset.key)) assets.put({ key: asset.key, chatId: draft.chatId, blob: asset.blob } satisfies Asset);
						retained.add(asset.key);
						const { body: _body, ...value } = attachment;
						return { ...value, contentId: asset.key };
					});
					// Return the actual fallback outcome while keeping the caller's in-memory draft untouched.
					if (existingOnly) prepared = mapDraftAttachments(prepared, (attachment) => {
						const asset = staged.find((item) => sameAttachmentContent(item.attachment, attachment));
						return asset && retained.has(asset.key) ? attachment : { ...attachment, body: undefined, needsReattach: true };
					});
					for (const key of existing) if (!retained.has(String(key))) assets.delete(key);
					if (hasDraft(encoded)) {
						metadata.put({ ...encoded, storageVersion: 2 });
						sizes.put({ chatId: draft.chatId, bytes: persistedAttachmentBytes(prepared) } satisfies SizeRecord);
					} else { metadata.delete(draft.chatId); sizes.delete(draft.chatId); }
				} catch (error) { failure = error; transaction.abort(); }
			};
			usage.onsuccess = write;
			keys.onsuccess = write;
			transaction.oncomplete = () => {
				// A failed transaction must not discard the last committed content IDs.
				if (prepared) this.cache.set(draft.chatId, staged);
				resolve(prepared);
			};
			transaction.onabort = () => reject(failure ?? transaction.error);
			transaction.onerror = () => { failure ??= transaction.error; };
		});
	}

	forget(id: string) { this.cache.delete(id); }
	async remove(id: string) {
		const db = await this.open();
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(stores, "readwrite");
			const assets = transaction.objectStore("attachments");
			const keys = assets.index("chatId").getAllKeys(id);
			keys.onsuccess = () => { for (const key of keys.result) assets.delete(key); };
			transaction.objectStore("drafts").delete(id);
			transaction.objectStore("sizes").delete(id);
			transaction.oncomplete = () => resolve();
			transaction.onabort = () => reject(transaction.error);
		});
	}
}
