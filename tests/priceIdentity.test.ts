import test from "node:test";
import assert from "node:assert/strict";
import { modelIdMatchesCatalog } from "../src/chat/priceIdentity.ts";

test("reference price lookup accepts documented aliases without merging custom variants", () => {
	const entry = { modelId: "deepseek-flash", name: "DeepSeek V4.1 Flash 1017" };
	for (const id of ["deepseek-flash", "deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-v4.1-flash-1017"]) assert.ok(modelIdMatchesCatalog(id, entry), id);
	for (const id of ["deepseek-v4.1-flash-uncensored", "deepseek-v4-pro", ""]) assert.equal(modelIdMatchesCatalog(id, entry), false, id);
});
