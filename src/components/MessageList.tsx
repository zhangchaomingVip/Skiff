import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ModelInfo, SessionState } from "../chat/types";
import { groupTurns } from "../chat/turns";
import { modelDisplay } from "../chat/modelDisplay";
import { MessageItem, type MessageAction } from "./MessageItem";
import { Icon } from "./Icon";
import { WaitingReply } from "./WaitingReply";

/** Scrolling transcript with an auto-follow anchor at the bottom. */
export function MessageList({ messages, pendingPrompt, activeTurnId, projectName, running, models, model, onSuggestion, followSignal, disabled, onContinue, onEdit, onRegenerate, onDelete }: { messages: ChatMessage[]; pendingPrompt?: SessionState["pendingPrompt"]; activeTurnId?: string; projectName?: string; running: boolean; models: ModelInfo[]; model?: ModelInfo; onSuggestion: (text: string) => void; followSignal: number; disabled: boolean; onContinue: () => void; onEdit: MessageAction; onRegenerate: MessageAction; onDelete: MessageAction }) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const followingRef = useRef(true);
	const [away, setAway] = useState(false);
	const [unread, setUnread] = useState(false);
	const [collapsedTurns, setCollapsedTurns] = useState<string[]>([]);
	const displayMessages = useMemo(() => pendingPrompt?.userMessage ? [...messages, pendingPrompt.userMessage] : messages, [messages, pendingPrompt?.userMessage]);
	const turns = useMemo(() => groupTurns(displayMessages), [displayMessages]);
	const lastTurnMessages = useMemo(() => displayMessages.filter((_, index) => turns[index].turnId === turns[turns.length - 1]?.turnId), [displayMessages, turns]);
	const waitingForAssistant = running && activeTurnId !== undefined && (pendingPrompt !== undefined || (displayMessages[displayMessages.length - 1]?.role === "user" && turns[turns.length - 1]?.turnId === activeTurnId));
	const toggleTurn = useCallback((turnId: string) => setCollapsedTurns((list) => list.includes(turnId) ? list.filter((id) => id !== turnId) : [...list, turnId]), []);
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
	}, [displayMessages, waitingForAssistant]);

	if (displayMessages.length === 0 && !waitingForAssistant) {
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

	return (
		<div className="transcript">
		<div className="messages" ref={scrollRef} onScroll={() => { const el = scrollRef.current; if (el) { followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; setAway(!followingRef.current); if (followingRef.current) setUnread(false); } }}>
			{displayMessages.map((message, index) => (
				<MessageItem key={message.id} message={message} turnMessages={index === displayMessages.length - 1 ? lastTurnMessages : undefined} showRole={index === 0 || displayMessages[index - 1].role !== message.role} roleDisplay={message.role === "user" ? { label: "你" } : modelDisplay(message, models, model)} compact={message.role === "assistant" && displayMessages[index + 1]?.role === "assistant"} running={running} turnRunning={running && turns[index].turnId === activeTurnId} turnId={turns[index].turnId} turnHead={turns[index].head} turnSteps={turns[index].stepCount} turnDuration={turns[index].durationMs} turnOpen={!collapsedTurns.includes(turns[index].turnId)} onToggleTurn={toggleTurn} disabled={disabled} isLast={index === displayMessages.length - 1} onContinue={onContinue} onEdit={onEdit} onRegenerate={onRegenerate} onDelete={onDelete} />
			))}
			{waitingForAssistant && <WaitingReply turnId={activeTurnId} roleDisplay={modelDisplay({ id: "waiting", role: "assistant", blocks: [] }, models, model)} />}
		</div>
		{away && <button className="back-bottom" aria-label="回到底部" onClick={scrollBottom}><Icon name="down" size={15} />{unread ? "有新内容 · 回到底部" : "回到底部"}</button>}
		<span className="sr-only" role="status">{running ? "Skiff 正在生成回复" : "回复已就绪"}</span>
		</div>
	);
}
