import { toolKind } from "./toolRuns";
import { processCountLabel, type TurnProcessGroup } from "./turnProcess";
import type { ContentBlock } from "./types";

type Tool = Extract<ContentBlock, { kind: "tool" }>;

/** Summary targets are an allowlist. Never put raw commands, prompts or queries in a status or tooltip. */
function safeName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const name = value.trim();
	if (!name || name.length > 80 || /[\r\n=?:@]|token|password|passwd|secret|credential|authorization|bearer|api[-_]?key|sk-[\w-]+|[\w-]{24,}/i.test(name)) return undefined;
	return /^[\p{L}\p{N}_. /\\-]+$/u.test(name) ? name : undefined;
}

export function toolActivityLabel(tool: Tool): string {
	let args: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(tool.argsText);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
	} catch { /* Incomplete arguments still have a useful action label. */ }
	if (/^(subagent|sub_agent|spawn_agent|delegate|agent)$/i.test(tool.name)) {
		const name = safeName(args.agent ?? args.name ?? args.task_name);
		return `正在调用子代理${name ? ` ${name}` : ""}`;
	}
	const kind = toolKind(tool.name);
	if (kind === "command") {
		// Only known executable/subcommand words may escape the command. Flags and values never do.
		const words = typeof args.command === "string" ? args.command.trim().split(/\s+/) : [];
		const executable = /^(npm|npx|node|pnpm|yarn|bun|cargo|rustc|python3?|pytest|git|rg|ls|pwd|tsc|vite)$/i.test(words[0] ?? "") ? words[0] : undefined;
		const subcommand = /^(test|build|check|run|install|ci|status|diff|log|show|fetch)$/i.test(words[1] ?? "") ? words[1] : undefined;
		return `正在运行${executable ? ` ${executable}${subcommand ? ` ${subcommand}` : ""}` : "命令"}`;
	}
	if (kind === "read" || kind === "write" || kind === "list") {
		const path = args.path ?? args.file ?? args.filePath ?? args.file_path;
		const name = typeof path === "string" ? safeName(path.split(/[/\\]/).pop()) : undefined;
		const action = kind === "read" ? "读取" : kind === "write" ? "编辑" : "浏览";
		return `正在${action}${name ? ` ${name}` : kind === "list" ? "目录" : "文件"}`;
	}
	return kind === "web" ? "正在联网搜索" : kind === "find" ? "正在查找文件" : kind === "search" ? "正在搜索内容" : "正在调用工具";
}

export function processActivity(group: TurnProcessGroup) {
	const entries = group.entries;
	const pending = entries.filter((entry) => entry.block.kind === "tool" && !entry.result);
	let action = "正在思考";
	let actionKey = `${group.id}:waiting`;
	if (pending.length) {
		const current = pending[pending.length - 1];
		// Calls issued together in one assistant message form a batch. Keep its denominator
		// stable as out-of-order results arrive, including the final single running call.
		const batch = entries.filter((entry) => entry.messageId === current.messageId && entry.block.kind === "tool");
		if (batch.length > 1) {
			action = `正在并行运行 ${batch.length} 个工具（${batch.filter((entry) => entry.result).length}/${batch.length}）`;
			actionKey = `${current.messageId}:parallel`;
		} else if (current.block.kind === "tool") {
			action = toolActivityLabel(current.block);
			actionKey = `${current.messageId}:${current.key}:tool`;
		}
	} else {
		const latest = entries[entries.length - 1];
		if (latest?.block.kind === "thinking") {
			action = "正在思考";
			actionKey = `${latest.messageId}:${latest.key}:thinking`;
		}
	}
	return {
		actionKey,
		label: action,
		// Kept only in memory for progress detection; never rendered or logged.
		progress: JSON.stringify(entries.map(({ messageId, key, block, result }) => [messageId, key, block, result])),
	};
}

export const PROCESS_STALL_MS = 10_000;
export type ProcessClock = { actionKey: string; progress: string; startedAt: number; lastProgressAt: number };

export function advanceProcessClock(previous: ProcessClock | undefined, activity: ReturnType<typeof processActivity>, now: number): ProcessClock {
	if (!previous || previous.actionKey !== activity.actionKey) return { actionKey: activity.actionKey, progress: activity.progress, startedAt: now, lastProgressAt: now };
	return previous.progress === activity.progress ? previous : { ...previous, progress: activity.progress, lastProgressAt: now };
}

export function processElapsedLabel(clock: ProcessClock | undefined, now: number): string {
	if (!clock || now - clock.lastProgressAt < PROCESS_STALL_MS) return "";
	const seconds = Math.max(0, Math.floor((now - clock.startedAt) / 1000));
	return ` · 已运行 ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}`;
}

export function processStatus(group: TurnProcessGroup, running: boolean, outcome?: string) {
	const active = running && !group.closed;
	const failed = !running && outcome === "error";
	// Later content has already frozen this row. Only the terminal open segment
	// receives the turn's final failure state.
	const error = failed && !!group.terminal && !group.advanced;
	const activity = active ? processActivity(group) : undefined;
	const latest = group.entries[group.entries.length - 1];
	let label = activity?.label === "正在思考" && latest?.block.kind !== "thinking" && group.entries.length ? processCountLabel(group, false, true, true) : activity?.label ?? processCountLabel(group, false, true, true);
	const outcomes: string[] = [];
	if (group.error) outcomes.push("有调用失败，查看详情");
	if (!active && group.pending) outcomes.push(running ? "等待结果" : "未收到工具结果");
	if (error) outcomes.push("模型响应失败");
	if (!running && !group.advanced && group.placement === "head") {
		if (outcome === "manual" || outcome === "aborted") outcomes.push("已停止");
		else if (outcome === "length") outcomes.push("输出已达长度上限");
	}
	label = [label, ...outcomes].filter(Boolean).join(" · ");
	return { active, error: error || group.error, label, detailLabel: label, visible: !!label, complete: !active && !error && !group.error && !group.pending && outcome !== "manual" && outcome !== "aborted" };
}
