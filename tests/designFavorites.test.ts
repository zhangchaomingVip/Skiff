import test from "node:test";
import assert from "node:assert/strict";
import { readDesignFavorites, saveAssetFavorite } from "../src/workbench/designFavorites.ts";

test("favorites survive reload, distinguish media IDs and can be undone independently", () => {
	let value: string | null = null;
	const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
	saveAssetFavorite(storage, { kind: "image", id: "same" }, true);
	saveAssetFavorite(storage, { kind: "video", id: "same" }, true);
	assert.deepEqual([...readDesignFavorites(storage)], ["image:same", "video:same"]);
	saveAssetFavorite(storage, { kind: "image", id: "same" }, false);
	assert.deepEqual([...readDesignFavorites(storage)], ["video:same"]);
});

test("favorites tolerate damaged data and report failed persistence", () => {
	for (const value of ["{broken", "null", '{"version":2,"ids":["image:a"]}']) assert.equal(readDesignFavorites({ getItem: () => value }).size, 0);
	assert.deepEqual([...readDesignFavorites({ getItem: () => '{"version":1,"ids":[null,4,"image:","image:a","bad","image:a"]}' })], ["image:a"]);
	assert.throws(() => saveAssetFavorite({ getItem: () => null, setItem: () => { throw new Error("storage full"); } }, { kind: "image", id: "a" }, true), /storage full/);
});
