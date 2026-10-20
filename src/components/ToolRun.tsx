import { toolRunSummary, toolRunTitle, type ToolRunItem } from "../chat/toolRuns";
import { ToolCallBlock } from "./ToolCallBlock";
import { Icon } from "./Icon";
import { TOOL_ICONS } from "./toolIcons";
import { ProcessDisclosure } from "./ProcessDisclosure";

/** Consecutive tool calls collapsed into one Codex-style line, expandable to the cards. */
export function ToolRun({ items }: { items: ToolRunItem[] }) {
	const summary = toolRunSummary(items);
	const state = summary.error ? "包含错误" : summary.running ? "进行中" : "已完成";
	return <ProcessDisclosure className={`tool-run ${summary.error ? "err" : ""}`} icon={TOOL_ICONS[summary.kind]} title={`${summary.label}\n${toolRunTitle(items)}`} label={<span className="tool-run-label">{summary.label}</span>} status={<span className={`tool-state ${summary.running ? "running" : ""}`}>{!summary.running && !summary.error && <Icon name="check" size={14} />}{state}</span>}>
		<div className="tool-run-body">{items.map((item) => <ToolCallBlock key={item.key} tool={item.block} result={item.result} />)}</div>
	</ProcessDisclosure>;
}
