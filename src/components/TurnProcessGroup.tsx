
import type { TurnProcessGroup as ProcessGroup } from "../chat/turnProcess";
import { useThinkingPreview } from "../chat/useThinkingPreview";
import { useTurnElapsed } from "../chat/useTurnElapsed";
import { toolKind, type ToolRunItem } from "../chat/toolRuns";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolRun } from "./ToolRun";
import { TOOL_ICONS } from "./toolIcons";
import { Markdown } from "./Markdown";
import { ThinkingContent } from "./ThinkingContent";

/** A single stable turn header owns all reasoning and tool details. */
export function TurnProcessGroup({ group, running, outcome, durationLabel = "用时未记录", startedAt, expanded, onExpandedChange }: { group: ProcessGroup; durationLabel?: string; startedAt?: number; running: boolean; outcome?: string; expanded: boolean; onExpandedChange: (id: string, expanded: boolean) => void }) {
	const active = running && !group.closed;
	const elapsed = useTurnElapsed(active, startedAt);
	const thinking = useThinkingPreview(group, active && expanded && !group.pending && group.activeKind === "thinking");
	const summary = active ? elapsed : durationLabel;
	const status = group.error ? "有调用失败" : !running && outcome === "error" ? "响应失败" : group.pending && !active ? running ? "等待结果" : "未收到结果" : !running && (outcome === "manual" || outcome === "aborted") ? "已停止" : !running && outcome === "length" ? "输出已达长度上限" : undefined;
	const nodes = [];
	for (let index = 0; index < group.entries.length; index++) {
		const entry = group.entries[index];
		const block = entry.block;
		const key = `${entry.messageId}:${entry.key}`;
		if (block.kind === "thinking") nodes.push(<div key={key} data-process-message-id={entry.messageId}><ProcessDisclosure className="thinking" icon="spark" label={<span className="process-count-label">{index === group.entries.length - 1 && thinking ? thinking : "思考"}</span>} summaryLabel="思考" collapseOnSpace><ThinkingContent text={block.text} showLabel={false} /></ProcessDisclosure></div>);
		else if (block.kind === "text") nodes.push(<div key={key} data-process-text={`${entry.messageId}:${entry.key}`} data-process-message-id={entry.messageId}><Markdown text={block.text} streaming={active} /></div>);
		else if (block.kind === "tool") {
			const items: ToolRunItem[] = [{ key: index, block, result: entry.result }];
			while (group.entries[index + 1]?.block.kind === "tool" && group.entries[index + 1].messageId === entry.messageId) {
				const next = group.entries[++index];
				if (next.block.kind === "tool") items.push({ key: index, block: next.block, result: next.result });
			}
			nodes.push(<div key={key} data-process-message-id={entry.messageId}>{items.length > 1 ? <ToolRun items={items} /> : <ToolCallBlock tool={block} result={entry.result} />}</div>);
		} else if (block.kind === "toolResult") nodes.push(<ProcessDisclosure key={key} className={`tool-result ${block.isError ? "err" : ""}`} icon={TOOL_ICONS[toolKind(block.name)]} label="执行结果" status={block.isError ? "执行失败" : undefined}><pre>{block.text}</pre></ProcessDisclosure>);
	}
	return <ProcessDisclosure className={`turn-process turn-process-head${active ? " is-active" : ""}${group.error ? " is-failed" : ""}`} label={<><span className="process-count-label">{summary}</span></>} summaryLabel={`${expanded ? "收起" : "展开"}本轮执行过程`} status={status && <span className={group.error || outcome === "error" ? "tool-state failed" : undefined}>{status}</span>} expanded={expanded} onExpandedChange={(value) => onExpandedChange(group.id, value)} collapseOnSpace>
		<div className="turn-process-body">{nodes.length ? nodes : <span className="muted">本轮没有记录思考或工具调用</span>}</div>
	</ProcessDisclosure>;
}
