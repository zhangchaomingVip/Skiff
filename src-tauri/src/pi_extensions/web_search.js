/**
 * Skiff 联网搜索扩展。
 *
 * 给 pi 注册一个 Tavily 驱动的 `web_search` 工具，并注册 `/web on|off` 命令，
 * 让用户可以在输入框实时开关它（无需重启 pi 子进程）。
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
const COMMAND = "web";
const KEY_FILE = "skiff-web-search.json";
const STATE_FILE = "skiff-web-search-state.json";

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

/** Key 优先取环境变量，其次是 Skiff 写入的配置文件。两者都没有就是未配置。 */
function readApiKey() {
	const fromEnv = process.env.TAVILY_API_KEY;
	if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
	const config = readJson(KEY_FILE);
	const key = config.apiKey ?? config.tavilyApiKey;
	return key && String(key).trim() ? String(key).trim() : "";
}

function readMaxResults() {
	const value = Number(readJson(KEY_FILE).maxResults);
	return Number.isFinite(value) && value > 0 ? value : 5;
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

/** 把 activeTools 对齐到持久化状态；工具尚未注册或列表为空时不动作。 */
function applyState(pi) {
	const active = readActive(pi);
	if (!active || !active.length) return;
	const has = active.includes(TOOL);
	const want = desiredEnabled();
	if (has === want) return;
	const rest = active.filter((name) => name !== TOOL);
	// setActiveTools 是整体替换，必须带上原有的内置工具。
	pi.setActiveTools(want ? [...rest, TOOL] : rest);
}

async function tavilySearch(apiKey, query, maxResults, signal) {
	const response = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			api_key: apiKey,
			query,
			max_results: maxResults,
			search_depth: "basic",
			include_answer: true,
		}),
		signal,
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`联网搜索失败：Tavily 返回 HTTP ${response.status} ${detail}`.trim());
	}
	const data = await response.json();
	if (!data || typeof data !== "object") throw new Error("联网搜索失败：Tavily 返回了无法解析的内容");
	return data;
}

function formatResults(data) {
	const blocks = [];
	if (typeof data.answer === "string" && data.answer.trim()) blocks.push(`摘要：${data.answer.trim()}`);
	for (const item of Array.isArray(data.results) ? data.results : []) {
		const title = String(item?.title ?? "").trim() || "(无标题)";
		const content = String(item?.content ?? "").trim();
		blocks.push(`### ${title}\n${String(item?.url ?? "")}\n${content}`.trim());
	}
	if (!blocks.length) blocks.push("没有找到相关结果。");
	return blocks.join("\n\n");
}

export default function setup(pi) {
	pi.registerTool({
		name: TOOL,
		label: "联网搜索",
		description:
			"在互联网上搜索最新信息，返回标题、链接和内容摘要。涉及新闻、版本更新、文档、时效性问题时应使用此工具。",
		promptGuidelines: [
			"需要实时或训练数据之外的信息时使用",
			"引用搜索结果中的事实时要给出来源链接",
		],
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "搜索关键词，用自然语言表达要查的问题" },
				max_results: { type: "number", description: "返回结果条数，1-10，默认取配置值" },
			},
			required: ["query"],
			additionalProperties: false,
		},
		async execute(toolCallId, params, signal) {
			const apiKey = readApiKey();
			if (!apiKey) throw new Error("未配置 Tavily API key，请先在 Skiff 的联网搜索设置中填写。");
			const query = String(params?.query ?? "").trim();
			if (!query) throw new Error("缺少搜索关键词。");
			const fallback = readMaxResults();
			const requested = Number(params?.max_results);
			const count = Math.min(10, Math.max(1, Number.isFinite(requested) && requested > 0 ? requested : fallback));
			const data = await tavilySearch(apiKey, query, count, signal);
			return {
				content: [{ type: "text", text: formatResults(data) }],
				details: { query, count: Array.isArray(data.results) ? data.results.length : 0 },
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

			if (["off", "false", "0", "disable", "关", "关闭", "禁用"].includes(arg)) {
				writeJson(STATE_FILE, { enabled: false });
				if (without.length !== active.length) pi.setActiveTools(without);
				notify("已关闭联网搜索");
				return;
			}
			if (["on", "true", "1", "enable", "开", "开启", "启用"].includes(arg)) {
				if (!readApiKey()) {
					notify("联网搜索无法开启：尚未配置 Tavily API key", "warning");
					return;
				}
				writeJson(STATE_FILE, { enabled: true });
				if (!active.includes(TOOL)) pi.setActiveTools([...without, TOOL]);
				notify("已开启联网搜索");
				return;
			}
			notify(`联网搜索当前为「${active.includes(TOOL) ? "开" : "关"}」，用 /web on 或 /web off 切换`);
		},
	});

	// 加载阶段不能改 activeTools，因此对齐动作放到会话就绪与每次模型调用之前，
	// 这样 fork / reload / 新会话之后都会恢复到持久化的开关状态。
	pi.on("session_start", () => applyState(pi));
	pi.on("before_agent_start", () => applyState(pi));
}
