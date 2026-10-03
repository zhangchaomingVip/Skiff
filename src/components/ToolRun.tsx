import { toolRunSummary, toolRunTitle, type ToolRunItem } from "../chat/toolRuns";
import { ToolCallBlock } from "./ToolCallBlock";
import { Icon } from "./Icon";
import { TOOL_ICONS } from "./toolIcons";

/** Consecutive tool calls collapsed into one Codex-style line, expandable to the cards. */
export function ToolRun({ items }: { items: ToolRunItem[] }) {
	const summary = toolRunSummary(items);
	const state = summary.error ? "包含错误" : summary.running ? "进行中" : "已完成";
	return <details className={`tool-run ${summary.error ? "err" : ""}`}>
		<summary title={toolRunTitle(items)}>
			<Icon name={TOOL_ICONS[summary.kind]} size={14} />
			<span className="tool-run-label">{summary.label}</span>
			<span className={`tool-state ${summary.running ? "running" : ""}`}>{state}</span>
			{summary.steps > 1 && <span className="tool-run-count">{summary.steps}</span>}
			<span className="disclosure"><Icon name="chevron" size={11} /></span>
		</summary>
		<div className="tool-run-body">{items.map((item) => <ToolCallBlock key={item.key} tool={item.block} result={item.result} />)}</div>
	</details>;
}
