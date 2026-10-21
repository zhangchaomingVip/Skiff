import { Button } from "./ui";
import { useState } from "react";
import type { ContentBlock } from "../chat/types";
import { toolKind, toolRunSummary, toolTarget } from "../chat/toolRuns";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { TOOL_ICONS } from "./toolIcons";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolSummaryLabel } from "./ToolSummaryLabel";

type Tool = Extract<ContentBlock, { kind: "tool" }>;
type Result = Extract<ContentBlock, { kind: "toolResult" }>;

export function ToolCallBlock({ tool, result }: { tool: Tool; result?: Result }) {
	const [full, setFull] = useState(false);
	let args: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(tool.argsText);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
	} catch { /* Partial JSON while streaming. */ }
	const command = typeof args.command === "string" ? args.command : undefined;
	const target = toolTarget(tool);
	const summary = toolRunSummary([{ key: 0, block: tool, result }]);
	const output = result?.text ?? "";
	const lines = output.split("\n");
	const diff = !result?.isError ? result?.diff ?? (tool.name === "edit" && typeof args.oldText === "string" && typeof args.newText === "string" ? args.oldText.split("\n").map((line) => `-${line}`).concat(args.newText.split("\n").map((line) => `+${line}`)).join("\n") : tool.name === "write" && typeof args.content === "string" ? args.content.split("\n").map((line) => `+${line}`).join("\n") : undefined) : undefined;
	const diffLines = diff?.split("\n") ?? [];
	const additions = diffLines.filter((line) => /^\s*\+/.test(line)).length;
	const removals = diffLines.filter((line) => /^\s*-/.test(line)).length;
	const state = result ? result.isError ? "执行失败" : "已完成" : tool.done ? "等待结果…" : "准备中…";
	return <ProcessDisclosure className={`tool ${result?.isError ? "err" : ""}`} icon={TOOL_ICONS[toolKind(tool.name)]} title={target} label={<ToolSummaryLabel label={summary.label} target={target} single settled={!!result} />} status={result?.isError ? undefined : diff && result ? <span className="tool-diff-count" title={state}><span className="sr-only">{state}，</span><span className="tool-diff-added" aria-label={`新增 ${additions.toLocaleString("en-US")} 行`}>+{additions.toLocaleString("en-US")}</span><span className="tool-diff-removed" aria-label={`删除 ${removals.toLocaleString("en-US")} 行`}>-{removals.toLocaleString("en-US")}</span></span> : <span className={`tool-state ${!result ? "running" : ""}`}>{result && <Icon name="check" size={14} />}{state}</span>}>
		<div className="tool-content">
			{command && <div className="tool-command"><code>$ {command}</code><CopyButton text={command} label="复制命令" /></div>}
			{!command && <ProcessDisclosure className="tool-parameters" icon="code" label="调用参数"><pre>{tool.argsText || "无参数"}</pre></ProcessDisclosure>}
			{diff && <div className="tool-diff" aria-label={tool.name === "write" ? "写入内容" : "文件变更"}>{diff.split("\n").map((line, i) => <div key={i} className={/^\s*\+/.test(line) ? "diff-add" : /^\s*-/.test(line) ? "diff-remove" : ""}>{line || " "}</div>)}</div>}
			{result ? <><div className="tool-output-heading">{result.isError ? "error" : "执行输出"}<CopyButton text={output} label="复制工具输出" /></div><pre className="tool-output">{(full ? lines : lines.slice(-12)).join("\n") || "无输出"}</pre>{lines.length > 12 && <Button size="compact" aria-expanded={full} aria-label="切换完整工具输出" onClick={() => setFull(!full)}>{full ? "仅显示末尾" : `显示全部 ${lines.length} 行`}</Button>}</> : <p className="muted">等待工具执行结果…</p>}
		</div>
	</ProcessDisclosure>;
}
