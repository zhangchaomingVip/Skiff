import test from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes } from "mdast";
import { remarkLooseStrong } from "../src/chat/remarkLooseStrong.ts";

function parse(source: string) {
	const processor = unified().use(remarkParse).use(remarkGfm).use(remarkLooseStrong);
	return processor.runSync(processor.parse(source), { value: source });
}

function values(node: Nodes, type: string): string[] {
	const text = (node: Nodes): string => "value" in node ? node.value : "children" in node ? node.children.map(text).join("") : "";
	return node.type === type ? [text(node)] : "children" in node ? node.children.flatMap((child) => values(child, type)) : [];
}

test("repairs Chinese bold with trailing spaces and full-width punctuation boundaries", () => {
	for (const source of [
		"根据预报，**北京明天（10月30日，周五）**天气如下：",
		"根据预报，**北京明天（10月30日，周五） **天气如下：",
		"根据预报，**北京明天（10月30日，周五）　**天气如下：",
	]) {
		const tree = parse(source);
		assert.deepEqual(values(tree, "strong"), ["北京明天（10月30日，周五）"]);
		assert(!values(tree, "text").join("").includes("**"));
	}
});

test("repairs multiple spans and list/table text without changing valid emphasis or links", () => {
	const tree = parse("**说明 ** 和 **正常** [链接](https://example.com/a**b)\n\n- **天气（晴）**适宜外出\n\n| 事项 |\n| --- |\n| **结果 ** |");
	assert.deepEqual(values(tree, "strong"), ["说明", "正常", "天气（晴）", "结果"]);
	const link = tree.children[0];
	assert(link.type === "paragraph" && link.children.some((node) => node.type === "link" && node.url === "https://example.com/a**b"));
});

test("preserves code, escaped stars and intentionally literal entities", () => {
	const source = "`**北京 **`\n\n```md\n**北京 **\n```\n\n    **北京 **\n\n\\*\\*北京 **\n\n&#42;&#42;北京 **";
	const tree = parse(source);
	assert.deepEqual(values(tree, "strong"), []);
	assert.deepEqual(values(tree, "inlineCode"), ["**北京 **"]);
	assert.deepEqual(values(tree, "code"), ["**北京 **", "**北京 **"]);
});

test("does not invent a closing delimiter during streaming or cross paragraph boundaries", () => {
	for (const source of ["**北京", "**北京 *", "**北京\n\n明天 **", "** **", "***"]) assert.deepEqual(values(parse(source), "strong"), []);
	assert.deepEqual(values(parse("**北京 **"), "strong"), ["北京"]);
});
