import type { ImageAttachment } from "./types";
import type { TextAttachment } from "./textAttachments";
import type { MessageLocation } from "./historySearch";
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from "./attachmentLimits";

export interface DraftAttachment { id: string; name: string; kind: "image" | "text"; mimeType?: string; body?: string; bytes: number; needsReattach?: boolean }
export interface DraftContent { text: string; attachments: DraftAttachment[] }
export interface DraftRecord extends DraftContent {
	chatId: string; cwd: string; sessionFile?: string; revision: number;
	edit?: { target: MessageLocation; branchVersion: string; previous: DraftContent };
}
export interface DraftLimits { attachment: number; textAttachment: number; perDraft: number; total: number }
/** Content bytes, independent of base64/JSON overhead. Each edit snapshot has its own allowance. */
export const draftLimits: DraftLimits = { attachment: MAX_IMAGE_BYTES, textAttachment: MAX_TEXT_BYTES, perDraft: 32 * 1024 * 1024, total: 256 * 1024 * 1024 };
export const hasDraft = (draft: (DraftContent & { edit?: DraftRecord["edit"] }) | undefined) => !!draft && (!!draft.text || !!draft.attachments.length || !!draft.edit);
export const allDraftAttachments = (draft: DraftRecord) => [...draft.attachments, ...(draft.edit?.previous.attachments ?? [])];
export const sameAttachmentContent = (a: DraftAttachment, b: DraftAttachment) => a.id === b.id && a.kind === b.kind && a.body === b.body;
export const attachmentBytes = (attachment: DraftAttachment) => attachment.body === undefined ? 0 : attachment.kind === "image"
	? Math.max(0, Math.floor(attachment.body.length * 3 / 4) - (attachment.body.endsWith("==") ? 2 : attachment.body.endsWith("=") ? 1 : 0))
	: new TextEncoder().encode(attachment.body).byteLength;

export function draftAttachments(images: ImageAttachment[], files: TextAttachment[]): DraftAttachment[] {
	return [...images.map((image): DraftAttachment => ({ id: image.id, name: image.name, mimeType: image.mimeType, kind: "image", body: image.data, bytes: 0 })), ...files.map((file): DraftAttachment => ({ id: file.id, name: file.name, kind: "text", body: file.text, bytes: 0 }))].map((item) => ({ ...item, bytes: attachmentBytes(item) }));
}

export function mapDraftAttachments<T extends DraftRecord>(draft: T, map: (attachment: DraftAttachment) => DraftAttachment): T {
	return { ...draft, attachments: draft.attachments.map(map), ...(draft.edit ? { edit: { ...draft.edit, previous: { ...draft.edit.previous, attachments: draft.edit.previous.attachments.map(map) } } } : {}) };
}

export function prepareDraft(draft: DraftRecord, otherBytes = 0, metadataOnly = false, limits = draftLimits, persisted: DraftAttachment[] = []): DraftRecord {
	const retained: DraftAttachment[] = [];
	let total = 0;
	const groups = [draft.attachments, draft.edit?.previous.attachments ?? []];
	const own = [0, 0], result: DraftAttachment[][] = [[], []];
	const entries = groups.flatMap((attachments, group) => attachments.map((attachment, index) => ({ attachment, group, index, saved: persisted.some((item) => sameAttachmentContent(item, attachment)) })));
	// Existing content gets priority even when a newly added image precedes old text attachments.
	for (const { attachment, group, index, saved } of entries.sort((a, b) => Number(b.saved) - Number(a.saved))) {
		const size = attachmentBytes(attachment);
		const additional = retained.some((item) => sameAttachmentContent(item, attachment)) ? 0 : size;
		const retain = !metadataOnly && attachment.body !== undefined && (saved || (size <= (attachment.kind === "image" ? limits.attachment : limits.textAttachment) && own[group] + size <= limits.perDraft && otherBytes + total + additional <= limits.total));
		if (retain) { own[group] += size; total += additional; retained.push(attachment); }
		result[group][index] = { ...attachment, body: retain ? attachment.body : undefined, bytes: attachment.body === undefined ? attachment.bytes : size, needsReattach: !retain };
	}
	return { ...draft, attachments: result[0], ...(draft.edit ? { edit: { ...draft.edit, previous: { ...draft.edit.previous, attachments: result[1] } } } : {}) };
}

export function persistedAttachmentBytes(draft: DraftRecord): number {
	const seen: DraftAttachment[] = [];
	return allDraftAttachments(draft).reduce((total, attachment) => {
		if (seen.some((item) => sameAttachmentContent(item, attachment))) return total;
		seen.push(attachment);
		return total + attachmentBytes(attachment);
	}, 0);
}

/** Explicit replacement wins; a newly selected same-name file replaces at most one missing item. */
export function mergeDraftAttachments(current: DraftAttachment[], added: DraftAttachment[], replacementId?: string): DraftAttachment[] {
	const fresh = added.filter((item) => !current.some((previous) => previous.id === item.id));
	return [...added, ...current.filter((item) => {
		if (item.body !== undefined) return false;
		if (replacementId) return item.id !== replacementId;
		const match = fresh.findIndex((next) => next.kind === item.kind && next.name === item.name);
		if (match < 0) return true;
		fresh.splice(match, 1);
		return false;
	})];
}
