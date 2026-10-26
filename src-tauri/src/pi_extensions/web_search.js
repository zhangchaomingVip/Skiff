/**
 * Skiff 联网搜索扩展。
 *
 * 给 pi 注册一个联网搜索工具 `web_search`，引擎由 Skiff 写入的
 * skiff-web-search.json 里的 provider 决定（tavily 或 exa，各存各的 key），
 * 并注册 `/web on|off` 命令，让用户可以在输入框实时开关它（无需重启 pi 子进程）。
 *
 * 工具参数除 query / max_results 外，还支持限定域名（include_domains /
 * exclude_domains）与发布时间（time_range），两者按引擎翻译成各自的原生字段。
 *
 * 用户在设置里勾选「读取网页」时，额外注册 `read_url` 工具：Exa 走 Contents
 * 端点（可读缓存、可强制重抓），Tavily 走 Extract 端点（实时抓取）。
 *
 * 由 Skiff 写入 ~/.pi/agent/extensions/，升级时会被覆盖，请勿手改。
 *
 * 注意：加载阶段（factory 函数体）不允许调用 getActiveTools / setActiveTools
 * 这类 action 方法，只能在事件钩子与命令回调里调用。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOL = "web_search";
const READ_TOOL = "read_url";
const COMMAND = "web";
const KEY_FILE = "skiff-web-search.json";
const STATE_FILE = "skiff-web-search-state.json";

/** read_url 的正文上限：Exa Contents 按页计费，20k 字符实测仍是 $0.001/页。 */
const READ_MAX_CHARS = 12000;
const READ_MAX_CHARS_LIMIT = 30000;

/** time_range 取值到天数的映射；Tavily 直接收枚举值，Exa 需要换算成起始日期。 */
const TIME_RANGES = { day: 1, week: 7, month: 30, year: 365 };
const DAY_MS = 86_400_000;

/** X（Twitter）的域名。Tavily 能搜原帖，Exa 搜不到（tweet 分类已下线）。 */
function isXDomain(domain) {
	const value = String(domain ?? "").toLowerCase();
	return value === "x.com" || value === "twitter.com" || value.endsWith(".x.com") || value.endsWith(".twitter.com");
}

/**
 * 检索回来的正文本身是页面 markdown，常见 `### 小标题`。它与结果分隔符同形，
 * 会让前端和模型把页面小标题当成新的结果卡片，所以正文里的三级标题降为四级。
 *
 * 围栏（``` / ~~~）先两两配对：成对的按代码块原样保留（改标题会破坏示例），
 * 配不上的孤立刻记直接丢弃——片段常从代码块中间截断，孤立刻记会被前端当成
 * 「代码块开始」，把后面所有结果都并进同一条卡片，也会让标题漏降级。
 */
