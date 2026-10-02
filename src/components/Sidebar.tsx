import { useState } from "react";
import type { Conversation, Project } from "../chat/workspace";
import { Icon } from "./Icon";

export function Sidebar({ projects, chats, activeId, activeProjectId, disabled, connected, onNewChat, onSelectChat, onSelectProject, onAddProject, onClose }: {
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
}) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	return (
		<aside className="sidebar" aria-label="项目与聊天导航">
			<div className="sidebar-brand"><span className="brand-mark">S</span><span>Skiff</span><button className="icon-btn sidebar-toggle" onClick={onClose} aria-label="收起侧栏" title="收起侧栏"><Icon name="panel" /></button></div>
			<button className="new-chat" onClick={onNewChat} disabled={disabled}><Icon name="edit" /><span>新聊天</span><span className="shortcut">Ctrl N</span></button>
			<div className="sidebar-scroll">
				<div className="section-label"><span>项目</span><button className="icon-btn" onClick={onAddProject} disabled={disabled} aria-label="添加项目" title="添加项目"><Icon name="plus" size={16} /></button></div>
				<nav>
					{projects.map((project) => {
						const isCollapsed = collapsed.has(project.id);
						const history = chats.filter((c) => c.projectId === project.id && (c.hasMessages || c.id === activeId)).sort((a, b) => b.updatedAt - a.updatedAt);
						return <div className="project-group" key={project.id}>
							<div className={`project-row ${project.id === activeProjectId ? "current" : ""}`}>
								<button className={`icon-btn project-chevron ${isCollapsed ? "" : "expanded"}`} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; })} aria-label={`${isCollapsed ? "展开" : "收起"}${project.name}`} aria-expanded={!isCollapsed}><Icon name="chevron" size={13} /></button>
								<button className="project-select" disabled={disabled} onClick={() => onSelectProject(project.id)} title={project.path}><Icon name="folder" /><span>{project.name}</span></button>
							</div>
							{!isCollapsed && <div className="project-chats">
								{history.map((chat) => <button key={chat.id} className={`chat-link ${chat.id === activeId ? "selected" : ""}`} disabled={disabled} onClick={() => onSelectChat(chat.id)} title={chat.title} aria-current={chat.id === activeId ? "page" : undefined}><span>{chat.title}</span>{chat.id === activeId && <span className="chat-indicator" />}</button>)}
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
