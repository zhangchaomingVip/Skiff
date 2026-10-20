import { outcomeLabel } from "../chat/interactions";
import { Button } from "./ui";
import { SearchText } from "./SearchText";
import { memo } from "react";
import type { ChatMessage, ContentBlock } from "../chat/types";
import { splitAttachments } from "../chat/textAttachments";
import { TurnSummary } from "./TurnSummary";
import { shouldShowThinking } from "../chat/thinking";
import { turnReplyText } from "../chat/turns";
import type { ModelDisplay } from "../chat/modelDisplay";
import { toolKind, type ToolRunItem } from "../chat/toolRuns";
import { Markdown } from "./Markdown";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolRun } from "./ToolRun";
import { TextAttachmentBlock } from "./TextAttachmentBlock";
import { CopyButton } from "./CopyButton";
import { TurnUsage } from "./TurnUsage";
import { ImagePreview } from "./ImagePreview";
import { BrandIcon } from "./BrandIcon";
import { ProcessDisclosure, ProcessDisclosureButton } from "./ProcessDisclosure";
import { TOOL_ICONS } from "./toolIcons";

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

export const MessageItem = memo(function MessageItem({ onEdit, onContinue, continuing, turnOutcome, searchQuery, message, turnMessages, showRole, roleDisplay, compact, running, turnRunning = false, turnId, turnHead, turnSteps, turnDuration, turnOpen, onToggleTurn, isLast, readOnly = false }: {
	onEdit?: (message: ChatMessage) => void; onContinue?: () => void; continuing?: boolean; turnOutcome?: string;
	searchQuery?: string;
	turnMessages?: ChatMessage[]; readOnly?: boolean;
	turnRunning?: boolean;
	message: ChatMessage; showRole: boolean; roleDisplay: ModelDisplay; compact: boolean; running: boolean; turnId: string; turnHead: boolean; turnSteps: number; turnDuration?: number; turnOpen: boolean; onToggleTurn: (turnId: string) => void; isLast: boolean;
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
			if (!block.text.trim()) continue;
			const parsed = isUser ? splitAttachments(block.text) : undefined;
			if (parsed?.attachments.length) nodes.push(<div key={entry.key} className="text-with-attachments">{parsed.text && <Markdown text={parsed.text} />}{parsed.attachments.map((attachment, i) => <TextAttachmentBlock key={i} attachment={attachment} />)}</div>);
			else nodes.push(<Markdown key={entry.key} text={block.text} streaming={message.streaming} />);
		}
		else if (block.kind === "image") nodes.push(<ImagePreview key={entry.key} src={`data:${block.mimeType};base64,${block.data}`} />);
		else if (block.kind === "thinking") {
			// Short filler reasoning disappears once the turn settles.
			if (!shouldShowThinking(block.text, !!message.streaming)) continue;
			nodes.push(<ProcessDisclosure key={entry.key} className="thinking" icon="spark" label={<>思考过程 · <span className="thinking-size">{block.text.trim().length} 字</span></>}><pre>{block.text}</pre></ProcessDisclosure>);
		}
		else nodes.push(<ProcessDisclosure key={entry.key} className={`tool-result ${block.isError ? "err" : ""}`} icon={TOOL_ICONS[toolKind(block.name)]} label={`${block.name} · 执行结果`} status={block.isError ? "执行失败" : "已完成"}><pre>{block.text}</pre></ProcessDisclosure>);
	}
	// Keep action buttons in the DOM so keyboard users can reach earlier replies.
	const copyText = isUser ? text : turnMessages ? turnReplyText(turnMessages) : "";
	const canCopy = !!copyText.trim();
	const showActions = canCopy || (isUser && !readOnly);
	const showHeader = !isUser && turnHead && (turnSteps > 0 || turnRunning || !!outcomeLabel(turnOutcome));
	const showOutcome = (!turnRunning || turnOutcome === "length") && turnOutcome !== "manual" && !!outcomeLabel(turnOutcome);
	const showUsage = !isUser && !turnRunning && !message.streaming && !(isLast && running) && turnMessages?.some((entry) => entry.usage);
	// Intermediate process-only messages vanish when the turn is collapsed.
	if (!nodes.length && !showHeader && !showUsage && !message.streaming && !showActions) return null;
	const metadataOnly = !nodes.length && !showHeader && !message.streaming;
	return <article data-message-id={message.id} data-search-hit={searchQuery ? "true" : undefined} className={`msg ${isUser ? "user" : "assistant"}${compact ? " compact" : ""}${metadataOnly ? " metadata-only" : ""}${searchQuery ? " search-message-hit" : ""}`} aria-label={isUser ? "你的消息" : "Skiff 的消息"}>
		{showRole && <div className="msg-role">{roleDisplay.brand && <BrandIcon name={roleDisplay.brand} size={14} />}{roleDisplay.label}{message.timestamp !== undefined && <span className="msg-time">{formatMessageTime(message.timestamp)}</span>}</div>}
		{searchQuery && <details open className="search-source"><summary>搜索命中原文</summary><pre><SearchText text={text} query={searchQuery} /></pre></details>}
		{!metadataOnly && <div className="msg-body">
			{isUser && message.turnResult === "manual" && <span className="turn-outcome manual">已手动停止{onContinue && <Button disabled={continuing} onClick={onContinue}>继续</Button>}</span>}
			{showHeader && <div className="turn-header">
				{turnSteps > 0 ? <ProcessDisclosureButton className="thinking-toggle" icon="clock" expanded={turnOpen} onClick={() => onToggleTurn(turnId)} aria-label={turnOpen ? "收起本轮执行过程" : "展开本轮执行过程"} title={turnOpen ? "收起本轮执行过程" : "展开本轮执行过程"} label={<TurnSummary turnId={turnId} durationMs={turnDuration} steps={turnSteps} />} status={showOutcome ? <span className={`turn-outcome ${turnOutcome ?? ""}`}>{outcomeLabel(turnOutcome)}</span> : undefined} /> : <><TurnSummary turnId={turnId} durationMs={turnDuration} steps={0} />{showOutcome && <span className={`turn-outcome ${turnOutcome ?? ""}`}>{outcomeLabel(turnOutcome)}</span>}</>}
				{showOutcome && (turnOutcome === "length" || turnOutcome === "aborted") && !readOnly && onContinue && <Button disabled={continuing} onClick={onContinue}>继续</Button>}
			</div>}
			{!nodes.length && message.streaming ? <span className="typing">正在思考…</span> : nodes}
		</div>}
		{(showActions || showUsage) && <div className={`message-actions${showUsage ? " with-usage" : ""}`}>
			{showActions && <div className="message-buttons">
				{canCopy && <CopyButton text={copyText} label="复制消息" />}
				{!readOnly && isUser && <Button variant="ghost" disabled={!onEdit || running} onClick={() => onEdit?.(message)}>编辑并重发</Button>}
			</div>}
			{showUsage && <TurnUsage message={[...(turnMessages ?? [])].reverse().find((entry) => entry.role === "assistant") ?? message} messages={turnMessages} />}
		</div>}
	</article>;
});
