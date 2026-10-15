import { useEffect, useRef } from "react";
import type { HistoryMessage } from "../chat/historySearch";
import { Button, Dialog } from "./ui";
import { SearchText } from "./SearchText";

export function HistorySearchDialog({ title, messages, index, query, onClose }: { title: string; messages: HistoryMessage[]; index: number; query: string; onClose: () => void }) {
	const target = useRef<HTMLElement>(null);
	useEffect(() => { target.current?.scrollIntoView({ block: "center" }); }, [index]);
	return <Dialog aria-label="历史文本只读查看" className="history-search-dialog" onClose={onClose}>
		<header className="history-search-heading"><h2>{title}</h2><Button variant="ghost" onClick={onClose}>关闭历史文本</Button></header><p>历史文本 · 只读。查看不会改变当前会话上下文。</p>
		<div className="history-search-messages">{messages.map((message, row) => <article ref={row === index ? target : undefined} className={row === index ? "search-message-hit" : ""} key={row}>
			<strong>{message.role === "user" ? "你" : "Skiff"}</strong><pre><SearchText text={message.text} query={row === index ? query : ""} /></pre>
		</article>)}</div>
	</Dialog>;
}
