import { useRef, useState } from "react";
import { backgroundSessions, statusLabels, statusSymbols, type ConversationStatus } from "../chat/sessionStatus";
import { conversationLabel } from "../chat/conversationDisplay";
import type { Conversation } from "../chat/workspace";
import { Button, Popover } from "./ui";

export function BackgroundSessions({ statuses, activeId, chats, onSelect, disabled }: { statuses: ReadonlyMap<string, ConversationStatus>; activeId?: string; chats: Conversation[]; onSelect: (id: string) => void; disabled: boolean }) {
	const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
	const sessions = backgroundSessions(statuses, activeId).filter(([id]) => chats.some((chat) => chat.id === id));
	const running = sessions.filter(([, status]) => status === "running").length;
	const pending = sessions.length - running;
	return <><Button ref={anchor} onClick={() => setOpen((value) => !value)} aria-haspopup="dialog" aria-expanded={open} aria-label={`后台会话 ${sessions.length}`}>{running > 0 ? `另有 ${running} 个会话在运行` : ""}{running > 0 && pending > 0 ? " · " : ""}{pending > 0 ? `${pending} 个会话待处理` : ""}{!sessions.length ? "后台 0" : ""}</Button>
		{open && <Popover anchor={anchor} onClose={() => setOpen(false)} aria-label="后台会话" className="background-sessions">
			{sessions.length ? sessions.map(([id, status]) => <Button key={id} variant="ghost" disabled={disabled} onClick={() => { onSelect(id); setOpen(false); }}><span className={`session-status ${status}`} aria-label={statusLabels[status]}>{statusSymbols[status]}</span><span>{conversationLabel(chats.find((chat) => chat.id === id)!, chats)}</span><span>{statusLabels[status]} · 去处理</span></Button>) : <p>没有需要处理的后台会话</p>}
		</Popover>}
	</>;
}
