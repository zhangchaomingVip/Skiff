import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleSystemPrompt, describePromptSections, layoutPromptTreemap, measurePrompt } from "../src/chat/systemPrompt";

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
	assert.equal(known.share, 2 / 14);
	assert.equal(unknown.label, "constructor");
	assert.equal(unknown.tone, "neutral");
	assert.equal(empty.share, 0);
	assert.equal(describePromptSections([{ name: "cwd", text: "" }])[0].share, 0);
});

test("treemap lays out descending, proportional, disjoint tiles at different widths", () => {
	const sections = [33, 980, 190, 1, 17, 0, 6].map((characters) => ({ characters }));
	const total = 1227;
	const epsilon = 1e-7;
	for (const width of [160, 360, 800]) {
		const height = 128;
		const tiles = layoutPromptTreemap(sections, width, height);
		assert.deepEqual(tiles.map(({ section }) => section.characters), [980, 190, 33, 17, 6, 1]);
		assert.equal(tiles[0].rect.x, 0);
		for (const [index, { section, rect }] of tiles.entries()) {
			assert.ok(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0);
			assert.ok(rect.x + rect.width <= width + epsilon && rect.y + rect.height <= height + epsilon);
			assert.ok(Math.abs(rect.width * rect.height - width * height * section.characters / total) < epsilon);
			for (const { rect: other } of tiles.slice(index + 1)) {
				assert.ok(rect.x + rect.width <= other.x + epsilon || other.x + other.width <= rect.x + epsilon
					|| rect.y + rect.height <= other.y + epsilon || other.y + other.height <= rect.y + epsilon);
			}
		}
	}
	assert.deepEqual(layoutPromptTreemap([{ characters: 0 }], 100, 128), []);
	assert.deepEqual(layoutPromptTreemap(sections, 0, 128), []);
	assert.deepEqual(layoutPromptTreemap([{ characters: 8 }], 500, 128)[0].rect, { x: 0, y: 0, width: 500, height: 128 });
});
