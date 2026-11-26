import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleSystemPrompt, describePromptSections, measurePrompt } from "../src/chat/systemPrompt";

test("estimates mixed-script tokens and counts Unicode characters", () => {
	assert.deepEqual(measurePrompt(""), { characters: 0, tokens: 0 });
	assert.deepEqual(measurePrompt("abcd"), { characters: 4, tokens: 1 });
	assert.deepEqual(measurePrompt("abcd中文𠮷"), { characters: 7, tokens: 4 });
	assert.deepEqual(measurePrompt("one\n🙂"), { characters: 5, tokens: 2 });
});

test("assembles sections in pi's recorded order without duplicating their tags", () => {
	const sections = [
		{ name: "preamble", text: "Role\nSecond line" },
		{ name: "rules", text: "<rules>\r\nUse the tools.\r\n</rules>" },
		{ name: "addendum", text: "Extra instructions" },
		{ name: "project_context", text: "<project_instructions>File</project_instructions>" },
		{ name: "new-section", text: "Future section" },
		{ name: "cwd", text: "" },
	];
	const full = "Role\nSecond line\n\n<rules>\r\nUse the tools.\r\n</rules>\n\n<addendum>\nExtra instructions\n</addendum>\n\n<project_context>\n<project_instructions>File</project_instructions>\n</project_context>\n\n<new-section>\nFuture section\n</new-section>";
	assert.equal(assembleSystemPrompt({ content: "", sections }), full);
	assert.equal(assembleSystemPrompt({ content: full + "\n", sections }), full + "\n");
	const original = sections.map(({ text }) => text).filter(Boolean).join("\n\n");
	assert.equal(assembleSystemPrompt({ content: original, sections }), original);
	assert.equal(assembleSystemPrompt({ content: "Supplement", sections }), "Supplement\n\n" + full);
	assert.equal(assembleSystemPrompt({ content: "Opaque prompt\n\n", sections: [] }), "Opaque prompt\n\n");
	assert.equal(assembleSystemPrompt({ content: "", sections: [] }), "");
});

test("describes known and future section names and computes exact proportions", () => {
	const [known, unknown, empty] = describePromptSections([
		{ name: "rules", text: "规则" },
		{ name: "constructor", text: "instruction!" },
		{ name: "cwd", text: "" },
	]);
	assert.equal(known.label, "行为规则");
	assert.equal(known.tone, "rules");
	assert.equal(known.share, 2 / 14);
	assert.equal(unknown.label, "constructor");
	assert.equal(unknown.tone, "neutral");
	assert.equal(empty.share, 0);
	assert.equal(empty.label, "工作目录");
	assert.equal(empty.tone, "neutral");
	assert.equal(describePromptSections([{ name: "cwd", text: "" }])[0].share, 0);
});
