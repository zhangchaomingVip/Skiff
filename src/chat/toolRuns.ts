import type { ContentBlock } from "./types";

/** Coarse category used to pick an icon and a human phrase for a tool call. */
export type ToolKind = "read" | "write" | "find" | "list" | "command" | "search" | "web" | "other";

type Tool = Extract<ContentBlock, { kind: "tool" }>;
type Result = Extract<ContentBlock, { kind: "toolResult" }>;
export type ToolRunItem = { key: number; block: Tool; result?: Result };

const KIND_BY_NAME: Record<string, ToolKind> = {
	read: "read", view: "read", view_image: "read", cat: "read", open: "read",
	glob: "find", find: "find",
	ls: "list", list: "list", tree: "list",
	write: "write", edit: "write", multi_edit: "write", multiedit: "write", apply_patch: "write", patch: "write", create: "write", delete: "write", remove: "write", move: "write", rename: "write",
	bash: "command", shell: "command", exec: "command", run: "command", command: "command", terminal: "command", powershell: "command", cmd: "command",
	grep: "search", search: "search", rg: "search", fetch: "search", web_fetch: "search",
	web_search: "web",
};

const RUNNING_PHRASES: Record<ToolKind, string> = { read: "读取文件", write: "编辑文件", find: "查找文件", list: "列举目录", command: "执行命令", search: "搜索内容", web: "联网搜索", other: "调用工具" };

/** Settled rows read "执行了 3 条命令"; running rows drop the past-tense suffix. */
const ACTION_PHRASES: Record<ToolKind, { verb: string; unit: string }> = {
	read: { verb: "读取", unit: "个文件" },
	write: { verb: "编辑", unit: "个文件" },
	find: { verb: "查找", unit: "个文件" },
	list: { verb: "列举", unit: "个目录" },
	command: { verb: "执行", unit: "条命令" },
	search: { verb: "搜索", unit: "次" },
	web: { verb: "联网搜索", unit: "次" },
	other: { verb: "调用", unit: "次" },
};

export function toolKind(name: string): ToolKind {
	return KIND_BY_NAME[name.toLowerCase()] ?? "other";
}

/** Label for a single call, falling back to the raw tool name for unknown tools. */
export function toolKindLabel(name: string): string {
	const kind = toolKind(name);
	return kind === "other" ? name : RUNNING_PHRASES[kind];
}

/** Best-effort target shown next to a call: the shell command or the touched path. */
export function toolTarget(tool: Tool): string | undefined {
	let args: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(tool.argsText);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		args = parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
	const kind = toolKind(tool.name);
	const keys = kind === "find" || kind === "search" || kind === "web" ? ["pattern", "query", "url", "path", "file", "filePath", "file_path"] : ["command", "path", "file", "filePath", "file_path", "pattern", "query", "url"];
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

export interface ToolRunSummary {
	/** Dominant category of the whole run. */
	kind: ToolKind;
	/** Tool names followed by actions with explicit units, separated by punctuation. */
	label: string;
	running: boolean;
	error: boolean;
	steps: number;
}

function actionLabel(kind: ToolKind, items: ToolRunItem[], settled = false): string {
	const failures = items.filter((item) => item.result?.isError).length;
	// A single unknown tool keeps its identifier as the verb; identifiers never take the past-tense suffix.
	const raw = kind === "other" && new Set(items.map((item) => item.block.name)).size === 1 ? items[0].block.name : undefined;
	const verb = raw ?? ACTION_PHRASES[kind].verb;
	const unit = raw ? "次" : ACTION_PHRASES[kind].unit;
	return `${verb}${settled && !raw ? "了" : ""} ${items.length} ${unit}${failures ? `（${failures} 失败）` : ""}`;
}

/** Totals count calls, never unique files or successful outcomes. */
export function toolActionSummaries(items: ToolRunItem[], settled = false): string[] {
	const kinds = [...new Set(items.map((item) => toolKind(item.block.name)))];
	return kinds.length > 2 ? [`调用${settled ? "了" : ""} ${items.length} 次工具`] : kinds.map((kind) => actionLabel(kind, items.filter((item) => toolKind(item.block.name) === kind), settled));
}

/** Compact Codex-style summary of a (possibly mixed) run of consecutive tool calls. */
export function toolRunSummary(items: ToolRunItem[]): ToolRunSummary {
	const running = items.some((item) => !item.result);
	const kinds: ToolKind[] = [];
	for (const item of items) {
		const kind = toolKind(item.block.name);
		if (!kinds.includes(kind)) kinds.push(kind);
	}
	const kind = kinds.length === 1 ? kinds[0] : "other";
	return {
		kind,
		label: `${[...new Set(items.map((item) => item.block.name))].join(" + ") || "工具"} · ${toolActionSummaries(items, !running).join("；") || "0 次调用"}`,
		running,
		error: items.some((item) => item.result?.isError),
		steps: items.length,
	};
}

/** Expanded details retain the specific action and target of each underlying tool. */
export function toolCallSummary(item: ToolRunItem): ToolRunSummary {
	const kind = toolKind(item.block.name);
	return { kind, label: `${item.block.name} · ${actionLabel(kind, [item], !!item.result)}`, running: !item.result, error: !!item.result?.isError, steps: 1 };
}

/** Human-readable description used for the summary tooltip. */
export function toolRunTitle(items: ToolRunItem[]): string {
	return items.map((item) => [item.block.name, toolTarget(item.block)].filter(Boolean).join(" ")).join("\n");
}
