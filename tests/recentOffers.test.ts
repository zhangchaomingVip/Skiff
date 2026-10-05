import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecentOfferIds, recentOfferLimit, rememberOffer } from "../src/chat/recentOffers.ts";

test("recent offers deduplicate, cap at eight, and remove inactive offers", () => {
	const ids = Array.from({ length: 10 }, (_, index) => `offer-${index}`);
	const valid = new Set(ids.slice(0, 5));
	assert.deepEqual(normalizeRecentOfferIds([...ids, "offer-0"], valid), ["offer-0", "offer-1", "offer-2", "offer-3", "offer-4"]);
	assert.equal(recentOfferLimit, 8);
});

test("remembering a failed or inactive offer does not change recent order", () => {
	const valid = new Set(["offer-a", "offer-b"]);
	assert.deepEqual(rememberOffer(["offer-a"], "missing", valid), ["offer-a"]);
	assert.deepEqual(rememberOffer(["offer-a", "offer-b"], "offer-b", valid), ["offer-b", "offer-a"]);
});
