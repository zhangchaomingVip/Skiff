import { Button } from "./ui";
import { useState } from "react";
import type { ContentBlock } from "../chat/types";
import { toolKind, toolKindLabel } from "../chat/toolRuns";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { TOOL_ICONS } from "./toolIcons";

type Tool = Extract<ContentBlock, { kind: "tool" }>;
type Result = Extract<ContentBlock, { kind: "toolResult" }>;

export function ToolCallBlock({ tool, result }: { tool: Tool; result?: Result }) {
	const [full, setFull] = useState(false);
	let args: Record<string, unknown> = {};
	try { args = JSON.parse(tool.argsText); } catch { /* Partial JSON while streaming. */ }
	const command = typeof args.command === "string" ? args.command : undefined;
	const path = typeof args.path === "string" ? args.path : undefined;
	const output = result?.text ?? "";
	const lines = output.split("\n");
	const diff = !result?.isError ? result?.diff ?? (tool.name === "edit" && typeof args.oldText === "string" && typeof args.newText === "string" ? args.oldText.split("\n").map((line) => `-${line}`).concat(args.newText.split("\n").map((line) => `+${line}`)).join("\n") : tool.name === "write" && typeof args.content === "string" ? args.content.split("\n").map((line) => `+${line}`).join("\n") : undefined) : undefined;
	return <details className={`tool ${result?.isError ? "err" : ""}`}>
		<summary title={tool.name}><Icon name={TOOL_ICONS[toolKind(tool.name)]} size={14} /><span className="tool-name">{toolKindLabel(tool.name)}</span><span className="tool-target" title={command ?? path}>{command ?? path}</span><span className={`tool-state ${!result ? "running" : ""}`}>{result ? result.isError ? "执行失败" : "已完成" : tool.done ? "等待结果…" : "准备中…"}</span><span className="disclosure"><Icon name="chevron" size={11} /></span></summary>
		<div className="tool-content">
			{command && <div className="tool-command"><code>$ {command}</code><CopyButton text={command} label="复制命令" /></div>}
			{!command && <details className="tool-parameters"><summary>调用参数</summary><pre>{tool.argsText || "无参数"}</pre></details>}
			{diff && <div className="tool-diff" aria-label={tool.name === "write" ? "写入内容" : "文件变更"}>{diff.split("\n").map((line, i) => <div key={i} className={/^\s*\+/.test(line) ? "diff-add" : /^\s*-/.test(line) ? "diff-remove" : ""}>{line || " "}</div>)}</div>}
			{result ? <><div className="tool-output-heading">执行输出<CopyButton text={output} label="复制工具输出" /></div><pre className="tool-output">{(full ? lines : lines.slice(-12)).join("\n") || "无输出"}</pre>{lines.length > 12 && <Button size="compact" aria-expanded={full} aria-label="切换完整工具输出" onClick={() => setFull(!full)}>{full ? "仅显示末尾" : `显示全部 ${lines.length} 行`}</Button>}</> : <p className="muted">等待工具执行结果…</p>}
		</div>
	</details>;
}
