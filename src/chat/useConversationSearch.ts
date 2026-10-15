import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HistorySearch, locateMessage, runtimeHistory, type HistoryProjection, type MessageLocation, type SearchProgress } from "./historySearch";
import type { Conversation, Project } from "./workspace";
import type { ChatMessage } from "./types";

export interface MessageReveal { chatId: string; messageId: string; query: string; requestKey: string; location: MessageLocation }
export function useConversationSearch(chats: Conversation[], projects: Project[], runtime: ReadonlyMap<string, readonly ChatMessage[]>, activeId: string | undefined, loadedId: string | undefined, select: (id: string) => void) {
	const [query, setQuery] = useState("");
	const [progress, setProgress] = useState<SearchProgress>();
	const [pending, setPending] = useState<{ location: MessageLocation; requestKey: string }>();
	const [reveal, setReveal] = useState<MessageReveal>();
	const [historyView, setHistoryView] = useState<{ chatId: string; title: string; messages: HistoryProjection["messages"]; index: number; query: string }>();
	const [notice, setNotice] = useState<string>();
	const registration = useRef<Promise<unknown>>(Promise.resolve());
	const engine = useMemo(() => new HistorySearch(async (chat, knownVersion) => {
		await registration.current;
		return invoke<HistoryProjection>("read_session_history", { chatId: chat.id, sessionFile: chat.sessionFile, knownVersion });
	}), []);
	const targets = JSON.stringify(chats.filter((chat) => chat.sessionFile).map((chat) => ({ chatId: chat.id, sessionFile: chat.sessionFile, cwd: projects.find((project) => project.id === chat.projectId)?.path })));
	useEffect(() => {
		registration.current = invoke("set_history_workspace", { targets: JSON.parse(targets) });
		void registration.current.catch(() => undefined);
	}, [targets]);
	const live = useRef({ chats, runtime, select }); live.current = { chats, runtime, select };
	const runtimeRevision = [...runtime].map(([id, messages]) => `${id}:${JSON.stringify(runtimeHistory(messages.filter((message) => !message.streaming)))}`).join(";");
	const chatRevision = chats.map((chat) => `${chat.id}:${chat.sessionFile ?? ""}`).join(";");
	useEffect(() => {
		engine.prune(chats);
		setProgress(undefined);
		if (!query.trim()) return;
		setProgress({ matches: [], scanned: 0, total: chats.length, failures: [], loading: true });
		const timer = setTimeout(() => { void engine.search(live.current.chats, query, live.current.runtime, setProgress); }, 150);
		return () => { clearTimeout(timer); engine.cancel(); };
	}, [query, chatRevision, runtimeRevision]);
	useEffect(() => { if (pending && !chats.some((chat) => chat.id === pending.location.chatId)) { setPending(undefined); setReveal(undefined); } }, [chatRevision, pending]);
	useEffect(() => {
		if (!pending || activeId !== pending.location.chatId || loadedId !== activeId) return;
		let cancelled = false;
		void (async () => {
			const { location } = pending;
			const chat = live.current.chats.find((chat) => chat.id === location.chatId);
			if (!chat || chat.sessionFile !== location.sessionFile) { setNotice("会话文件已变化，请重新搜索。"); setPending(undefined); return; }
			try {
				const history = chat.sessionFile ? await engine.history(chat, true) : { version: "runtime", messages: [] };
				if (cancelled) return;
				if (location.version !== "runtime" && history.version !== location.version) { setNotice("历史分支或文件已变化，请重新搜索后定位。"); setProgress(undefined); setPending(undefined); engine.prune(live.current.chats); return; }
				const messages = live.current.runtime.get(chat.id) ?? [];
				const index = locateMessage(runtimeHistory(messages), location);
				if (index !== undefined) setReveal({ chatId: chat.id, messageId: messages[index].id, query: location.query, requestKey: pending.requestKey, location });
				else {
					const historical = locateMessage(history.messages, location);
					if (historical === undefined) setNotice("命中消息无法唯一定位，请重新搜索。");
					else setHistoryView({ chatId: chat.id, title: chat.title, messages: history.messages, index: historical, query: location.query });
				}
			} catch { if (!cancelled) setNotice("历史无法重新读取，未定位到任何近似消息。请重试搜索。"); }
			if (!cancelled) setPending(undefined);
		})();
		return () => { cancelled = true; };
	}, [pending, activeId, loadedId]);
	const openMatch = (location: MessageLocation) => {
		setNotice(undefined); setReveal(undefined); setHistoryView(undefined);
		setPending({ location, requestKey: crypto.randomUUID() });
		live.current.select(location.chatId);
	};
	const visibleMessages = reveal ? runtime.get(reveal.chatId) ?? [] : [];
	const visibleIndex = reveal ? locateMessage(runtimeHistory(visibleMessages), reveal.location) : undefined;
	const validReveal = reveal && activeId === reveal.chatId && chats.find((chat) => chat.id === reveal.chatId)?.sessionFile === reveal.location.sessionFile && visibleIndex !== undefined && visibleMessages[visibleIndex]?.id === reveal.messageId ? reveal : undefined;
	return { query, setQuery, progress, openMatch, reveal: validReveal, historyView: historyView && chats.some((chat) => chat.id === historyView.chatId) ? historyView : undefined, closeHistory: () => setHistoryView(undefined), notice, closeNotice: () => setNotice(undefined) };
}
