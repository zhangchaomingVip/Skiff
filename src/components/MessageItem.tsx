import { outcomeLabel } from "../chat/interactions";
import { Button } from "./ui";
import { SearchText } from "./SearchText";
import { memo } from "react";
import type { ChatMessage, ContentBlock } from "../chat/types";
import { splitAttachments } from "../chat/textAttachments";
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
import { Icon } from "./Icon";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { TOOL_ICONS } from "./toolIcons";
import { processBlocks, type ProcessPresentation } from "../chat/turnProcess";
import { TurnProcessGroup } from "./TurnProcessGroup";
import { processStatus } from "../chat/processStatus";
import { ThinkingContent } from "./ThinkingContent";

/** Compact, locale-aware timestamp shown inside a message bubble. */
const formatMessageTime = (ts?: number): string | undefined => {
	if (!ts) return undefined;
	const diff = Date.now() - ts;
	if (diff < 60_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
	if (diff < 86_400_000) return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	return new Date(ts).toLocaleDateString([], { month: "numeric", day: "numeric" });
};
type Tool = Extract<ContentBlock, { kind: "tool" }>;
export const MessageItem = memo(function MessageItem({ onEdit, onContinue, continuing, turnOutcome, searchQuery, message, processPresentation, turnMessages, showRole, roleDisplay, compact, running, turnRunning = false, turnHead, expandedGroups, onExpandedChange, isLast, readOnly = false }: {
	processPresentation?: ProcessPresentation;
	expandedGroups: ReadonlySet<string>; onExpandedChange: (id: string, expanded: boolean) => void;
	onEdit?: (message: ChatMessage) => void; onContinue?: () => void; continuing?: boolean; turnOutcome?: string;
	searchQuery?: string;
	turnMessages?: ChatMessage[]; readOnly?: boolean;
	turnRunning?: boolean;
	message: ChatMessage; showRole: boolean; roleDisplay: ModelDisplay; compact: boolean; running: boolean; turnHead: boolean; isLast: boolean;
}) {
	const isUser = message.role === "user";
	const text = message.blocks.filter((b) => b.kind === "text").map((b) => b.text).join("\n\n");
	const rendered = processBlocks(message);
	const showTyping = message.streaming && !processPresentation;
	const renderProcess = (group: NonNullable<ProcessPresentation["head"]>) => <TurnProcessGroup key={group.id} group={group} running={turnRunning} outcome={turnOutcome} expanded={expandedGroups.has(group.id)} onExpandedChange={onExpandedChange} />;
	const nodes = [];
	for (let index = 0; index < rendered.length; index++) {
		const entry = rendered[index];
		const block = entry.block;
		const group = processPresentation?.groups.get(entry.key);
		if (group && block.kind !== "text") { nodes.push(renderProcess(group)); continue; }
		if (block.kind !== "text" && processPresentation?.hidden.has(entry.key)) continue;
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
			nodes.push(<ProcessDisclosure key={entry.key} className="thinking" icon="spark" label={<span>思考过程 · <span className="thinking-size">{block.text.trim().length.toLocaleString("en-US")} 字</span></span>}><ThinkingContent text={block.text} /></ProcessDisclosure>);
		}
		else nodes.push(<ProcessDisclosure key={entry.key} className={`tool-result ${block.isError ? "err" : ""}`} icon={TOOL_ICONS[toolKind(block.name)]} label="执行结果">{block.isError && <div className="tool-output-heading">error</div>}<pre>{block.text}</pre></ProcessDisclosure>);
	}
	// Keep action buttons in the DOM so keyboard users can reach earlier replies.
	const copyText = isUser ? text : turnMessages ? turnReplyText(turnMessages) : "";
	const canCopy = !!copyText.trim();
	const showActions = canCopy || (isUser && !readOnly);
	const showOutcome = (!turnRunning || turnOutcome === "length") && turnOutcome !== "manual" && !!outcomeLabel(turnOutcome);
	const showContinue = turnHead && showOutcome && (turnOutcome === "length" || turnOutcome === "aborted") && !readOnly && !!onContinue;
	const head = processPresentation?.head;
	const showHeader = !isUser && !!head && (processStatus(head, turnRunning, turnOutcome).visible || showContinue);
	const showUsage = !isUser && !turnRunning && !message.streaming && !(isLast && running) && turnMessages?.some((entry) => entry.usage);
	// Intermediate process-only messages vanish when the turn is collapsed.
	if (!nodes.length && !showHeader && !showUsage && !showTyping && !showActions) return null;
	const metadataOnly = !nodes.length && !showHeader && !showTyping;
	const showTime = message.timestamp !== undefined && !showUsage && (isUser || !!turnMessages);
	const MessageTag = isUser ? "article" : "div";
	return <MessageTag data-message-id={message.id} data-search-hit={searchQuery ? "true" : undefined} className={`msg ${isUser ? "user" : "assistant"}${compact ? " compact" : ""}${metadataOnly ? " metadata-only" : ""}${searchQuery ? " search-message-hit" : ""}`} aria-label={isUser ? "你的消息" : undefined}>
		<div className={isUser ? "message-bubble" : "message-segment"}>
		{!isUser && (showRole || turnHead) && <div className={`msg-role${showRole ? "" : " is-compact"}`} title={roleDisplay.label}>
			{roleDisplay.brand ? <BrandIcon name={roleDisplay.brand} size={14} /> : <Icon name="spark" size={14} />}
			<span className={showRole ? undefined : "sr-only"}>{roleDisplay.label}</span>
		</div>}
		{searchQuery && <details open className="search-source"><summary>搜索命中原文</summary><pre><SearchText text={text} query={searchQuery} /></pre></details>}
		{!metadataOnly && <div className="msg-body">
			{isUser && message.turnResult === "manual" && <span className="turn-outcome manual">已手动停止{onContinue && <Button disabled={continuing} onClick={onContinue}>继续</Button>}</span>}
			{showHeader && <div className="turn-header">
				{processPresentation?.head && renderProcess(processPresentation.head)}
				{showContinue && <Button disabled={continuing} onClick={onContinue}>继续</Button>}
			</div>}
			{!nodes.length && showTyping ? <span className="typing">正在思考…</span> : nodes}
		</div>}
		{(showActions || showUsage || showTime) && <div className={`message-actions${showUsage ? " with-usage" : ""}`}>
			{showActions && <div className="message-buttons">
				{canCopy && <CopyButton text={copyText} label="复制消息" />}
				{!readOnly && isUser && <Button size="compact" variant="ghost" disabled={!onEdit || running} onClick={() => onEdit?.(message)}>编辑并重发</Button>}
			</div>}
			{showUsage && <TurnUsage message={[...(turnMessages ?? [])].reverse().find((entry) => entry.role === "assistant") ?? message} messages={turnMessages} />}
			{showTime && <time className="msg-time" dateTime={new Date(message.timestamp!).toISOString()} title={new Date(message.timestamp!).toLocaleString()}>{formatMessageTime(message.timestamp)}</time>}
		</div>}
		</div>
	</MessageTag>;
});
