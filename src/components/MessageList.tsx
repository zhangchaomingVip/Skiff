import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ModelInfo, SessionState } from "../chat/types";
import { groupTurns, turnContentTails } from "../chat/turns";
import { MessageItem } from "./MessageItem";
import { Icon } from "./Icon";
import type { MessageReveal } from "../chat/useConversationSearch";
import { ProcessRow } from "./ProcessDisclosure";
import { classifyProviderFailure } from "../chat/modelFamilies";
import { WaitingReply } from "./WaitingReply";
import { aggregateTurnProcess, turnDurationLabel } from "../chat/turnProcess";

/** Scrolling transcript with an auto-follow anchor at the bottom. */
export function MessageList({ runStartedAt, retryAttempts, messages, pendingPrompt, activeTurnId, projectName, running, onSuggestion, followSignal, onEdit, onContinue, continuing, lastOutcome, readOnly = false, revealTurn, revealMessage }: { runStartedAt?: number; retryAttempts?: SessionState["retryAttempts"]; onEdit?: (message: ChatMessage) => void; onContinue?: () => void; continuing?: boolean; lastOutcome?: SessionState["lastOutcome"]; revealMessage?: MessageReveal; revealTurn?: { turnId: string; requestKey: string }; messages: ChatMessage[]; pendingPrompt?: SessionState["pendingPrompt"]; activeTurnId?: string; projectName?: string; running: boolean; models: ModelInfo[]; model?: ModelInfo; onSuggestion: (text: string) => void; followSignal: number; readOnly?: boolean }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const followingRef = useRef(true);
	const [away, setAway] = useState(false);
	const [unread, setUnread] = useState(false);
	const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
	const displayMessages = useMemo(() => pendingPrompt?.userMessage ? [...messages, pendingPrompt.userMessage] : messages, [messages, pendingPrompt?.userMessage]);
	const turns = useMemo(() => groupTurns(displayMessages), [displayMessages]);
	// Tool calls produce multiple pi messages, but their reply shares one visual container.
	const replyRows = useMemo(() => {
		const rows: { key: string; assistant: boolean; indices: number[] }[] = [];
		displayMessages.forEach((message, index) => {
			const previous = rows[rows.length - 1];
			if (message.role === "assistant" && previous?.assistant && previous.key === turns[index].turnId) previous.indices.push(index);
			else rows.push({ key: message.role === "user" ? message.id : turns[index].turnId, assistant: message.role === "assistant", indices: [index] });
		});
		return rows;
	}, [displayMessages, turns]);
	const processTurnId = activeTurnId ?? (running ? turns[turns.length - 1]?.turnId : undefined);
	const process = useMemo(() => aggregateTurnProcess(displayMessages, { running, activeTurnId: processTurnId }), [displayMessages, running, processTurnId]);
	const revealProcess = useCallback((turnId: string) => setExpandedGroups((list) => new Set([...list, ...process.groups.filter((group) => group.turnId === turnId).map((group) => group.id)])), [process]);
	const setProcessExpanded = useCallback((id: string, expanded: boolean) => setExpandedGroups((list) => {
		const next = new Set(list);
		if (expanded) next.add(id); else next.delete(id);
		return next;
	}), []);
	const messagesByTurn = useMemo(() => {
		const grouped = new Map<string, ChatMessage[]>();
		displayMessages.forEach((message, index) => {
			const id = turns[index].turnId;
			const turn = grouped.get(id);
			if (turn) turn.push(message);
			else grouped.set(id, [message]);
		});
		return grouped;
	}, [displayMessages, turns]);
	// pi may finish a turn with an empty assistant message carrying only usage.
	// Keep its footer on the last content step so it does not create a separate row.
	const turnTails = useMemo(() => turnContentTails(displayMessages, turns), [displayMessages, turns]);
	const lastAssistant = turnTails.get(turns[turns.length - 1]?.turnId);
	const waitingForAssistant = running && activeTurnId !== undefined && (pendingPrompt !== undefined || (displayMessages[displayMessages.length - 1]?.role === "user" && turns[turns.length - 1]?.turnId === activeTurnId));
	// A new request key lets history search reveal the same turn again later.
	useEffect(() => { if (revealTurn) revealProcess(revealTurn.turnId); }, [revealTurn?.turnId, revealTurn?.requestKey]);
	const scrollBottom = () => {
		followingRef.current = true; setAway(false); setUnread(false);
		const el = scrollRef.current;
		el?.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
	};
	useEffect(() => { scrollBottom(); }, [followSignal]);

	useEffect(() => {
		if (!followingRef.current) { setUnread(true); return; }
		// One update per frame; smooth animation is reserved for explicit jumps.
		const frame = requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "instant" }); });
		return () => cancelAnimationFrame(frame);
	}, [displayMessages, waitingForAssistant, retryAttempts]);

	useEffect(() => {
		if (!revealMessage) return;
		const index = displayMessages.findIndex((message) => message.id === revealMessage.messageId);
		if (index < 0) return;
		followingRef.current = false;
		revealProcess(turns[index].turnId);
		const message = displayMessages[index];
		const matchingKey = message.blocks.findIndex((block) => block.kind === "text" && block.text.toLocaleLowerCase().includes(revealMessage.query.toLocaleLowerCase()));
		const hidden = process.presentation.get(message.id)?.hidden.has(matchingKey);
		const target = matchingKey >= 0 ? `[data-${hidden ? "process" : "reply"}-text="${CSS.escape(`${message.id}:${matchingKey}`)}"]` : `[data-message-id="${CSS.escape(message.id)}"]`;
		const frame = requestAnimationFrame(() => {
			const root = scrollRef.current;
			(root?.querySelector(target) ?? root?.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`))?.scrollIntoView({ block: "center" });
		});
		return () => cancelAnimationFrame(frame);
	}, [revealMessage?.requestKey]);

	if (displayMessages.length === 0 && !waitingForAssistant) {
		if (readOnly) return <div className="messages archive-empty"><p>此归档没有消息</p></div>;
		return (
			<div className="messages">
				<div className="empty">
					<div className="empty-symbol"><Icon name="spark" size={28} /></div>
					<p className="empty-eyebrow">从一个想法开始</p>
					<h1>今天想做点什么？</h1>
					<p className="empty-description">一起写代码、理清思路，把想法变成现实。</p>
					{projectName && <span className="empty-project"><Icon name="folder" size={15} />{projectName}</span>}
					<div className="suggestions">
						<button onClick={() => onSuggestion("帮我了解这个项目的结构和核心模块。") }><Icon name="folder" /><strong>了解项目</strong><span>梳理结构与核心模块</span></button>
						<button onClick={() => onSuggestion("帮我检查项目中的潜在问题，并给出改进建议。") }><Icon name="search" /><strong>检查代码</strong><span>发现问题，改进实现</span></button>
						<button onClick={() => onSuggestion("帮我实现一个新功能：") }><Icon name="code" /><strong>实现功能</strong><span>从想法到可运行的代码</span></button>
					</div>
					<p className="empty-tip">点击建议填入草稿，补充后按 Enter 发送</p>
				</div>
			</div>
		);
	}

	const messageItems = displayMessages.map((message, index) => (
		<Fragment key={message.id}><MessageItem runStartedAt={runStartedAt} onEdit={onEdit} onContinue={onContinue} continuing={continuing} turnOutcome={(() => { const group = messagesByTurn.get(turns[index].turnId) ?? []; const final = [...group].reverse().find((entry) => entry.role === "assistant"); return group.find((entry) => entry.turnResult)?.turnResult ?? (lastOutcome?.turnId === turns[index].turnId ? lastOutcome.reason : final?.stopReason); })()} searchQuery={revealMessage?.messageId === message.id ? revealMessage.query : undefined} key={message.id} message={message} processPresentation={process.presentation.get(message.id)} processDuration={turnDurationLabel(messagesByTurn.get(turns[index].turnId) ?? [])} expandedGroups={expandedGroups} onExpandedChange={setProcessExpanded} turnMessages={message.role === "assistant" && turnTails.get(turns[index].turnId) === index ? messagesByTurn.get(turns[index].turnId) : undefined} compact={message.role === "assistant" && displayMessages[index - 1]?.role === "assistant"} running={running} turnRunning={running && turns[index].turnId === processTurnId} turnHead={turns[index].head} isLast={message.role === "assistant" ? index === lastAssistant && displayMessages[displayMessages.length - 1]?.role === "assistant" : index === displayMessages.length - 1} readOnly={readOnly} />
		{retryAttempts?.filter((retry) => retry.afterMessageId === message.id).map((retry) => <div key={retry.id} className="retry-progress" role="status"><ProcessRow icon="wifi" label={`${retryReason(retry.error)}，正在重新连接 ${retry.attempt}/${retry.maxAttempts}`} /></div>)}
		</Fragment>
	));
	return (
		<div className="transcript">
		<div className="messages" ref={scrollRef} onScroll={() => { const el = scrollRef.current; if (el) { followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; setAway(!followingRef.current); if (followingRef.current) setUnread(false); } }}>
			{replyRows.map((row) => row.assistant
				? <article key={row.key} className="assistant-reply" data-turn-id={row.key} aria-label="Skiff 的消息">{row.indices.map((index) => messageItems[index])}</article>
				: <Fragment key={row.key}>{row.indices.map((index) => messageItems[index])}</Fragment>)}
			{waitingForAssistant && <WaitingReply turnId={activeTurnId} startedAt={runStartedAt} />}
		</div>
		{away && <button className={`back-bottom${unread ? " has-unread" : ""}`} aria-label="回到底部" title={unread ? "有新内容 · 回到底部" : "回到底部"} onClick={scrollBottom}><Icon name="down" size={20} /><span className="sr-only">{unread ? "有新内容 · 回到底部" : "回到底部"}</span></button>}
		<span className="sr-only" role="status">{running ? "Skiff 正在生成回复" : "回复已就绪"}</span>
		</div>
	);
}

function retryReason(error: string): string {
	switch (classifyProviderFailure(error)) {
		case "timeout": return "请求超时";
		case "network": return "连接中断";
		default: return "服务器繁忙";
	}
}
