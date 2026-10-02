import { useEffect, useRef } from "react";
import type { ChatMessage } from "../chat/types";
import { MessageItem } from "./MessageItem";

/** Scrolling transcript with an auto-follow anchor at the bottom. */
export function MessageList({ messages }: { messages: ChatMessage[] }) {
	const endRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [messages]);

	if (messages.length === 0) {
		return (
			<div className="messages">
				<div className="empty">
					<h1>Skiff</h1>
					<p className="muted">A lightweight shell for your coding agent. Any API key. Every token visible.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="messages">
			{messages.map((message) => (
				<MessageItem key={message.id} message={message} />
			))}
			<div ref={endRef} />
		</div>
	);
}
