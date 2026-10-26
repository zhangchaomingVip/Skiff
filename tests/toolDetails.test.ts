import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchDetails, searchSource } from "../src/chat/toolDetails";

test("web search separates the answer and real sources while preserving excerpt headings, dates and quotes", () => {
	const details = parseSearchDetails("摘要：版本更新导语\r\n\r\n### Docker release notes | Docs\r\nhttps://docs.docker.com/desktop/release-notes\r\n## 4.43.0\r\n2025-07-03\r\n> Download Docker Desktop\r\n\r\n### Another source\r\nhttps://example.org/news\r\n**News**");
	assert.equal(details.intro, "版本更新导语");
	assert.equal(details.results.length, 2);
	assert.deepEqual(details.results[0], { title: "Docker release notes | Docs", url: "https://docs.docker.com/desktop/release-notes", source: "docs.docker.com", content: "## 4.43.0\n2025-07-03\n> Download Docker Desktop" });
	assert.equal(details.results[1].content, "**News**");
});

test("source-like code examples remain part of the excerpt", () => {
	const details = parseSearchDetails("### Source\nhttps://example.org\n```md\n### Example\nhttps://example.net\n```\n### Real second source\nhttps://example.com\nExcerpt");
	assert.equal(details.results.length, 2);
	assert.match(details.results[0].content, /### Example\nhttps:\/\/example.net/);
});

test("aggregated answer prefixes are stripped and demoted excerpt headings stay inside their result", () => {
	const details = parseSearchDetails("摘要（Tavily 模型聚合，数字请回原文核对）：营收 962 亿\r\n\r\n### 财报\r\nhttps://example.com/report\r\n#### 财务摘要\r\n正文");
	assert.equal(details.intro, "营收 962 亿");
	assert.equal(details.results.length, 1);
	assert.equal(details.results[0].content, "#### 财务摘要\n正文");
});

test("incomplete or unrecognized search output remains readable and empty results have no invented sources", () => {
	for (const text of ["没有找到相关结果。", "### Still streaming", "", "Search service unavailable"]) {
		assert.deepEqual(parseSearchDetails(text), { intro: text, results: [] });
	}
	assert.equal(parseSearchDetails("### Source\nhttps://example.org").results[0].content, "");
});

test("search navigation rejects executable, local and credential-bearing URLs", () => {
	for (const url of ["javascript:alert(1)", "data:text/html,bad", "file:///C:/file", "https://user:password@example.org", "not a url", "/relative"]) {
		assert.equal(searchSource(url), undefined);
		assert.equal(parseSearchDetails(`### Unsafe\n${url}\nExcerpt`).results.length, 0);
	}
	assert.equal(searchSource("https://example.org/page?q=hello"), "example.org");
	assert.equal(searchSource("http://localhost:8080/page"), "localhost");
});
