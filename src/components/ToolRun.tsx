import { toolRunSummary, type ToolRunItem } from "../chat/toolRuns";
import { ToolCallBlock } from "./ToolCallBlock";
import { TOOL_ICONS } from "./toolIcons";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolSummaryLabel } from "./ToolSummaryLabel";

/** Consecutive tool calls collapsed into one Codex-style line, expandable to the cards. */
export function ToolRun({ items }: { items: ToolRunItem[] }) {
	const summary = toolRunSummary(items);
	return <ProcessDisclosure className={`tool-run ${summary.error ? "err" : ""}`} icon={TOOL_ICONS[summary.kind]} label={<ToolSummaryLabel label={summary.label} />} status={summary.running ? <span className="tool-state running">进行中</span> : undefined}>
		<div className="tool-run-body">{items.map((item) => <ToolCallBlock key={item.key} tool={item.block} result={item.result} />)}</div>
	</ProcessDisclosure>;
}
