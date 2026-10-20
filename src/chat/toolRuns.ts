import type { ContentBlock } from "./types";

/** Coarse category used to pick an icon and a human phrase for a tool call. */
export type ToolKind = "read" | "write" | "command" | "search" | "other";

type Tool = Extract<ContentBlock, { kind: "tool" }>;
type Result = Extract<ContentBlock, { kind: "toolResult" }>;
export type ToolRunItem = { key: number; block: Tool; result?: Result };

const KIND_BY_NAME: Record<string, ToolKind> = {
	read: "read", view: "read", view_image: "read", cat: "read", open: "read", ls: "read", list: "read", glob: "read", find: "read", tree: "read",
	write: "write", edit: "write", multi_edit: "write", multiedit: "write", apply_patch: "write", patch: "write", create: "write", delete: "write", remove: "write", move: "write", rename: "write",
	bash: "command", shell: "command", exec: "command", run: "command", command: "command", terminal: "command", powershell: "command", cmd: "command",
	grep: "search", search: "search", rg: "search", web_search: "search", fetch: "search", web_fetch: "search",
};

/** `write` outranks `read` etc. so a mixed group shows the most consequential icon. */
const WEIGHT: Record<ToolKind, number> = { write: 4, read: 3, search: 2, command: 1, other: 0 };

const RUNNING_PHRASES: Record<ToolKind, string> = { read: "读取文件", write: "修改文件", command: "执行命令", search: "搜索内容", other: "调用工具" };

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
	for (const key of ["command", "path", "file", "filePath", "file_path", "pattern", "query", "url"] as const) {
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

/** Count distinct files only for tools whose single-file target is explicit. */
function fileCount(items: ToolRunItem[]): number | undefined {
	const paths = new Set<string>();
	for (const { block } of items) {
		if (!["read", "view", "view_image", "cat", "write", "edit", "create"].includes(block.name.toLowerCase())) return undefined;
		try {
			const args = JSON.parse(block.argsText);
			const path = args.path ?? args.file ?? args.filePath ?? args.file_path;
			if (typeof path !== "string" || !path.trim()) return undefined;
			paths.add(path.trim().replace(/\\/g, "/"));
		} catch {
			return undefined;
		}
	}
	return paths.size;
}

function actionSummary(kind: ToolKind, items: ToolRunItem[]): string {
	const completed = items.every((item) => item.result && !item.result.isError);
	const suffix = completed ? "了" : "";
	if (kind === "command") return `执行${suffix} ${items.length} 条命令`;
	if (kind === "search") return `搜索${suffix} ${items.length} 次`;
	if (kind === "other") return `调用${suffix} ${items.length} 次工具`;
	const count = fileCount(items);
	if (count === undefined) return `执行${suffix} ${items.length} 次文件操作`;
	const verb = kind === "read" ? "读取" : items.every((item) => ["write", "create"].includes(item.block.name.toLowerCase())) ? "写入" : "修改";
	return `${verb}${suffix} ${count} 个文件`;
}

/** Compact Codex-style summary of a (possibly mixed) run of consecutive tool calls. */
export function toolRunSummary(items: ToolRunItem[]): ToolRunSummary {
	const running = items.some((item) => !item.result);
	const kinds: ToolKind[] = [];
	for (const item of items) {
		const kind = toolKind(item.block.name);
		if (!kinds.includes(kind)) kinds.push(kind);
	}
	const kind = kinds.reduce<ToolKind>((best, current) => (WEIGHT[current] > WEIGHT[best] ? current : best), kinds[0] ?? "other");
	return {
		kind,
		label: `${[...new Set(items.map((item) => item.block.name))].join(" + ") || "工具"} · ${kinds.map((value) => actionSummary(value, items.filter((item) => toolKind(item.block.name) === value))).join("；") || "0 次调用"}`,
		running,
		error: items.some((item) => item.result?.isError),
		steps: items.length,
	};
}

/** Human-readable description used for the summary tooltip. */
export function toolRunTitle(items: ToolRunItem[]): string {
	return items.map((item) => [item.block.name, toolTarget(item.block)].filter(Boolean).join(" ")).join("\n");
}
