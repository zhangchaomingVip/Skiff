import { toolRunSummary, toolTarget, type ToolRunItem } from "../chat/toolRuns";
import { ToolCallBlock } from "./ToolCallBlock";
import { Icon } from "./Icon";
import { TOOL_ICONS } from "./toolIcons";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolSummaryLabel } from "./ToolSummaryLabel";

/** Consecutive tool calls collapsed into one Codex-style line, expandable to the cards. */
export function ToolRun({ items }: { items: ToolRunItem[] }) {
	const summary = toolRunSummary(items);
	const state = summary.running ? "进行中" : summary.error ? undefined : "已完成";
	return <ProcessDisclosure className={`tool-run ${summary.error ? "err" : ""}`} icon={TOOL_ICONS[summary.kind]} title={items.map((item) => toolTarget(item.block)).filter(Boolean).join("\n")} label={<ToolSummaryLabel label={summary.label} settled={!summary.running} />} status={<span className={`tool-state ${summary.running ? "running" : ""}`}>{!summary.running && !summary.error && <Icon name="check" size={14} />}{state}</span>}>
		<div className="tool-run-body">{items.map((item) => <ToolCallBlock key={item.key} tool={item.block} result={item.result} />)}</div>
	</ProcessDisclosure>;
}
