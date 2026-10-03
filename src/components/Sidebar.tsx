import { useEffect, useRef, useState } from "react";
import type { Conversation, Project } from "../chat/workspace";
import { Icon } from "./Icon";
import { ConfirmDialog } from "./ConfirmDialog";

export function Sidebar({ projects, chats, activeId, activeProjectId, disabled, connected, onNewChat, onSelectChat, onSelectProject, onAddProject, onClose, onRenameChat, onRenameProject, onDeleteChat, onDeleteProject }: {
	projects: Project[];
	chats: Conversation[];
	activeId?: string;
	activeProjectId?: string;
	disabled: boolean;
	connected: boolean;
	onNewChat: () => void;
	onSelectChat: (id: string) => void;
	onSelectProject: (id: string) => void;
	onAddProject: () => void;
	onClose: () => void;
	onRenameChat: (id: string, title: string) => void;
	onRenameProject: (id: string, name: string) => void;
	onDeleteChat: (id: string) => void;
	onDeleteProject: (id: string) => void;
}) {
	const [collapsed, setCollapsed] = useState<Set<string>>(() => { try { const ids = JSON.parse(localStorage.getItem("skiff.sidebar.collapsed") ?? "[]"); return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []); } catch { return new Set(); } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.collapsed", JSON.stringify([...collapsed])); } catch { /* Optional layout preference. */ } }, [collapsed]);
	const [search, setSearch] = useState("");
	const [editing, setEditing] = useState<{ id: string; kind: "chat" | "project"; text: string }>();
	const [deleting, setDeleting] = useState<{ id: string; kind: "chat" | "project"; name: string }>();
	const skipBlur = useRef(false);
	const commitRename = () => {
		if (!editing) return;
		if (editing.kind === "chat") onRenameChat(editing.id, editing.text);
		else onRenameProject(editing.id, editing.text);
		setEditing(undefined);
	};
	const startEdit = (next: { id: string; kind: "chat" | "project"; text: string }) => { skipBlur.current = false; setEditing(next); };
	const cancelRename = () => { skipBlur.current = true; setEditing(undefined); };
	const renameInput = () => editing && <input className="rename-input" autoFocus aria-label="新名称" value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } commitRename(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelRename(); } if (event.key === "Enter") { event.preventDefault(); commitRename(); } }} />;
	return (
		<aside className="sidebar" aria-label="项目与聊天导航">
			{deleting && <ConfirmDialog title={deleting.kind === "project" ? "移除项目" : "删除聊天"} description={deleting.kind === "project" ? `从侧栏移除 ${deleting.name} 及其聊天，磁盘上的项目与会话文件会保留。` : `从侧栏删除 ${deleting.name}，pi 会话文件会保留。`} onConfirm={() => { if (deleting.kind === "project") onDeleteProject(deleting.id); else onDeleteChat(deleting.id); }} onClose={() => setDeleting(undefined)} />}
			<div className="sidebar-brand"><span className="brand-mark">S</span><span>Skiff</span><button className="icon-btn sidebar-toggle" onClick={onClose} aria-label="收起侧栏" title="收起侧栏"><Icon name="panel" /></button></div>
			<button className="new-chat" onClick={onNewChat} disabled={disabled}><Icon name="edit" /><span>新聊天</span><span className="shortcut">Ctrl N</span></button>
			<div className="sidebar-search"><Icon name="search" size={14} /><input aria-label="搜索项目与聊天" placeholder="搜索项目与聊天" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
			<div className="sidebar-scroll">
				<div className="section-label"><span>项目</span><button className="icon-btn" onClick={onAddProject} disabled={disabled} aria-label="添加项目" title="添加项目"><Icon name="plus" size={16} /></button></div>
				<nav>
					{projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()) || chats.some((chat) => chat.projectId === project.id && chat.title.toLowerCase().includes(search.toLowerCase()))).map((project) => {
						const isCollapsed = collapsed.has(project.id);
						const history = chats.filter((c) => c.projectId === project.id && (c.hasMessages || c.id === activeId) && (!search || project.name.toLowerCase().includes(search.toLowerCase()) || c.title.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => b.updatedAt - a.updatedAt);
						return <div className="project-group" key={project.id}>
							<div className={`project-row ${project.id === activeProjectId ? "current" : ""}`}>
								<button className={`icon-btn project-chevron ${isCollapsed ? "" : "expanded"}`} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; })} aria-label={`${isCollapsed ? "展开" : "收起"}${project.name}`} aria-expanded={!isCollapsed}><Icon name="chevron" size={13} /></button>
								{editing?.id === project.id ? renameInput() : <button className="project-select" disabled={disabled} onClick={() => onSelectProject(project.id)} title={project.path}><Icon name="folder" /><span>{project.name}</span></button>}
								<div className="sidebar-row-actions"><button className="icon-btn" disabled={disabled} aria-label={`重命名项目 ${project.name}`} title="重命名项目（Enter 或失焦保存）" onClick={() => startEdit({ id: project.id, kind: "project", text: project.name })}><Icon name="edit" size={13} /></button><button className="icon-btn" disabled={disabled || projects.length <= 1} aria-label={`移除项目 ${project.name}`} title={projects.length <= 1 ? "至少保留一个项目" : "移除项目"} onClick={() => setDeleting({ id: project.id, kind: "project", name: project.name })}><Icon name="trash" size={13} /></button></div>
							</div>
							{(!isCollapsed || !!search) && <div className="project-chats">
								{history.map((chat) => <div key={chat.id} className={`chat-row ${chat.id === activeId ? "selected" : ""}`}>
									{editing?.id === chat.id ? renameInput() : <button className="chat-link" disabled={disabled} onClick={() => onSelectChat(chat.id)} title={chat.title} aria-current={chat.id === activeId ? "page" : undefined}><span>{chat.title}</span><time dateTime={new Date(chat.updatedAt).toISOString()}>{new Date(chat.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time></button>}
									<div className="sidebar-row-actions"><button className="icon-btn" disabled={disabled} aria-label={`重命名聊天 ${chat.title}`} title="重命名聊天（Enter 或失焦保存）" onClick={() => startEdit({ id: chat.id, kind: "chat", text: chat.title })}><Icon name="edit" size={13} /></button><button className="icon-btn" disabled={disabled} aria-label={`删除聊天 ${chat.title}`} title="从侧栏删除聊天" onClick={() => setDeleting({ id: chat.id, kind: "chat", name: chat.title })}><Icon name="trash" size={13} /></button></div>
								</div>)}
								{!history.length && <span className="no-chats">还没有聊天</span>}
							</div>}
						</div>;
					})}
				</nav>
			</div>
			<div className="sidebar-footer"><span className={`dot ${connected ? "on" : "off"}`} /><span>{connected ? "pi 已连接" : "pi 未连接"}</span><span className="footer-note">本地工作区</span></div>
		</aside>
	);
}
