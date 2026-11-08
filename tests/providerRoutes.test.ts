import test from "node:test";
import assert from "node:assert/strict";
import { discoveredFamily, suggestFamilyId, suggestedFamilyLabel } from "../src/chat/providerRoutes.ts";

test("classification uses basename boundaries and accepts legacy family aliases", () => {
	assert.equal(discoveredFamily("vendor/moonshot-v1"), "kimi");
	assert.equal(discoveredFamily("vendor/ChatGLM-6B"), "glm");
	// Auto-routing ids without a vendor prefix join the Auto family.
	assert.equal(discoveredFamily("auto"), "auto");
	assert.equal(discoveredFamily("openrouter/auto"), "auto");
	assert.equal(discoveredFamily("vendor/auto-moe"), "auto");
	// Vendor-prefixed auto models stay with their maker's family.
	assert.equal(discoveredFamily("moonshot-v1-auto"), "kimi");
	for (const id of ["not-deepseek-chat", "deepseek-ai/qwen-max", "glm4-fake", "deepseek-ocr", "kimi-tts", "glm-rerank", "autogen", "x-automation"]) {
		assert.equal(discoveredFamily(id), undefined, id);
	}
});

test("family suggestions name the vendor and collapse versioned prefixes", () => {
	assert.equal(suggestFamilyId("gpt-5.2"), "gpt");
	assert.equal(suggestFamilyId("openai/gpt-4o-mini"), "gpt");
	assert.equal(suggestFamilyId("claude-sonnet-4-5"), "claude");
	assert.equal(suggestFamilyId("Qwen/Qwen3-235B-A22B-Instruct"), "qwen");
	assert.equal(suggestFamilyId("qwen2.5-72b-instruct"), "qwen");
	assert.equal(suggestFamilyId("gemini-2.5-pro"), "gemini");
	assert.equal(suggestFamilyId("o3"), "o3");
	assert.equal(suggestFamilyId("o4-mini"), "o4");
	// Digits only disappear when the stem still names a vendor.
	assert.equal(suggestFamilyId("minimax-m2"), "minimax");
	assert.equal(suggestFamilyId("vendor/ERNIE-4.5-turbo"), "ernie");
	// Non-chat endpoints and unusable prefixes stay unassigned.
	for (const id of ["text-embedding-3-small", "bge-rerank-v2", "deepseek-ocr", "kimi-tts", "123", "a-model-00"]) {
		assert.equal(suggestFamilyId(id), undefined, id);
	}
	assert.equal(suggestFamilyId("gpt-5.2 "), "gpt");
	assert.equal(suggestFamilyId(""), undefined);
	assert.equal(suggestedFamilyLabel("gpt"), "GPT");
	assert.equal(suggestedFamilyLabel("claude"), "Claude");
	assert.equal(suggestedFamilyLabel("hunyuan"), "混元");
	assert.equal(suggestedFamilyLabel("mistral"), "Mistral");
	assert.equal(suggestedFamilyLabel("step"), "Step");
});
