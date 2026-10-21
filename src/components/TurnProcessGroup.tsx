import { outcomeLabel } from "../chat/interactions";
import { processCountLabel, type TurnProcessGroup as ProcessGroup } from "../chat/turnProcess";
import { toolKind, type ToolRunItem } from "../chat/toolRuns";
import { Icon } from "./Icon";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolRun } from "./ToolRun";
import { TOOL_ICONS } from "./toolIcons";

export function ProcessStatus({ running = false, error = false, label = "进行中" }: { running?: boolean; error?: boolean; label?: string }) {
	return <span className={`tool-state ${running ? "running" : error ? "failed" : ""}`}>{running ? <span className="process-spinner" aria-hidden="true" /> : !error && label === "已完成" ? <Icon name="check" size={14} /> : null}{label}</span>;
}

/** The same process row wraps the prelude and each quieter interruption between reply paragraphs. */
export function TurnProcessGroup({ group, running, outcome, expanded, onExpandedChange }: { group: ProcessGroup; running: boolean; outcome?: string; expanded: boolean; onExpandedChange: (id: string, expanded: boolean) => void }) {
	const active = running && (!group.closed || group.pending);
	const finalOutcome = group.placement === "head" && !running && outcome !== "stop" ? outcomeLabel(outcome) : undefined;
	const error = finalOutcome === "运行失败";
	const state = active ? "进行中" : finalOutcome ?? (group.pending ? "未完成" : "已完成");
	const label = processCountLabel(group, running && !group.closed);
	const nodes = [];
	for (let index = 0; index < group.entries.length; index++) {
		const entry = group.entries[index];
		const block = entry.block;
		const key = `${entry.messageId}:${entry.key}`;
		if (block.kind === "thinking") nodes.push(<ProcessDisclosure key={key} className="thinking" icon="spark" label={<span>思考了 1 段（<span className="thinking-size">{block.text.trim().length.toLocaleString("en-US")} 字</span>）</span>}><pre>{block.text}</pre></ProcessDisclosure>);
		else if (block.kind === "tool") {
			const items: ToolRunItem[] = [{ key: index, block, result: entry.result }];
			while (group.entries[index + 1]?.block.kind === "tool" && group.entries[index + 1].messageId === entry.messageId) {
				const next = group.entries[++index];
				if (next.block.kind === "tool") items.push({ key: index, block: next.block, result: next.result });
			}
			nodes.push(items.length > 1 ? <ToolRun key={key} items={items} /> : <ToolCallBlock key={key} tool={block} result={entry.result} />);
		} else if (block.kind === "toolResult") nodes.push(<ProcessDisclosure key={key} className={`tool-result ${block.isError ? "err" : ""}`} icon={TOOL_ICONS[toolKind(block.name)]} label="执行结果" status={block.isError ? "执行失败" : "已完成"}><pre>{block.text}</pre></ProcessDisclosure>);
	}
	return <ProcessDisclosure className={`turn-process turn-process-${group.placement}`} icon="spark" label={<span className="process-count-label">{label}</span>} title={label} summaryLabel={`${expanded ? "收起" : "展开"}${group.placement === "head" ? "本轮" : "此段"}执行过程`} status={<ProcessStatus running={active} error={error} label={state} />} expanded={expanded} onExpandedChange={(value) => onExpandedChange(group.id, value)} collapseOnSpace>
		<div className="turn-process-body">{nodes.length ? nodes : <span className="muted">暂无过程详情</span>}</div>
	</ProcessDisclosure>;
}
