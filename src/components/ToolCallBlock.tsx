import type { ContentBlock } from "../chat/types";
import { toolKind, toolCallSummary, toolTarget } from "../chat/toolRuns";
import { TOOL_ICONS } from "./toolIcons";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolSummaryLabel } from "./ToolSummaryLabel";
import { ToolDetailSection, ToolDetailText } from "./ToolDetailSection";
import { ToolSearchResults } from "./ToolSearchResults";
import { useMemo } from "react";
import { parseSearchDetails } from "../chat/toolDetails";

type Tool = Extract<ContentBlock, { kind: "tool" }>;
type Result = Extract<ContentBlock, { kind: "toolResult" }>;

export function ToolCallBlock({ tool, result }: { tool: Tool; result?: Result }) {
	let args: Record<string, unknown> = {};
	try {
		const parsed: unknown = JSON.parse(tool.argsText);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
	} catch { /* Partial JSON while streaming. */ }
	const command = typeof args.command === "string" ? args.command : undefined;
	const name = tool.name.toLowerCase();
	const kind = toolKind(name);
	const writeContent = name === "write" && typeof args.content === "string" ? args.content : undefined;
	const task = /subagent|agent/.test(name) ? typeof args.task === "string" ? args.task : typeof args.prompt === "string" ? args.prompt : undefined : undefined;
	const target = toolTarget(tool);
	const summary = toolCallSummary({ key: 0, block: tool, result });
	const output = result?.text ?? "";
	const diff = result?.diff ?? (name === "edit" && typeof args.oldText === "string" && typeof args.newText === "string" ? args.oldText.split("\n").map((line) => `-${line}`).concat(args.newText.split("\n").map((line) => `+${line}`)).join("\n") : undefined);
	const diffLines = diff?.split("\n") ?? [];
	const additions = writeContent !== undefined && !diff ? writeContent.split("\n").length : diffLines.filter((line) => /^\s*\+/.test(line)).length;
	const removals = diffLines.filter((line) => /^\s*-/.test(line)).length;
	const primaryInput = command !== undefined || diff !== undefined || writeContent !== undefined;
	const fileRead = kind === "read";
	const search = kind === "web";
	const searchDetails = useMemo(() => search && result && !result.isError ? parseSearchDetails(output) : undefined, [search, result, output]);
	const searchLabel = searchDetails ? `搜索网页${searchDetails.results.length || !output.trim() || output.trim() === "没有找到相关结果。" ? `（${searchDetails.results.length.toLocaleString("en-US")} 个结果）` : ""}` : undefined;
	const input = Object.keys(args).length ? JSON.stringify(args, null, 2) : tool.argsText;
	return <ProcessDisclosure className={`tool ${result?.isError ? "err" : ""}`} icon={TOOL_ICONS[kind]} label={searchLabel ? <span className="tool-summary">{searchLabel}</span> : <ToolSummaryLabel label={summary.label} target={target} single settled={!!result} />} status={!result ? <span className="tool-state running">{tool.done ? "等待结果…" : "准备中…"}</span> : !result.isError && (diff !== undefined || writeContent !== undefined) ? <span className="tool-diff-count"><span className="tool-diff-added" aria-label={`新增 ${additions.toLocaleString("en-US")} 行`}>+{additions.toLocaleString("en-US")}</span><span className="tool-diff-removed" aria-label={`删除 ${removals.toLocaleString("en-US")} 行`}>-{removals.toLocaleString("en-US")}</span></span> : undefined}>
		<div className={`tool-content${searchDetails ? " tool-search-content" : ""}`}>
			{command !== undefined && <ToolDetailSection title="命令" copy={{ text: command, label: "复制命令" }}><ToolDetailText text={`$ ${command}`} /></ToolDetailSection>}
			{diff !== undefined && <ToolDetailSection title={!result || result.isError ? "拟议变更" : "文件变更"} copy={command === undefined ? { text: diff, label: "复制文件变更" } : undefined}><ToolDetailText text={diff} diff /></ToolDetailSection>}
			{writeContent !== undefined && diff === undefined && <ToolDetailSection title="写入内容" copy={command === undefined ? { text: writeContent, label: "复制写入内容" } : undefined}><ToolDetailText text={writeContent} /></ToolDetailSection>}
			{!primaryInput && !fileRead && !search && <ToolDetailSection title={task !== undefined ? "委派任务" : "输入"} copy={!result ? { text: task ?? input, label: "复制工具输入" } : undefined}>
				{task !== undefined ? <>{typeof args.agent === "string" && <p className="tool-detail-meta">代理 · {args.agent}</p>}<ToolDetailText text={task} /></> : <ToolDetailText text={input || (tool.done ? "无需额外输入" : "正在接收调用内容…")} />}
			</ToolDetailSection>}
			{searchDetails ? <ToolSearchResults text={output} details={searchDetails} /> : result ? <ToolDetailSection title={result.isError ? "错误信息" : fileRead ? "文件内容" : "执行输出"} copy={!primaryInput ? { text: output, label: fileRead ? "复制文件内容" : "复制工具输出" } : undefined}>
				{fileRead && !result.isError && (typeof args.offset === "number" || typeof args.limit === "number") && <p className="tool-detail-meta">{[typeof args.offset === "number" ? `从第 ${args.offset} 行起` : "", typeof args.limit === "number" ? `最多 ${args.limit} 行` : ""].filter(Boolean).join(" · ")}</p>}
				<ToolDetailText text={output || "无输出"} tail={kind === "command"} />
			</ToolDetailSection> : <p className="tool-detail-waiting">{fileRead ? "正在读取文件内容…" : search ? "正在检索相关网页…" : "等待工具执行结果…"}</p>}
		</div>
	</ProcessDisclosure>;
}
