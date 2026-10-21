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

/** `write` outranks `read` etc. so a mixed group shows the most consequential icon. */
const WEIGHT: Record<ToolKind, number> = { write: 4, read: 3, find: 2, list: 2, search: 2, web: 2, command: 1, other: 0 };

const RUNNING_PHRASES: Record<ToolKind, string> = { read: "读取文件", write: "编辑文件", find: "查找文件", list: "列举目录", command: "执行命令", search: "搜索内容", web: "联网搜索", other: "调用工具" };

type SummaryKind = Exclude<ToolKind, "find" | "list" | "search">;
const SUMMARY_ORDER: SummaryKind[] = ["read", "write", "command", "web", "other"];

function summaryKind(name: string): SummaryKind {
	const kind = toolKind(name);
	return kind === "find" || kind === "list" || kind === "search" ? "command" : kind;
}

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

function actionSummary(kind: ToolKind, items: ToolRunItem[]): string {
	const completed = items.every((item) => item.result);
	const suffix = completed ? "了" : "";
	if (kind === "read") return `读取${suffix} ${items.length} 个文件`;
	if (kind === "write") return `编辑${suffix} ${items.length} 个文件`;
	if (kind === "command") return `执行${suffix} ${items.length} 条命令`;
	if (kind === "search") return `搜索${suffix} ${items.length} 次`;
	if (kind === "web") return `联网搜索${suffix} ${items.length} 次`;
	// These totals count calls, not matched files or the number of directory entries returned.
	if (kind === "find") return `查找${suffix} ${items.length} 次文件`;
	if (kind === "list") return `列举${suffix} ${items.length} 次目录`;
	return `调用${suffix} ${items.length} 次工具`;
}

function actionLabel(kind: ToolKind, items: ToolRunItem[]): string {
	const failures = items.filter((item) => item.result?.isError).length;
	return `${actionSummary(kind, items)}${failures ? `（${failures.toLocaleString("en-US")} 失败）` : ""}`;
}

/** Count tool calls in a fixed order; local lookup joins commands, web_search stays separate. */
export function toolActionSummaries(items: ToolRunItem[]): string[] {
	return SUMMARY_ORDER.flatMap((kind) => {
		const actions = items.filter((item) => summaryKind(item.block.name) === kind);
		return actions.length ? [actionLabel(kind, actions)] : [];
	});
}

/** Compact Codex-style summary of a (possibly mixed) run of consecutive tool calls. */
export function toolRunSummary(items: ToolRunItem[]): ToolRunSummary {
	const running = items.some((item) => !item.result);
	const kinds: ToolKind[] = [];
	for (const item of items) {
		const kind = summaryKind(item.block.name);
		if (!kinds.includes(kind)) kinds.push(kind);
	}
	const kind = kinds.reduce<ToolKind>((best, current) => (WEIGHT[current] > WEIGHT[best] ? current : best), kinds[0] ?? "other");
	return {
		kind,
		label: `${[...new Set(items.map((item) => item.block.name))].join(" + ") || "工具"} · ${toolActionSummaries(items).join("；") || "0 次调用"}`,
		running,
		error: items.some((item) => item.result?.isError),
		steps: items.length,
	};
}

/** Expanded details retain the specific action and target of each underlying tool. */
export function toolCallSummary(item: ToolRunItem): ToolRunSummary {
	const kind = toolKind(item.block.name);
	return { kind, label: `${item.block.name} · ${actionLabel(kind, [item])}`, running: !item.result, error: !!item.result?.isError, steps: 1 };
}

/** Human-readable description used for the summary tooltip. */
export function toolRunTitle(items: ToolRunItem[]): string {
	return items.map((item) => [item.block.name, toolTarget(item.block)].filter(Boolean).join(" ")).join("\n");
}
