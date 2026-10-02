import { useEffect, useRef } from "react";
import type { ChatMessage } from "../chat/types";
import { MessageItem } from "./MessageItem";
import { Icon } from "./Icon";

/** Scrolling transcript with an auto-follow anchor at the bottom. */
export function MessageList({ messages, projectName, onSuggestion }: { messages: ChatMessage[]; projectName?: string; onSuggestion: (text: string) => void }) {
	const endRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const followingRef = useRef(true);

	useEffect(() => {
		if (followingRef.current) endRef.current?.scrollIntoView({ block: "end" });
	}, [messages]);

	if (messages.length === 0) {
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
				</div>
			</div>
		);
	}

	return (
		<div className="messages" ref={scrollRef} onScroll={() => { const el = scrollRef.current; if (el) followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
			{messages.map((message) => (
				<MessageItem key={message.id} message={message} />
			))}
			<div ref={endRef} />
		</div>
	);
}
