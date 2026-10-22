import { useMemo } from "react";
import type { TurnProcessGroup as ProcessGroup } from "../chat/turnProcess";
import { processStatus } from "../chat/processStatus";
import { useProcessActivity } from "../chat/useProcessActivity";
import { toolKind, type ToolRunItem } from "../chat/toolRuns";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolRun } from "./ToolRun";
import { TOOL_ICONS } from "./toolIcons";
import { ThinkingContent } from "./ThinkingContent";

/** The same process row wraps the prelude and each quieter interruption between reply paragraphs. */
export function TurnProcessGroup({ group, running, outcome, expanded, onExpandedChange }: { group: ProcessGroup; running: boolean; outcome?: string; expanded: boolean; onExpandedChange: (id: string, expanded: boolean) => void }) {
	const { active, error, label: summary, modelLabel, detailLabel, visible } = useMemo(() => processStatus(group, running, outcome), [group, running, outcome]);
	const elapsed = useProcessActivity(group, active && visible);
	if (!visible) return null;
	const nodes = [];
	for (let index = 0; index < group.entries.length; index++) {
		const entry = group.entries[index];
		const block = entry.block;
		const key = `${entry.messageId}:${entry.key}`;
		if (block.kind === "thinking") nodes.push(<ProcessDisclosure key={key} className="thinking" icon="spark" label={<span>思考了 1 段（<span className="thinking-size">{block.text.trim().length.toLocaleString("en-US")} 字</span>）</span>}><ThinkingContent text={block.text} /></ProcessDisclosure>);
		else if (block.kind === "tool") {
			const items: ToolRunItem[] = [{ key: index, block, result: entry.result }];
			while (group.entries[index + 1]?.block.kind === "tool" && group.entries[index + 1].messageId === entry.messageId) {
				const next = group.entries[++index];
				if (next.block.kind === "tool") items.push({ key: index, block: next.block, result: next.result });
			}
			nodes.push(items.length > 1 ? <ToolRun key={key} items={items} /> : <ToolCallBlock key={key} tool={block} result={entry.result} />);
		} else if (block.kind === "toolResult") nodes.push(<ProcessDisclosure key={key} className={`tool-result ${block.isError ? "err" : ""}`} icon={TOOL_ICONS[toolKind(block.name)]} label="执行结果" status={block.isError ? "执行失败" : undefined}><pre>{block.text}</pre></ProcessDisclosure>);
	}
	return <ProcessDisclosure className={`turn-process turn-process-${group.placement}${modelLabel ? " has-model-label" : ""}${active ? " is-active" : ""}${error ? " is-failed" : ""}`} icon="spark" label={<><span className={`process-count-label${modelLabel ? " has-model-label" : ""}`}>{modelLabel ? <><span className="process-model-label">{modelLabel}</span>{detailLabel && <span className="process-meta-label">· {detailLabel}</span>}</> : summary}</span>{elapsed && <span className="process-elapsed">{elapsed}</span>}</>} summaryLabel={`${expanded ? "收起" : "展开"}${group.placement === "head" ? "本轮" : "此段"}执行过程`} status={error ? <span className="tool-state failed">失败</span> : undefined} expanded={expanded} onExpandedChange={(value) => onExpandedChange(group.id, value)} collapseOnSpace>
		<div className="turn-process-body">{nodes.length ? nodes : <span className="muted">暂无过程详情</span>}</div>
	</ProcessDisclosure>;
}
