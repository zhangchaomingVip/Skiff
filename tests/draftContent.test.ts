import assert from "node:assert/strict";
import test from "node:test";
import { attachmentBytes, draftLimits, mergeDraftAttachments, persistedAttachmentBytes, prepareDraft, type DraftAttachment, type DraftRecord } from "../src/chat/drafts.ts";
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from "../src/chat/attachmentLimits.ts";

const record = (attachments: DraftAttachment[]): DraftRecord => ({ chatId: "chat", cwd: "project", revision: 1, text: "preserve", attachments });
const text = (id: string, body?: string, name = id): DraftAttachment => ({ id, name, kind: "text", body, bytes: body?.length ?? 0, needsReattach: body === undefined });

test("every supported image size and escaped text fits the draft without serialized overhead", () => {
	for (const size of [768 * 1024, 1024 * 1024, MAX_IMAGE_BYTES]) {
		const body = Buffer.alloc(size).toString("base64");
		const image: DraftAttachment = { id: "image", name: "image.png", kind: "image", body, bytes: size };
		assert.equal(attachmentBytes(image), size);
		assert.equal(prepareDraft(record([image])).attachments[0].body, body);
	}
	for (const character of ["\n", "\\", "\u001f"]) {
		const attachment = text("text", character.repeat(MAX_TEXT_BYTES));
		assert.equal(prepareDraft(record([attachment])).attachments[0].body, attachment.body);
		assert.equal(persistedAttachmentBytes(record([attachment])), MAX_TEXT_BYTES);
	}
});

test("maximum current and previous drafts fit independently while global usage counts both", () => {
	const image = Buffer.alloc(MAX_IMAGE_BYTES).toString("base64");
	const attachments: DraftAttachment[] = Array.from({ length: 4 }, (_, i) => ({ id: `image-${i}`, name: `${i}.png`, kind: "image", body: image, bytes: MAX_IMAGE_BYTES }));
	attachments.push(...Array.from({ length: 4 }, (_, i) => text(`text-${i}`, "\\".repeat(MAX_TEXT_BYTES))));
	const draft = record(attachments);
	draft.edit = { target: { chatId: "chat", version: "v", fingerprint: "f", query: "", occurrence: 0, occurrences: 1 }, branchVersion: "v", previous: { text: "previous", attachments: attachments.map((item) => ({ ...item, id: `previous-${item.id}` })) } };
	const prepared = prepareDraft(draft);
	assert.ok([...prepared.attachments, ...prepared.edit!.previous.attachments].every((item) => item.body !== undefined));
	assert.equal(persistedAttachmentBytes(prepared), 44 * 1024 * 1024);
	assert.equal(prepareDraft(draft, draftLimits.total - 22 * 1024 * 1024).edit!.previous.attachments[0].needsReattach, true);
});

test("same id with different contents must not be deduplicated", () => {
	const draft = record([text("same", "first")]);
	draft.edit = { target: { chatId: "chat", version: "v", fingerprint: "f", query: "", occurrence: 0, occurrences: 1 }, branchVersion: "v", previous: { text: "", attachments: [text("same", "second")] } };
	assert.equal(persistedAttachmentBytes(draft), 11);
});

test("explicit replacement accepts a new filename and does not consume other missing attachments", () => {
	const missing = [text("a", undefined, "same.txt"), text("b", undefined, "same.txt")];
	const added = text("new", "content", "renamed.txt");
	assert.deepEqual(mergeDraftAttachments(missing, [added], "b").map((item) => item.id), ["new", "a"]);
	assert.deepEqual(mergeDraftAttachments(missing, [{ ...added, name: "same.txt" }]).map((item) => item.id), ["new", "b"]);
	const existing = text("existing", "already there", "same.txt");
	assert.deepEqual(mergeDraftAttachments([existing, ...missing], [existing]).map((item) => item.id), ["existing", "a", "b"]);
});
