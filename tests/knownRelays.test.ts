import test from "node:test";
import assert from "node:assert/strict";
import { knownRelayPricing } from "../src/chat/knownRelays.ts";

test("tokenrhythm resolves to its pricing API on the same origin", () => {
	assert.deepEqual(knownRelayPricing("https://tokenrhythm.studio/v1"), { name: "基元律动", url: "https://tokenrhythm.studio/api/models" });
	assert.deepEqual(knownRelayPricing("https://www.tokenrhythm.studio/v1"), { name: "基元律动", url: "https://tokenrhythm.studio/api/models" });
});

test("unknown or malformed relays resolve to nothing", () => {
	assert.equal(knownRelayPricing("https://api.example.com/v1"), undefined);
	assert.equal(knownRelayPricing("not a url"), undefined);
	assert.equal(knownRelayPricing(""), undefined);
});