function demoteHeadings(text) {
	const lines = String(text ?? "").split("\n");
	const markers = lines.map((line) => /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "");
	const fenced = new Set();
	let opened = -1;
	for (let i = 0; i < lines.length; i++) {
		if (!markers[i]) continue;
		if (opened < 0) {
			opened = i;
			continue;
		}
		if (markers[i][0] === markers[opened][0] && markers[i].length >= markers[opened].length) {
			for (let j = opened; j <= i; j++) fenced.add(j);
			opened = -1;
		}
	}
	const kept = [];
	for (let i = 0; i < lines.length; i++) {
		// 落单的围栏标记本身也不留，否则前端解析器会一直卡在代码块里。
		if (markers[i] && !fenced.has(i)) continue;
		const line = lines[i];
		kept.push(!fenced.has(i) && /^###\s/.test(line) ? `####${line.slice(3)}` : line);
	}
	return kept.join("\n");
}

/**
 * 引擎分发表：每个引擎声明环境变量名、配置字段、请求构造和结果格式化。
 * 格式化输出必须保持「### 标题 / URL / 摘要」的形状，Skiff 前端按它渲染结果卡片。
 */
const PROVIDERS = {
	tavily: {
		label: "Tavily",
		envKey: "TAVILY_API_KEY",
		// 旧版只有一份 apiKey，归给 Tavily。
		configKeys: ["tavilyApiKey", "apiKey"],
		async search(apiKey, query, options, signal) {
			const body = {
				api_key: apiKey,
				query,
				max_results: options.maxResults,
				search_depth: "basic",
				include_answer: true,
			};
			if (options.includeDomains.length) body.include_domains = options.includeDomains;
			if (options.excludeDomains.length) body.exclude_domains = options.excludeDomains;
			if (options.timeRange) body.time_range = options.timeRange;
			const response = await fetch("https://api.tavily.com/search", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal,
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(`联网搜索失败：Tavily 返回 HTTP ${response.status} ${detail}`.trim());
			}
			const data = await response.json();
			if (!data || typeof data !== "object") throw new Error("联网搜索失败：Tavily 返回了无法解析的内容");
			return data;
		},
		format(data) {
			const blocks = [];
			// Tavily 的 answer 是它自己的模型聚合结果，单位/量级实测会串台，标清来源。
			if (typeof data.answer === "string" && data.answer.trim()) blocks.push(`摘要（Tavily 模型聚合，数字请回原文核对）：${data.answer.trim()}`);
			for (const item of Array.isArray(data.results) ? data.results : []) {
				const title = String(item?.title ?? "").trim() || "(无标题)";
				const content = demoteHeadings(String(item?.content ?? "").trim());
				blocks.push(`### ${title}\n${String(item?.url ?? "")}\n${content}`.trim());
			}
			if (!blocks.length) blocks.push("没有找到相关结果。");
			return blocks.join("\n\n");
		},
	},
	exa: {
		label: "Exa",
		envKey: "EXA_API_KEY",
		configKeys: ["exaApiKey"],
		async search(apiKey, query, options, signal) {
			const body = {
				query,
				numResults: options.maxResults,
				type: "auto",
				// 官方推荐的搜索用法：highlights 按相关度取片段（长文里能直接命中相关段落），
				// text 截断到 1000 字符作为兜底；两者一起请求实测费用不变（10 条内 $0.007）。
				contents: { highlights: true, text: { maxCharacters: 1000 } },
			};
			if (options.includeDomains.length) body.includeDomains = options.includeDomains;
			if (options.excludeDomains.length) body.excludeDomains = options.excludeDomains;
			// Exa 没有 time_range，只能按起始发布时间过滤。
			if (options.timeRange) body.startPublishedDate = new Date(Date.now() - TIME_RANGES[options.timeRange] * DAY_MS).toISOString();
			const response = await fetch("https://api.exa.ai/search", {
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": apiKey },
				body: JSON.stringify(body),
				signal,
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(`联网搜索失败：Exa 返回 HTTP ${response.status} ${detail}`.trim());
			}
			const data = await response.json();
			if (!data || typeof data !== "object") throw new Error("联网搜索失败：Exa 返回了无法解析的内容");
			return data;
		},
		format(data) {
			const blocks = [];
			for (const item of Array.isArray(data.results) ? data.results : []) {
				const title = String(item?.title ?? "").trim() || "(无标题)";
				const highlights = Array.isArray(item?.highlights) ? item.highlights.join(" … ") : "";
				const content = demoteHeadings((highlights || String(item?.text ?? "")).trim());
				// publishedDate 只有部分结果提供，有就标在标题后，便于核对时效。
				const date = item?.publishedDate ? ` · ${String(item.publishedDate).slice(0, 10)}` : "";
				blocks.push(`### ${title}${date}\n${String(item?.url ?? "")}\n${content}`.trim());
			}
			if (!blocks.length) blocks.push("没有找到相关结果。");
			return blocks.join("\n\n");
		},
	},
};

function expandHome(input) {
	const home = os.homedir();
	const value = String(input ?? "").trim();
	if (!value) return "";
	if (value === "~") return home;
	if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(home, value.slice(2));
	return value;
}

function agentDir() {
	const fromEnv = process.env.PI_CODING_AGENT_DIR;
	if (fromEnv && String(fromEnv).trim()) return expandHome(fromEnv);
	return path.join(os.homedir(), ".pi", "agent");
}

function readJson(file) {
	try {
		const parsed = JSON.parse(fs.readFileSync(path.join(agentDir(), file), "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeJson(file, patch) {
	try {
		fs.writeFileSync(path.join(agentDir(), file), `${JSON.stringify({ ...readJson(file), ...patch }, null, 2)}\n`, "utf8");
	} catch {
		// 写不进去时功能降级为「本次会话有效」，不应中断对话。
	}
}

/** 未知或缺失的 provider 一律回退到 Tavily，与 Rust 侧读取逻辑一致。 */
function readProvider() {
	const name = String(readJson(KEY_FILE).provider ?? "").trim().toLowerCase();
	return PROVIDERS[name] ? name : "tavily";
}

/** Key 优先取引擎对应的环境变量，其次是 Skiff 写入的配置文件。两者都没有就是未配置。 */
function readApiKey(provider = readProvider()) {
	const spec = PROVIDERS[provider];
	const fromEnv = process.env[spec.envKey];
	if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
	const config = readJson(KEY_FILE);
	for (const field of spec.configKeys) {
		const key = config[field];
		if (key && String(key).trim()) return String(key).trim();
	}
	return "";
}

function readMaxResults() {
	const value = Number(readJson(KEY_FILE).maxResults);
	return Number.isFinite(value) && value > 0 ? value : 5;
}

/** 「读取网页」开关，由 Skiff 设置页写入；默认关闭。 */
function readUrlEnabled() {
	return readJson(KEY_FILE).readUrlEnabled === true;
}

/** read_url 两个引擎都有对应端点，只要有当前引擎的 key 且开关打开。 */
function readUrlAvailable() {
	return readUrlEnabled() && !!readApiKey();
}

/** 只接受 http/https，且拒绝带账号密码的地址。 */
function normalizeUrl(input) {
	let url;
	try {
		url = new URL(String(input ?? "").trim());
	} catch {
		throw new Error("网页地址无效：请提供完整的 http/https 链接。");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("网页地址无效：只支持 http/https 链接。");
	if (url.username || url.password) throw new Error("网页地址无效：请去掉链接里的账号密码。");
	return url.href;
}

/** 把 Exa 的抓取错误标签翻成人能看懂的原因。 */
function crawlFailure(error) {
	const tag = typeof error?.tag === "string" ? error.tag : "";
	if (tag === "CRAWL_UNKNOWN_ERROR") return "页面无法访问（域名不存在、需要登录或被反爬拦截）";
	if (tag === "CRAWL_NOT_FOUND") return "页面不存在";
	if (/TIMEOUT/i.test(tag)) return "抓取超时，稍后重试或改用 fresh=false 读取缓存";
	const detail = [tag, error?.httpStatusCode ? `HTTP ${error.httpStatusCode}` : ""].filter(Boolean).join(" / ");
	return detail ? `抓取失败（${detail}）` : "抓取失败";
}

/**
 * Exa 的 Contents 端点：`ids` 是要读的 URL（不是搜索词），一次拿正文。
 * livecrawl 已废弃，Exa 要求改用 maxAgeHours：0 = 强制重新抓取，缺省 = 用缓存。
 */
async function exaContents(apiKey, url, options, signal) {
	const body = { ids: [url], text: { maxCharacters: options.maxChars } };
	if (options.fresh) body.maxAgeHours = 0;
	const response = await fetch("https://api.exa.ai/contents", {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": apiKey },
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`读取网页失败：Exa 返回 HTTP ${response.status} ${detail}`.trim());
	}
	const data = await response.json();
	if (!data || typeof data !== "object") throw new Error("读取网页失败：Exa 返回了无法解析的内容");
	const status = Array.isArray(data.statuses) ? data.statuses[0] : undefined;
	// 抓取失败时 Exa 仍返回 200，错误只在 statuses 里。
	if (status && status.status !== "success") throw new Error(`读取网页失败：${crawlFailure(status.error)}`);
	const page = Array.isArray(data.results) ? data.results[0] : undefined;
	if (!page) throw new Error("读取网页失败：Exa 没有返回正文（页面可能需要登录或被反爬拦截）。");
	return { page, source: typeof status?.source === "string" ? status.source : "" };
}

/** Tavily Extract 的失败原因都是英文短句，翻译成可读结论。 */
function extractFailure(error) {
	const text = String(error ?? "").trim();
	if (/unauthori[sz]ed|invalid api key/i.test(text)) return "API Key 无效或无权读取网页";
	if (/failed to fetch|unable to (?:fetch|access)/i.test(text)) return "页面无法访问（域名不存在、需要登录或被反爬拦截）";
	if (/404|not found/i.test(text)) return "页面不存在";
	return text ? `抓取失败（${text}）` : "抓取失败";
}

/**
 * Tavily 的 Extract 端点：`urls` 是要读的页面，format=markdown 直接给可读正文。
 * 它每次都是实时抓取，没有缓存概念，因此 fresh 参数在这里没有意义。
 */
async function tavilyExtract(apiKey, url, signal) {
	const response = await fetch("https://api.tavily.com/extract", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ api_key: apiKey, urls: [url], extract_depth: "basic", format: "markdown" }),
		signal,
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`读取网页失败：Tavily 返回 HTTP ${response.status} ${detail}`.trim());
	}
	const data = await response.json();
	if (!data || typeof data !== "object") throw new Error("读取网页失败：Tavily 返回了无法解析的内容");
	// 抓取失败时 Tavily 仍返回 200，错误只在 failed_results 里。
	const failed = Array.isArray(data.failed_results) ? data.failed_results[0] : undefined;
	if (failed) throw new Error(`读取网页失败：${extractFailure(failed.error)}`);
	const page = Array.isArray(data.results) ? data.results[0] : undefined;
	if (!page) throw new Error("读取网页失败：Tavily 没有返回正文（页面可能需要登录或被反爬拦截）。");
	return { page: { url: page.url, title: page.title, text: page.raw_content }, source: "live" };
}

/** 读取网页按引擎分发：Exa 走 Contents（可读缓存），Tavily 走 Extract（实时抓取）。 */
async function readPage(provider, apiKey, url, options, signal) {
	return provider === "exa" ? exaContents(apiKey, url, options, signal) : tavilyExtract(apiKey, url, signal);
}

/** 把 `https://x.com/foo`、`www.x.com` 这类写法收敛成 `x.com`，并去重。 */
function normalizeDomains(input) {
	if (input == null) return [];
	const list = Array.isArray(input) ? input : [input];
	const domains = [];
	for (const entry of list) {
		const value = String(entry ?? "")
			.trim()
			.toLowerCase()
			.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
			.split(/[/?#]/)[0]
			.replace(/^\.+|\.+$/g, "");
		if (value && !domains.includes(value)) domains.push(value);
	}
	return domains;
}

function normalizeTimeRange(input) {
	const value = String(input ?? "").trim().toLowerCase();
	return TIME_RANGES[value] ? value : "";
}

/** 把模型给的参数收敛成一次请求的形状；不认识的值直接忽略而不是报错。 */
function resolveOptions(params) {
	const fallback = readMaxResults();
	const requested = Number(params?.max_results);
	return {
		maxResults: Math.min(10, Math.max(1, Number.isFinite(requested) && requested > 0 ? requested : fallback)),
		includeDomains: normalizeDomains(params?.include_domains),
		excludeDomains: normalizeDomains(params?.exclude_domains),
		timeRange: normalizeTimeRange(params?.time_range),
	};
}

/**
 * Exa 侧的前置检查：官方的 tweet 分类已下线，includeDomains 里带 x.com 只会返回 0 条，
 * 与其给出「没有找到相关结果」，不如直接告诉模型换引擎或去掉域名限制。
 */
function assertEngineCanSearch(spec, provider, options) {
	if (provider !== "exa") return;
	const blocked = options.includeDomains.filter(isXDomain);
	if (!blocked.length) return;
	throw new Error(
		`联网搜索失败：${spec.label} 无法搜索 X（Twitter）内容（${blocked.join("、")} 只会返回 0 条，tweet 分类已下线）。请去掉域名限制，或改用 Tavily 引擎搜索 X。`,
	);
}

/** 限定 X 却没限时间时，提醒模型结果可能是旧推文。 */
function searchNotice(provider, options) {
	if (options.timeRange) return "";
	if (provider !== "tavily") return "";
	if (!options.includeDomains.some(isXDomain)) return "";
	return "提示：本次未限定时间范围，X 的搜索结果可能包含较早的旧推文（可传 time_range 收窄）。";
}

function desiredEnabled() {
	return readJson(STATE_FILE).enabled === true;
}

function readActive(pi) {
	try {
		const active = pi.getActiveTools();
		return Array.isArray(active) ? active : null;
	} catch {
		return null;
	}
}

/** 当前配置下应当处于激活状态的 Skiff 工具。 */
function desiredTools() {
	const tools = [];
	if (desiredEnabled()) tools.push(TOOL);
	if (readUrlAvailable()) tools.push(READ_TOOL);
	return tools;
}

/** 把 activeTools 对齐到持久化状态；工具尚未注册或列表为空时不动作。 */
function applyState(pi) {
	const active = readActive(pi);
	if (!active || !active.length) return;
	const want = desiredTools();
	// setActiveTools 是整体替换，必须带上原有的内置工具。
	const kept = active.filter((name) => name !== TOOL && name !== READ_TOOL);
	const next = [...kept, ...want];
	if (next.length === active.length && next.every((name, index) => name === active[index])) return;
	pi.setActiveTools(next);
}

export default function setup(pi) {
	pi.registerTool({
		name: TOOL,
		label: "联网搜索",
		description:
			"在互联网上搜索最新信息，返回标题、链接和内容摘要。涉及新闻、版本更新、文档、时效性问题时应使用此工具。可用 include_domains 只看指定站点（例如 x.com 的原帖），用 time_range 限定结果的发布时间。",
		// 只保留唯一会“静默出错”的提醒：时间过滤依赖平台元数据，摘要数字是模型聚合。
		// 其余约束都在参数 description、运行时校验或输出注解里，写多了反而稀释内置规则。
		promptGuidelines: [
			"搜索时效内容（尤其 X）时同时给 time_range；结果里的日期和「摘要」里的数字都要回原文核对",
		],
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "搜索关键词，用自然语言表达要查的问题" },
				max_results: { type: "number", description: "返回结果条数，1-10，默认取配置值" },
				include_domains: {
					type: "array",
					items: { type: "string" },
					description: "只在这些域名内搜索，纯域名不带协议，例如 [\"x.com\"] 搜 X 原帖、[\"docs.docker.com\"] 搜官方文档",
				},
				exclude_domains: {
					type: "array",
					items: { type: "string" },
					description: "排除这些域名的结果，例如 [\"pinterest.com\"]",
				},
				time_range: {
					type: "string",
					enum: ["day", "week", "month", "year"],
					description: "只看最近一天/一周/一月/一年发布的内容；搜索 X 或新闻等时效内容时必填",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		async execute(toolCallId, params, signal) {
			const provider = readProvider();
			const spec = PROVIDERS[provider];
			const apiKey = readApiKey(provider);
			if (!apiKey) throw new Error(`未配置 ${spec.label} API key，请先在 Skiff 的联网搜索设置中填写。`);
			const query = String(params?.query ?? "").trim();
			if (!query) throw new Error("缺少搜索关键词。");
			const options = resolveOptions(params);
			assertEngineCanSearch(spec, provider, options);
			const data = await spec.search(apiKey, query, options, signal);
			const notice = searchNotice(provider, options);
			const formatted = [notice, spec.format(data)].filter(Boolean).join("\n\n");
			return {
				content: [{ type: "text", text: formatted }],
				details: {
					query,
					provider,
					count: Array.isArray(data.results) ? data.results.length : 0,
					includeDomains: options.includeDomains,
					excludeDomains: options.excludeDomains,
					timeRange: options.timeRange,
				},
			};
		},
	});

	// 「读取网页」：Exa 走 Contents（可读缓存），Tavily 走 Extract（实时抓取），由开关控制。
	pi.registerTool({
		name: READ_TOOL,
		label: "读取网页",
		description:
			"读取一个网页的正文，按当前引擎选择 Exa Contents 或 Tavily Extract。用户给出链接并要求总结、核对或引用其中内容时使用；搜索结果里的链接也适合用它精读，避免再次搜索。",
		parameters: {
			type: "object",
			properties: {
				url: { type: "string", description: "要读取的网页地址，必须带 http:// 或 https://" },
				max_chars: { type: "number", description: `返回正文的字符上限，500-${READ_MAX_CHARS_LIMIT}，默认 ${READ_MAX_CHARS}` },
				fresh: { type: "boolean", description: "仅 Exa 生效：true 强制重新抓取（更慢、仍按页计费），默认 false 读缓存" },
			},
			required: ["url"],
			additionalProperties: false,
		},
		async execute(toolCallId, params, signal) {
			const provider = readProvider();
			const spec = PROVIDERS[provider];
			const apiKey = readApiKey(provider);
			if (!apiKey) throw new Error(`读取网页无法使用：尚未配置 ${spec.label} API key，请先在 Skiff 的联网搜索设置中填写。`);
			const url = normalizeUrl(params?.url);
			const requested = Number(params?.max_chars);
			const maxChars = Math.min(READ_MAX_CHARS_LIMIT, Math.max(500, Number.isFinite(requested) && requested > 0 ? requested : READ_MAX_CHARS));
			const fresh = params?.fresh === true && provider === "exa";
			const { page, source } = await readPage(provider, apiKey, url, { maxChars, fresh }, signal);

			const title = String(page?.title ?? "").trim() || "(无标题)";
			const date = page?.publishedDate ? ` · ${String(page.publishedDate).slice(0, 10)}` : "";
			// Exa 已按 maxCharacters 截断；Tavily 给的是整页，这里本地截断后再降级标题。
			const raw = String(page?.text ?? "").trim();
			const truncated = raw.length >= maxChars;
			const body = demoteHeadings(raw.slice(0, maxChars).trim());
			const meta = [
				typeof page?.author === "string" && page.author.trim() ? `作者：${page.author.trim()}` : "",
				truncated ? `（正文已截断到 ${maxChars} 字符，可调大 max_chars）` : "",
			].filter(Boolean).join("\n");
			const text = [`### ${title}${date}`, String(page?.url ?? url), [meta, body].filter(Boolean).join("\n\n")].join("\n").trim();

			return {
				content: [{ type: "text", text: text || "页面没有正文内容。" }],
				details: { url, provider, title: title === "(无标题)" ? "" : title, chars: body.length, truncated, fresh, source },
			};
		},
	});

	// 注意：签名是 registerCommand(名字, { description, handler })，
	// 传单个对象会被当成名字，导致 /web 无法被解析。
	pi.registerCommand(COMMAND, {
		description: "开关联网搜索：/web on 或 /web off",
		async handler(args, ctx) {
			const active = readActive(pi) ?? [];
			const without = active.filter((name) => name !== TOOL);
			const arg = String(args ?? "").trim().toLowerCase();
			const notify = (message, level = "info") => {
				if (typeof ctx?.ui?.notify === "function") ctx.ui.notify(message, level);
			};
			const provider = readProvider();
			const label = PROVIDERS[provider].label;

			if (["off", "false", "0", "disable", "关", "关闭", "禁用"].includes(arg)) {
				writeJson(STATE_FILE, { enabled: false });
				if (without.length !== active.length) pi.setActiveTools(without);
				notify("已关闭联网搜索");
				return;
			}
			if (["on", "true", "1", "enable", "开", "开启", "启用"].includes(arg)) {
				if (!readApiKey(provider)) {
					notify(`联网搜索无法开启：尚未配置 ${label} API key`, "warning");
					return;
				}
				writeJson(STATE_FILE, { enabled: true });
				if (!active.includes(TOOL)) pi.setActiveTools([...without, TOOL]);
				notify(`已开启联网搜索（${label}）`);
				return;
			}
			const readState = `，读取网页${active.includes(READ_TOOL) ? "开" : "关"}`;
			notify(`联网搜索当前为「${active.includes(TOOL) ? "开" : "关"}」，引擎 ${label}${readState}，用 /web on 或 /web off 切换`);
		},
	});

	// 加载阶段不能改 activeTools，因此对齐动作放到会话就绪与每次模型调用之前，
	// 这样 fork / reload / 新会话之后都会恢复到持久化的开关状态。
	pi.on("session_start", () => applyState(pi));
	pi.on("before_agent_start", () => applyState(pi));
}
