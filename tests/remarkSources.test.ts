import test from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Link, Nodes } from "mdast";
import { remarkSources } from "../src/chat/remarkSources.ts";

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkSources, { enabled: true });

function parse(source: string) {
	return processor.runSync(processor.parse(source), { value: source });
}

const classNameOf = (node: Nodes) => {
	const value = (node as { data?: { hProperties?: { className?: string | string[] } } }).data?.hProperties?.className;
	return Array.isArray(value) ? value.join(" ") : value ?? "";
};
const hasClass = (node: Nodes, name: string) => classNameOf(node).split(/\s+/).includes(name);

function find(node: Nodes, match: (node: Nodes) => boolean): Nodes[] {
	const hits = match(node) ? [node] : [];
	return "children" in node ? [...hits, ...node.children.flatMap((child) => find(child, match))] : hits;
}

const textOf = (node: Nodes): string => "value" in node && typeof node.value === "string" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";
const pills = (tree: Nodes) => find(tree, (node) => hasClass(node, "sources-bento")).length;
const badges = (tree: Nodes) => find(tree, (node) => node.type === "link" && hasClass(node, "citation-badge")).length;
const cards = (tree: Nodes) => find(tree, (node) => hasClass(node, "source-card")).map((node) => (node as { data?: { hProperties?: { href?: string } } }).data?.hProperties?.href ?? "");

test("a labelled link cut by the stream never flashes as a source", () => {
	const reply = "来源：[新浪财经日报](https://finance.sina.com.cn/stock/jsy/2026-11-25/doc-inhpefhh4217835.shtml)、[东方财富报刊头条](https://finance.eastmoney.com/a/202611253154882184.html) 和 [澎湃快讯](https://www.thepaper.cn/expressNews)";
	for (let end = 1; end <= reply.length; end++) {
		const prefix = reply.slice(0, end);
		const tree = parse(prefix);
		assert.equal(pills(tree), 0, `流式前缀 ${end} 出现了来源胶囊：${prefix}`);
		assert.equal(badges(tree), 0, `流式前缀 ${end} 出现了引用角标：${prefix}`);
	}
});

test("the cut really reads as a bare-URL lookalike before it is filtered", () => {
	const tree = parse("来源：[新浪财经日报](https://finance.sina.com.cn/stock");
	const links = find(tree, (node) => node.type === "link") as Link[];
	assert.equal(links.length, 1);
	assert.equal(textOf(links[0]), links[0].url, "半开链接被 GFM 解析成裸 URL");
	assert.equal(pills(tree), 0);
	assert.equal(badges(tree), 0);
});

test("an unclosed link keeps its target out of the sources even across a line break", () => {
	for (const source of [
		"参考：[指南](https://example.org/guide",
		"参考：[指南](https://example.org/a_(b",
		"参考：[指南](\nhttps://example.org/guide",
	]) assert.equal(pills(parse(source)), 0, source);
});

test("a bare link stays collected for the rest of the stream", () => {
	const reply = "官方文档 https://owasp.org/www-project-top-ten/ 与日志 https://example.com/docs/a";
	let collected = false;
	for (let end = 1; end <= reply.length; end++) {
		const has = pills(parse(reply.slice(0, end))) > 0;
		if (collected) assert.equal(has, true, `来源胶囊在第 ${end} 个字符后消失`);
		collected = has;
	}
	assert.equal(collected, true, "完整回复应当保留来源胶囊");
});

test("labelled links keep their words and only bare URLs become sources", () => {
	const tree = parse("参考：[指南](https://example.org/guide)、[报告](https://example.org/report) 与 https://example.com/docs");
	assert.equal(pills(tree), 1);
	assert.equal(badges(tree), 1);
	assert.deepEqual(cards(tree), ["https://example.com/docs"]);
	assert.deepEqual(find(tree, (node) => node.type === "link" && (node as Link).url === "https://example.org/guide").map((node) => hasClass(node, "citation-badge")), [false]);
});

test("a bare link inside ordinary parentheses is still a source", () => {
	for (const reply of ["（https://example.com/docs）", "(见 https://example.com/docs)", "- 条目 https://example.com/docs", "[1] 参考 https://example.com/docs"]) {
		assert.equal(pills(parse(reply)), 1, reply);
	}
});
