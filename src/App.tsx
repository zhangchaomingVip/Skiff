import { useEffect, useState } from "react";
import { usePiSession } from "./chat/usePiSession";
import { useWorkspace } from "./chat/workspace";
import { ChatView } from "./components/ChatView";
import { RawDrawer } from "./components/RawDrawer";
import { Sidebar } from "./components/Sidebar";
import { ProjectDialog } from "./components/ProjectDialog";
import { Icon } from "./components/Icon";
import type { ImageAttachment } from "./chat/types";
import { ProviderDialog, type ProviderInfo } from "./components/ProviderDialog";

export default function App() {
	const library = useWorkspace();
	const { activeChat, activeProject } = library;
	const session = usePiSession(activeChat && activeProject ? { id: activeChat.id, cwd: activeProject.path, sessionFile: activeChat.hasMessages ? activeChat.sessionFile : undefined, elapsedMs: activeChat.elapsedMs } : undefined);
	const { state, connected, rawLines, actions } = session;
	const [rawOpen, setRawOpen] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(() => { try { return localStorage.getItem("skiff.sidebar.open") !== "false"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.open", String(sidebarOpen)); } catch { /* Layout can still be used without storage. */ } }, [sidebarOpen]);
	const [projectDialogOpen, setProjectDialogOpen] = useState(false);
	const [providerDialogOpen, setProviderDialogOpen] = useState(false);
	const busy = state.isStreaming || session.pending;
	const locked = busy || (!!activeChat && !connected && !state.lastError);

	useEffect(() => {
		if (!activeChat || session.loadedId !== activeChat.id) return;
		const firstUser = state.messages.find((m) => m.role === "user");
		const title = firstUser?.blocks.filter((b) => b.kind === "text").map((b) => b.kind === "text" ? b.text : "").join(" ").replace(/\s+/g, " ").trim() || (firstUser ? "图片聊天" : "");
		library.updateChat(activeChat.id, {
			...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
			hasMessages: !!firstUser,
			...(!activeChat.customTitle ? { title: title ? title.slice(0, 48) : "新聊天" } : {}),
			elapsedMs: session.elapsedMs,
		});
	}, [activeChat?.id, session.loadedId, session.sessionFile, state.messages, session.elapsedMs]);

	const createChat = () => { if (!locked) library.createChat(); };
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
				event.preventDefault();
				createChat();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [locked, activeProject?.id, library.workspace]);

	const send = async (text: string, images?: ImageAttachment[]) => {
		if (!activeChat) return false;
		const accepted = await actions.prompt(text, images);
		if (accepted) library.updateChat(activeChat.id, { updatedAt: Date.now() });
		return accepted;
	};
	const providerSaved = (provider: ProviderInfo) => {
		setProviderDialogOpen(false);
		session.reconnect({ provider: provider.name, id: provider.modelIds[0] });
	};

	return (
		<div className={`app ${sidebarOpen ? "with-sidebar" : ""}`}>
			{sidebarOpen && <Sidebar projects={library.workspace?.projects ?? []} chats={library.workspace?.chats ?? []} activeId={activeChat?.id} activeProjectId={activeProject?.id} disabled={locked || !library.workspace} connected={connected} onNewChat={createChat} onSelectChat={library.selectChat} onSelectProject={library.selectProject} onAddProject={() => setProjectDialogOpen(true)} onClose={() => setSidebarOpen(false)} onRenameChat={library.renameChat} onRenameProject={library.renameProject} onDeleteChat={library.deleteChat} onDeleteProject={library.deleteProject} />}
			<main className="workspace">
				<header className="chat-header">
					{!sidebarOpen && <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="展开侧栏" aria-label="展开侧栏"><Icon name="panel" /></button>}
					<div className="header-title"><span>{activeChat?.title ?? "新聊天"}</span>{activeProject && <span className="header-project" title={activeProject.path}><Icon name="folder" size={14} />{activeProject.name}</span>}</div>
					<div className="header-actions">{busy && <span className="working"><span className="dot busy" />正在处理</span>}<button className="icon-btn" onClick={() => setProviderDialogOpen(true)} disabled={busy} title="配置提供商" aria-label="配置提供商"><Icon name="settings" /></button><button className={`icon-btn ${rawOpen ? "active" : ""}`} onClick={() => setRawOpen((open) => !open)} title="诊断日志" aria-label="诊断日志" aria-pressed={rawOpen}><Icon name="code" /></button></div>
				</header>
				{library.error && <div className="workspace-alert" role="alert"><span>{library.error}</span><button className="btn ghost" onClick={library.workspace ? library.clearError : () => void library.initialize()} disabled={library.loading}>{library.workspace ? "关闭" : "重试"}</button></div>}
				<div className="body">
					<ChatView key={activeChat?.id ?? "loading"} state={state} connected={connected} pending={session.pending} actions={actions} onSend={send} onReconnect={session.reconnect} projectName={activeProject?.name} />
					{rawOpen && <div className="raw-panel"><button className="icon-btn raw-close" onClick={() => setRawOpen(false)} aria-label="关闭诊断日志"><Icon name="close" /></button><RawDrawer lines={rawLines} /></div>}
				</div>
			</main>
			{projectDialogOpen && <ProjectDialog onAdd={library.addProject} onClose={() => setProjectDialogOpen(false)} />}
			{providerDialogOpen && <ProviderDialog onSaved={providerSaved} onClose={() => setProviderDialogOpen(false)} />}
		</div>
	);
}
