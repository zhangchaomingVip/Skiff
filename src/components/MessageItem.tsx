import { memo } from "react";
import type { ChatMessage, ContentBlock } from "../chat/types";
import { splitAttachments } from "../chat/textAttachments";
import { formatDuration } from "../chat/usage";
import { shouldShowThinking } from "../chat/thinking";
import type { ModelDisplay } from "../chat/modelDisplay";
import type { ToolRunItem } from "../chat/toolRuns";
import { Markdown } from "./Markdown";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolRun } from "./ToolRun";
import { TextAttachmentBlock } from "./TextAttachmentBlock";
import { CopyButton } from "./CopyButton";
import { TurnUsage } from "./TurnUsage";
import { Icon } from "./Icon";
import { ImagePreview } from "./ImagePreview";
import { BrandIcon } from "./BrandIcon";

export type MessageAction = (message: ChatMessage) => void;

/** Compact, locale-aware timestamp shown beside a message role. */
const formatMessageTime = (ts?: number): string | undefined => {
	if (!ts) return undefined;
	const diff = Date.now() - ts;
	if (diff < 60_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return new Date(ts).toLocaleDateString([], { month: "numeric", day: "numeric" });
};
type Tool = Extract<ContentBlock, { kind: "tool" }>;
type Result = Extract<ContentBlock, { kind: "toolResult" }>;

export const MessageItem = memo(function MessageItem({ message, turnMessages, showRole, roleDisplay, compact, running, turnId, turnHead, turnSteps, turnDuration, turnOpen, onToggleTurn, disabled, isLast, onContinue, onEdit, onRegenerate, onDelete }: {
	turnMessages?: ChatMessage[];
	message: ChatMessage; showRole: boolean; roleDisplay: ModelDisplay; compact: boolean; running: boolean; turnId: string; turnHead: boolean; turnSteps: number; turnDuration?: number; turnOpen: boolean; onToggleTurn: (turnId: string) => void; disabled: boolean; isLast: boolean; onContinue: () => void; onEdit: MessageAction; onRegenerate: MessageAction; onDelete: MessageAction;
}) {
	const isUser = message.role === "user";
	const text = message.blocks.filter((b) => b.kind === "text").map((b) => b.text).join("\n\n");
	const results = message.blocks.filter((b): b is Result => b.kind === "toolResult");
	const matched = new Set<Result>();
	const rendered: { key: number; block: ContentBlock; result?: Result }[] = [];
	message.blocks.forEach((block, index) => {
		if (block.kind === "toolResult") return;
		const result = block.kind === "tool" ? results.find((r) => !matched.has(r) && (r.id ? r.id === block.id : r.name === block.name)) : undefined;
		if (result) matched.add(result);
		rendered.push({ key: index, block, result });
	});
	results.forEach((result, index) => { if (!matched.has(result)) rendered.push({ key: message.blocks.length + index, block: result }); });
	const nodes = [];
	for (let index = 0; index < rendered.length; index++) {
		const entry = rendered[index];
		const block = entry.block;
		// A collapsed turn hides every step (reasoning and tool calls), keeping only the reply text.
		if (!turnOpen && (block.kind === "thinking" || block.kind === "tool" || block.kind === "toolResult")) continue;
		if (block.kind === "tool") {
			const group: ToolRunItem[] = [{ key: entry.key, block, result: entry.result }];
			while (rendered[index + 1]?.block.kind === "tool") {
				const next = rendered[++index];
				group.push({ key: next.key, block: next.block as Tool, result: next.result });
			}
			nodes.push(group.length > 1 ? <ToolRun key={entry.key} items={group} /> : <ToolCallBlock key={entry.key} tool={group[0].block} result={group[0].result} />);
		} else if (block.kind === "text") {
			const parsed = isUser ? splitAttachments(block.text) : undefined;
			if (parsed?.attachments.length) nodes.push(<div key={entry.key} className="text-with-attachments">{parsed.text && <Markdown text={parsed.text} />}{parsed.attachments.map((attachment, i) => <TextAttachmentBlock key={i} attachment={attachment} />)}</div>);
			else nodes.push(<Markdown key={entry.key} text={block.text} streaming={message.streaming} />);
		}
		else if (block.kind === "image") nodes.push(<ImagePreview key={entry.key} src={`data:${block.mimeType};base64,${block.data}`} />);
		else if (block.kind === "thinking") {
			// Short filler reasoning disappears once the turn settles.
			if (!shouldShowThinking(block.text, !!message.streaming)) continue;
			nodes.push(<details key={entry.key} className="thinking"><summary><Icon name="spark" size={13} /><span>思考过程</span><span className="thinking-size">{block.text.trim().length} 字</span><span className="disclosure"><Icon name="chevron" size={11} /></span></summary><pre>{block.text}</pre></details>);
		}
		else nodes.push(<details key={entry.key} className={`tool-result ${block.isError ? "err" : ""}`}><summary>{block.name} · 执行结果</summary><pre>{block.text}</pre></details>);
	}
	// Copy / regenerate / delete only sit on the newest message; earlier assistant steps stay clean.
	const showActions = isUser || isLast;
	const showHeader = !isUser && turnHead && turnSteps > 0;
	// Intermediate process-only messages vanish when the turn is collapsed.
	if (!nodes.length && !showHeader && !message.streaming) return null;
	return <article className={`msg ${isUser ? "user" : "assistant"}${compact ? " compact" : ""}`} aria-label={isUser ? "你的消息" : "Skiff 的消息"}>
		{showRole && <div className="msg-role">{roleDisplay.brand && <BrandIcon name={roleDisplay.brand} size={14} />}{roleDisplay.label}{message.timestamp !== undefined && <span className="msg-time">{formatMessageTime(message.timestamp)}</span>}</div>}
		<div className="msg-body">
			{showHeader && <div className="turn-header">
				<button className="thinking-toggle" onClick={() => onToggleTurn(turnId)} aria-expanded={turnOpen} aria-label={turnOpen ? "收起本轮执行过程" : "展开本轮执行过程"} title={turnOpen ? "收起本轮执行过程" : "展开本轮执行过程"}>
					<Icon name="chevron" size={14} />
					<span>{turnDuration !== undefined ? `耗时${formatDuration(turnDuration)} ` : ""}{turnSteps}步</span>
				</button>
			</div>}
			{!nodes.length && message.streaming ? <span className="typing">正在思考…</span> : nodes}
		</div>
		{(showActions || (!isUser && isLast && !running)) && <div className="message-actions">
			{!isUser && isLast && !running && message.usage && <TurnUsage message={message} messages={turnMessages} />}
			{!isUser && isLast && !running && <button className={`continue-btn ${message.stopReason === "length" ? "truncated" : ""}`} disabled={disabled} onClick={onContinue} aria-label="继续生成" title="发送「继续」，让模型接着写下去">{message.stopReason === "length" ? "输出被截断 · 继续" : "继续"}</button>}
			{showActions && <div className="message-buttons">
				<CopyButton text={text} label="复制消息" />
				{isUser ? <button disabled={disabled} onClick={() => onEdit(message)} aria-label="编辑并重发" title="编辑并重发"><Icon name="edit" size={14} /></button> : <button disabled={disabled} onClick={() => onRegenerate(message)} aria-label="重新生成" title="从上一条提问重新生成"><Icon name="refresh" size={14} /></button>}
				<button disabled={disabled} onClick={() => onDelete(message)} aria-label="删除本轮及后续消息" title="删除本轮及后续消息（保留原会话文件）"><Icon name="trash" size={14} /></button>
			</div>}
		</div>}
	</article>;
});
