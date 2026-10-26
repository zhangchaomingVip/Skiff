import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSearchDetails } from "../src/chat/toolDetails";

// 扩展是可被 pi 直接加载的 ESM 源码，用路径变量动态导入以避免类型声明约束。
const extensionUrl = new URL("../src-tauri/src/pi_extensions/web_search.js", import.meta.url).href;
const { default: setup } = (await import(extensionUrl)) as { default: (pi: unknown) => void };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "skiff-web-search-"));

interface Captured {
	url: string;
	body: Record<string, unknown>;
}

interface WebSearchTool {
	promptGuidelines?: string[];
	parameters: {
		properties: Record<string, unknown>;
		required: string[];
		additionalProperties: boolean;
	};
	execute: (
		id: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

/** 写入 skiff-web-search.json 并把 PI_CODING_AGENT_DIR 指过去，隔离真实配置。 */
function configure(config: Record<string, unknown>) {
	const dir = fs.mkdtempSync(path.join(root, `case-${Date.now()}-`));
	fs.writeFileSync(path.join(dir, "skiff-web-search.json"), JSON.stringify(config), "utf8");
	process.env.PI_CODING_AGENT_DIR = dir;
}

function stubFetch(payload: unknown): Captured[] {
	const calls: Captured[] = [];
	globalThis.fetch = (async (url: string, init: { body: string }) => {
		calls.push({ url: String(url), body: JSON.parse(init.body) });
		return {
			ok: true,
			status: 200,
			json: async () => payload,
			text: async () => "",
		};
	}) as unknown as typeof fetch;
	return calls;
}

interface Extension {
	tools: Record<string, WebSearchTool>;
	hooks: Record<string, () => void>;
	active: string[];
	setActiveCalls: string[][];
}

/** 模拟 pi 的注册面：捕获工具、命令、事件钩子，并维护一份可变的 activeTools。 */
function loadExtension(): Extension {
	const tools: Record<string, WebSearchTool> = {};
	const hooks: Record<string, () => void> = {};
	const active = ["read", "web_search"];
	const setActiveCalls: string[][] = [];
	setup({
		registerTool(definition: WebSearchTool) {
			tools[definition.name] = definition;
		},
		registerCommand() {},
		on(name: string, handler: () => void) {
			hooks[name] = handler;
		},
		getActiveTools: () => [...active],
		setActiveTools(next: string[]) {
			setActiveCalls.push([...next]);
			active.splice(0, active.length, ...next);
		},
	});
	return { tools, hooks, active, setActiveCalls };
}

function loadTool(): WebSearchTool {
	const tool = loadExtension().tools.web_search;
	if (!tool) throw new Error("extension did not register web_search");
	return tool;
}

const results = {
	answer: "摘要内容",
	results: [{ title: "Post", url: "https://x.com/someone/status/1", content: "内容" }],
};

// 环境变量优先级高于配置文件，先清掉避免本机环境影响断言。
delete process.env.TAVILY_API_KEY;
delete process.env.EXA_API_KEY;

test("web_search declares domain and time filters instead of rejecting them", () => {
	const tool = loadTool();
	assert.deepEqual(tool.parameters.required, ["query"]);
	assert.equal(tool.parameters.additionalProperties, false);
	assert.ok(tool.parameters.properties.include_domains);
	assert.ok(tool.parameters.properties.exclude_domains);
	assert.ok(tool.parameters.properties.time_range);
});

test("tavily maps domains and time_range onto its own request fields", async () => {
	configure({ provider: "tavily", apiKey: "tvly-test", maxResults: 3 });
	const calls = stubFetch(results);
	const tool = loadTool();

	const output = await tool.execute("call-1", {
		query: "skiff 更新",
		include_domains: ["https://X.com/someone/status/1", "www.x.com"],
		exclude_domains: "pinterest.com",
		time_range: "Day",
		max_results: 99,
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://api.tavily.com/search");
	assert.deepEqual(calls[0].body.include_domains, ["x.com", "www.x.com"]);
	assert.deepEqual(calls[0].body.exclude_domains, ["pinterest.com"]);
	assert.equal(calls[0].body.time_range, "day");
	assert.equal(calls[0].body.max_results, 10);
	assert.equal(calls[0].body.api_key, "tvly-test");
	assert.match(output.content[0].text, /^摘要（Tavily 模型聚合，数字请回原文核对）：摘要内容/);
	assert.deepEqual(output.details.includeDomains, ["x.com", "www.x.com"]);
	assert.equal(output.details.timeRange, "day");
	assert.equal(output.details.provider, "tavily");
});

test("unknown or missing filters stay out of the request", async () => {
	configure({ provider: "tavily", tavilyApiKey: "tvly-test", maxResults: 4 });
	const calls = stubFetch({ results: [] });
	const tool = loadTool();

	await tool.execute("call-2", { query: "docs", time_range: "decade", include_domains: [] });

	assert.equal("include_domains" in calls[0].body, false);
	assert.equal("exclude_domains" in calls[0].body, false);
	assert.equal("time_range" in calls[0].body, false);
	assert.equal(calls[0].body.max_results, 4);
});

test("exa converts time_range into startPublishedDate and keeps its own domain fields", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test", maxResults: 2 });
	const calls = stubFetch({ results: [{ title: "Doc", url: "https://docs.example.com/a", text: "正文" }] });
	const tool = loadTool();

	const before = Date.now();
	const output = await tool.execute("call-3", {
		query: "release notes",
		include_domains: ["docs.example.com"],
		exclude_domains: ["spam.example.com"],
		time_range: "week",
	});

	assert.equal(calls[0].url, "https://api.exa.ai/search");
	assert.deepEqual(calls[0].body.includeDomains, ["docs.example.com"]);
	assert.deepEqual(calls[0].body.excludeDomains, ["spam.example.com"]);
	assert.equal("include_domains" in calls[0].body, false);
	const start = Date.parse(String(calls[0].body.startPublishedDate));
	assert.ok(Number.isFinite(start), "startPublishedDate must be an ISO timestamp");
	const week = 7 * 86_400_000;
	assert.ok(Math.abs(before - week - start) < 60_000, "startPublishedDate must be one week back");
	assert.equal(output.details.provider, "exa");
	assert.equal(output.details.timeRange, "week");
	assert.match(output.content[0].text, /### Doc\nhttps:\/\/docs\.example\.com\/a\n正文/);
});

test("exa prefers highlights, falls back to text and surfaces publishedDate when present", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test", maxResults: 5 });
	const calls = stubFetch({
		results: [
			{ title: "长文", url: "https://docs.example.com/long", highlights: ["相关段落", "另一段"], text: "整页开头", publishedDate: "2026-10-22T00:00:00.000Z" },
			{ title: "无摘录", url: "https://docs.example.com/short", text: "兜底正文" },
		],
	});
	const tool = loadTool();

	const output = await tool.execute("call-3b", { query: "release notes" });
	assert.deepEqual(calls[0].body.contents, { highlights: true, text: { maxCharacters: 1000 } });
	const text = output.content[0].text;
	assert.match(text, /### 长文 · 2026-10-22\nhttps:\/\/docs\.example\.com\/long\n相关段落 … 另一段/);
	assert.match(text, /### 无摘录\nhttps:\/\/docs\.example\.com\/short\n兜底正文/);
});

test("page-level ### headings are demoted so they cannot pass as result delimiters", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test" });
	stubFetch({
		results: [
			{ title: "长文", url: "https://docs.example.com/long", highlights: ["### 第 1 节\n正文"] },
			{ title: "代码页", url: "https://docs.example.com/code", highlights: ["```md\n### 代码里的示例\n```"] },
		],
	});
	const tool = loadTool();

	const text = (await tool.execute("call-3c", { query: "docs" })).content[0].text;
	assert.match(text, /^### 长文\nhttps:\/\/docs\.example\.com\/long\n#### 第 1 节\n正文/);
	assert.match(text, /```md\n### 代码里的示例\n```/, "fenced samples keep their original heading level");
	const parsed = parseSearchDetails(text);
	assert.equal(parsed.results.length, 2, "page headings must not split into extra result cards");
	assert.equal(parsed.results[0].content, "#### 第 1 节\n正文");
});

test("excerpts truncated inside a code block neither swallow headings nor merge later results", async () => {
	configure({ provider: "tavily", apiKey: "tvly-test" });
	stubFetch({
		results: [
			{ title: "TS", url: "https://example.com/ts", content: "前言\n\n```\n\nconst user = { …\n\n### Safety at Scale\n\n正文" },
			{ title: "B", url: "https://example.com/b", content: "~~~\n### 未闭合的示例\n\n### 第二节" },
		],
	});
	const tool = loadTool();

	const text = (await tool.execute("call-3e", { query: "typescript" })).content[0].text;
	assert.doesNotMatch(text, /^\s*(?:```|~~~)\s*$/m, "unpaired fence markers are dropped");
	assert.match(text, /#### Safety at Scale/, "headings after a truncated code block are still demoted");
	assert.match(text, /#### 第二节/);
	const parsed = parseSearchDetails(text);
	assert.equal(parsed.results.length, 2, "a dangling fence must not merge the remaining results");
	assert.match(parsed.results[0].content, /#### Safety at Scale/);
	assert.match(parsed.results[1].content, /#### 第二节/);
});

test("tavily excerpts are demoted the same way and its answer is labelled as model aggregation", async () => {
	configure({ provider: "tavily", apiKey: "tvly-test" });
	stubFetch({ answer: "营收 962 亿", results: [{ title: "财报", url: "https://example.com/report", content: "### 财务摘要\n正文" }] });
	const tool = loadTool();

	const text = (await tool.execute("call-3d", { query: "财报" })).content[0].text;
	assert.match(text, /^摘要（Tavily 模型聚合，数字请回原文核对）：营收 962 亿/);
	assert.match(text, /### 财报\nhttps:\/\/example\.com\/report\n#### 财务摘要\n正文/);
});

test("exa rejects X domains with an actionable message instead of returning zero hits", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test" });
	const calls = stubFetch({ results: [] });
	const tool = loadTool();

	await assert.rejects(
		() => tool.execute("call-4", { query: "skiff", include_domains: ["https://x.com/home"], time_range: "day" }),
		/Exa 无法搜索 X（Twitter）内容/,
	);
	assert.equal(calls.length, 0);
});

test("X searches without a time window carry a stale-result notice", async () => {
	configure({ provider: "tavily", apiKey: "tvly-test" });
	stubFetch(results);
	const tool = loadTool();

	const output = await tool.execute("call-5", { query: "skiff", include_domains: ["x.com"] });
	assert.match(output.content[0].text, /^提示：本次未限定时间范围/);
	assert.equal(output.details.timeRange, "");

	const narrowed = await tool.execute("call-6", { query: "skiff", include_domains: ["x.com"], time_range: "day" });
	assert.doesNotMatch(narrowed.content[0].text, /提示：/);
});

test("environment keys win over stored ones and unknown providers fall back to tavily", async () => {
	configure({ provider: "bing", apiKey: "tvly-stored" });
	process.env.TAVILY_API_KEY = "tvly-env";
	try {
		const calls = stubFetch(results);
		const tool = loadTool();
		await tool.execute("call-7", { query: "docs" });
		assert.equal(calls[0].url, "https://api.tavily.com/search");
		assert.equal(calls[0].body.api_key, "tvly-env");
	} finally {
		delete process.env.TAVILY_API_KEY;
	}
});

test("prompt guidance stays minimal; rules live in descriptions and runtime checks", () => {
	const ext = loadExtension();
	// 只允许一条聚合提醒：时效/摘要需要回原文核对。其余细节不应再堆规则。
	assert.equal((ext.tools.web_search.promptGuidelines ?? []).length, 1);
	assert.match(ext.tools.web_search.promptGuidelines?.[0] ?? "", /time_range/);
	assert.equal((ext.tools.read_url.promptGuidelines ?? []).length, 0, "read_url should rely on its description only");
});

test("read_url is registered with an http-only url parameter", () => {
	const tool = loadExtension().tools.read_url;
	assert.ok(tool, "read_url must be registered");
	assert.deepEqual(tool.parameters.required, ["url"]);
	assert.equal(tool.parameters.additionalProperties, false);
	assert.ok(tool.parameters.properties.max_chars);
	assert.ok(tool.parameters.properties.fresh);
});

test("read_url reads one page through Exa contents and renders it like a search hit", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test" });
	const calls = stubFetch({
		results: [{ id: "https://docs.example.com/a", title: "Docs", url: "https://docs.example.com/a", author: "Skiff", text: "### 小节\n正文" }],
		statuses: [{ id: "https://docs.example.com/a", status: "success", source: "cached" }],
	});
	const tool = loadExtension().tools.read_url;

	const output = await tool.execute("read-1", { url: "  https://docs.example.com/a  " });
	assert.equal(calls[0].url, "https://api.exa.ai/contents");
	assert.deepEqual(calls[0].body, { ids: ["https://docs.example.com/a"], text: { maxCharacters: 12000 } });
	assert.equal("maxAgeHours" in calls[0].body, false, "cached reads must not force a crawl");
	assert.match(output.content[0].text, /^### Docs\nhttps:\/\/docs\.example\.com\/a\n作者：Skiff\n\n#### 小节\n正文/);
	assert.equal(output.details.provider, "exa");
	assert.equal(output.details.url, "https://docs.example.com/a");
	assert.equal(output.details.truncated, false);
	assert.equal(output.details.fresh, false);
	assert.equal(output.details.source, "cached");
});

test("read_url honours max_chars, fresh and the truncation notice", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test" });
	const calls = stubFetch({
		results: [{ title: "长页", url: "https://docs.example.com/long", text: "字".repeat(600) }],
		statuses: [{ status: "success", source: "crawled" }],
	});
	const tool = loadExtension().tools.read_url;

	const output = await tool.execute("read-2", { url: "https://docs.example.com/long", max_chars: 500, fresh: true });
	assert.equal(calls[0].body.maxAgeHours, 0);
	assert.deepEqual(calls[0].body.text, { maxCharacters: 500 });
	assert.match(output.content[0].text, /正文已截断到 500 字符/);
	assert.equal(output.details.truncated, true);
	assert.equal(output.details.fresh, true);
	assert.equal(output.details.source, "crawled");
});

test("read_url reports Exa crawl failures", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test" });
	stubFetch({ results: [], statuses: [{ id: "https://bad.example", status: "error", error: { httpStatusCode: 500, tag: "CRAWL_UNKNOWN_ERROR" } }] });
	await assert.rejects(
		() => loadExtension().tools.read_url.execute("read-3", { url: "https://bad.example" }),
		/页面无法访问/,
	);
});

test("read_url reads through Tavily extract when tavily is the active engine", async () => {
	configure({ provider: "tavily", tavilyApiKey: "tvly-test" });
	const calls = stubFetch({
		results: [{ url: "https://docs.example.com/a", title: "Docs", raw_content: "字".repeat(900), images: [] }],
		failed_results: [],
	});
	const tool = loadExtension().tools.read_url;

	const output = await tool.execute("read-4", { url: "https://docs.example.com/a", max_chars: 500, fresh: true });
	assert.equal(calls[0].url, "https://api.tavily.com/extract");
	assert.deepEqual(calls[0].body, { api_key: "tvly-test", urls: ["https://docs.example.com/a"], extract_depth: "basic", format: "markdown" });
	assert.equal(output.details.provider, "tavily");
	assert.equal(output.details.source, "live");
	assert.equal(output.details.fresh, false, "fresh is an Exa-only cache control");
	assert.equal(output.details.truncated, true);
	assert.equal(output.details.chars, 500, "tavily pages are truncated locally");
	assert.match(output.content[0].text, /正文已截断到 500 字符/);
});

test("read_url turns Tavily extract failures into readable errors", async () => {
	configure({ provider: "tavily", tavilyApiKey: "tvly-test" });
	stubFetch({ results: [], failed_results: [{ url: "https://bad.example", error: "Failed to fetch url" }] });
	await assert.rejects(
		() => loadExtension().tools.read_url.execute("read-5", { url: "https://bad.example" }),
		/页面无法访问/,
	);
});

test("read_url rejects non-http urls and credential-bearing links without a request", async () => {
	configure({ provider: "exa", exaApiKey: "exa-test" });
	const calls = stubFetch({ results: [] });
	const tool = loadExtension().tools.read_url;

	for (const url of ["file:///C:/secret.txt", "javascript:alert(1)", "https://user:pass@example.com/a", "not a url", ""]) {
		await assert.rejects(() => tool.execute("read-5", { url }));
	}
	assert.equal(calls.length, 0);
});

test("read_url follows the settings switch on both engines", () => {
	configure({ provider: "exa", exaApiKey: "exa-test", readUrlEnabled: true });
	const ext = loadExtension();
	ext.hooks.before_agent_start();
	assert.deepEqual(ext.active, ["read", "read_url"]);

	configure({ provider: "tavily", tavilyApiKey: "tvly-test", readUrlEnabled: true });
	ext.hooks.before_agent_start();
	assert.deepEqual(ext.active, ["read", "read_url"], "tavily has its own read endpoint");

	configure({ provider: "tavily", tavilyApiKey: "tvly-test", readUrlEnabled: false });
	ext.hooks.before_agent_start();
	assert.deepEqual(ext.active, ["read"]);

	configure({ provider: "exa", readUrlEnabled: true });
	ext.hooks.before_agent_start();
	assert.deepEqual(ext.active, ["read"], "no key for the active engine means no read_url");
});
