import { outcomeLabel } from "../chat/interactions";
import { Button } from "./ui";
import { SearchText } from "./SearchText";
import { memo } from "react";
import type { ChatMessage, ContentBlock } from "../chat/types";
import { splitAttachments } from "../chat/textAttachments";
import { TurnSummary } from "./TurnSummary";
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
import { DisclosureButton, DisclosureLabel } from "./Disclosure";

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

export const MessageItem = memo(function MessageItem({ onEdit, onRegenerate, onContinue, continuing, turnOutcome, searchQuery, message, turnMessages, showRole, roleDisplay, compact, running, turnRunning = false, turnId, turnHead, turnSteps, turnDuration, turnOpen, onToggleTurn, isLast, readOnly = false }: {
	onEdit?: (message: ChatMessage) => void; onRegenerate?: (message: ChatMessage) => void; onContinue?: () => void; continuing?: boolean; turnOutcome?: string;
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
			const parsed = isUser ? splitAttachments(block.text) : undefined;
			if (parsed?.attachments.length) nodes.push(<div key={entry.key} className="text-with-attachments">{parsed.text && <Markdown text={parsed.text} />}{parsed.attachments.map((attachment, i) => <TextAttachmentBlock key={i} attachment={attachment} />)}</div>);
			else nodes.push(<Markdown key={entry.key} text={block.text} streaming={message.streaming} />);
		}
		else if (block.kind === "image") nodes.push(<ImagePreview key={entry.key} src={`data:${block.mimeType};base64,${block.data}`} />);
		else if (block.kind === "thinking") {
			// Short filler reasoning disappears once the turn settles.
			if (!shouldShowThinking(block.text, !!message.streaming)) continue;
			nodes.push(<details key={entry.key} className="thinking"><summary className="process-disclosure"><DisclosureLabel status={<span className="thinking-size">{block.text.trim().length} 字</span>}><Icon name="spark" size={13} /><span>思考过程</span></DisclosureLabel></summary><pre>{block.text}</pre></details>);
		}
		else nodes.push(<details key={entry.key} className={`tool-result ${block.isError ? "err" : ""}`}><summary>{block.name} · 执行结果</summary><pre>{block.text}</pre></details>);
	}
	// Keep action buttons in the DOM so keyboard users can reach earlier replies.
	const showActions = true;
	const showHeader = !isUser && turnHead && (turnSteps > 0 || turnRunning || !!outcomeLabel(turnOutcome));
	const showUsage = !isUser && !turnRunning && !message.streaming && !(isLast && running) && turnMessages?.some((entry) => entry.usage);
	// Intermediate process-only messages vanish when the turn is collapsed.
	if (!nodes.length && !showHeader && !showUsage && !message.streaming && !showActions) return null;
	return <article data-message-id={message.id} data-search-hit={searchQuery ? "true" : undefined} className={`msg ${isUser ? "user" : "assistant"}${compact ? " compact" : ""}${searchQuery ? " search-message-hit" : ""}`} aria-label={isUser ? "你的消息" : "Skiff 的消息"}>
		{showRole && <div className="msg-role">{roleDisplay.brand && <BrandIcon name={roleDisplay.brand} size={14} />}{roleDisplay.label}{message.timestamp !== undefined && <span className="msg-time">{formatMessageTime(message.timestamp)}</span>}</div>}
		{searchQuery && <details open className="search-source"><summary>搜索命中原文</summary><pre><SearchText text={text} query={searchQuery} /></pre></details>}
		<div className="msg-body">
			{isUser && message.turnResult === "manual" && <span className="turn-outcome manual">已手动停止{onContinue && <Button disabled={continuing} onClick={onContinue}>继续</Button>}</span>}
			{showHeader && <div className="turn-header">
				{turnSteps > 0 ? <DisclosureButton className="thinking-toggle" expanded={turnOpen} onClick={() => onToggleTurn(turnId)} aria-label={turnOpen ? "收起本轮执行过程" : "展开本轮执行过程"} title={turnOpen ? "收起本轮执行过程" : "展开本轮执行过程"}>
					<TurnSummary turnId={turnId} durationMs={turnDuration} steps={turnSteps} />
				</DisclosureButton> : <TurnSummary turnId={turnId} durationMs={turnDuration} steps={0} />}
			{(!turnRunning || turnOutcome === "length") && turnOutcome !== "manual" && outcomeLabel(turnOutcome) && <span className={`turn-outcome ${turnOutcome ?? ""}`}>{outcomeLabel(turnOutcome)}{(turnOutcome === "length" || turnOutcome === "aborted" || turnOutcome === "manual") && !readOnly && onContinue && <Button disabled={continuing} onClick={onContinue}>继续</Button>}</span>}
			</div>}
			{!nodes.length && message.streaming ? <span className="typing">正在思考…</span> : nodes}
		</div>
		{(showActions || showUsage) && <div className="message-actions">
			{showActions && <div className="message-buttons">
				<CopyButton text={text} label="复制消息" />
				{!readOnly && isUser && <Button variant="ghost" disabled={!onEdit || running} onClick={() => onEdit?.(message)}>编辑并重发</Button>}
				{!readOnly && !isUser && isLast && <Button variant="ghost" disabled={!onRegenerate || running} onClick={() => onRegenerate?.(message)}>重新生成</Button>}
			</div>}
			{showUsage && <TurnUsage message={message} messages={turnMessages} />}
		</div>}
	</article>;
});
