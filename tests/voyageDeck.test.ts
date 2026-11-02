import test from "node:test";
import assert from "node:assert/strict";
import { COMPANION_KEY, COMPANION_LIMIT, DECK_MODE_KEY, DECK_SIZE_KEY, DECK_SIZE_MIN, readCompanion, readDeckMode, readDeckSize, saveCompanion, saveDeckMode, saveDeckSize, type PreferenceStorage } from "../src/chat/voyageDeck.ts";

const memory = (seed: Record<string, string> = {}): PreferenceStorage & { values: Map<string, string> } => {
	const values = new Map(Object.entries(seed));
	return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
};

test("deck mode defaults to the navigator and survives a malformed value", () => {
	assert.equal(readDeckMode(memory()), "companion");
	assert.equal(readDeckMode(memory({ [DECK_MODE_KEY]: "billing" })), "billing");
	assert.equal(readDeckMode(memory({ [DECK_MODE_KEY]: "blank" })), "blank");
	assert.equal(readDeckMode(memory({ [DECK_MODE_KEY]: "  billing " })), "companion");
	assert.equal(readDeckMode(memory({ [DECK_MODE_KEY]: "deck" })), "companion");
});

test("deck mode never escapes into a storage failure", () => {
	const broken: PreferenceStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
	assert.equal(readDeckMode(broken), "companion");
	assert.doesNotThrow(() => saveDeckMode("billing", broken));
	assert.equal(readDeckMode(undefined), "companion");
	const storage = memory();
	saveDeckMode("blank", storage);
	assert.equal(storage.values.get(DECK_MODE_KEY), "blank");
});

test("a dragged deck height survives reload and refuses impossible values", () => {
	assert.equal(readDeckSize(memory()), undefined);
	assert.equal(readDeckSize(memory({ [DECK_SIZE_KEY]: "420" })), 420);
	assert.equal(readDeckSize(memory({ [DECK_SIZE_KEY]: String(DECK_SIZE_MIN - 1) })), undefined);
	assert.equal(readDeckSize(memory({ [DECK_SIZE_KEY]: "tall" })), undefined);
	const storage = memory();
	saveDeckSize(431.6, storage);
	assert.equal(storage.values.get(DECK_SIZE_KEY), "432");
	saveDeckSize(undefined, storage);
	assert.equal(readDeckSize(storage), undefined);
	assert.equal(readDeckSize(undefined), undefined);
});

test("only inline images inside the storage budget are restored", () => {
	assert.equal(readCompanion(memory()), undefined);
	assert.equal(readCompanion(memory({ [COMPANION_KEY]: "data:image/webp;base64,AAAA" })), "data:image/webp;base64,AAAA");
	assert.equal(readCompanion(memory({ [COMPANION_KEY]: "blob:http://localhost/companion" })), undefined);
	assert.equal(readCompanion(memory({ [COMPANION_KEY]: "https://example.com/idle.webp" })), undefined);
	assert.equal(readCompanion(memory({ [COMPANION_KEY]: `data:image/png;base64,${"A".repeat(COMPANION_LIMIT)}` })), undefined);
});

test("a custom companion can be replaced and cleared", () => {
	const storage = memory({ [COMPANION_KEY]: "data:image/gif;base64,AAAA" });
	assert.equal(saveCompanion("data:image/webp;base64,BBBB", storage), true);
	assert.equal(readCompanion(storage), "data:image/webp;base64,BBBB");
	assert.equal(saveCompanion(undefined, storage), true);
	assert.equal(readCompanion(storage), undefined);
	const full: PreferenceStorage = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("quota"); } };
	assert.equal(saveCompanion("data:image/webp;base64,AAAA", full), false);
});
