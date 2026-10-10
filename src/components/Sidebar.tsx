import { Input, IconButton } from "./ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { Conversation, Project } from "../chat/workspace";
import { Icon } from "./Icon";
import { BrandMark } from "./BrandMark";
import { ConfirmDialog } from "./ConfirmDialog";

const dayLabel = (timestamp: number) => {
	const now = new Date();
	const date = new Date(timestamp);
	const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
	if (days <= 0) return "今天";
	if (days === 1) return "昨天";
	if (days < 7) return "本周";
	if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月`;
	return `${date.getFullYear()}年${date.getMonth() + 1}月`;
};

const highlight = (text: string, query: string) => {
	const q = query.trim().toLowerCase();
	const index = q ? text.toLowerCase().indexOf(q) : -1;
	if (index < 0) return text;
	return <>{text.slice(0, index)}<mark className="chat-highlight">{text.slice(index, index + q.length)}</mark>{text.slice(index + q.length)}</>;
};

const readOrder = (): string[] => { try { const value = JSON.parse(localStorage.getItem("skiff.sidebar.order") ?? "[]"); return Array.isArray(value) ? value.filter((id) => typeof id === "string") : []; } catch { return []; } };

export function SidebarCollapse({ open, id, children }: { open: boolean; id?: string; children: () => ReactNode }) {
	const [retained, setRetained] = useState(open);
	const container = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (open) { setRetained(true); return; }
		if (!retained || !container.current) return;
		// Reduced motion has no transitionend. A fallback also handles an
		// interrupted transition or an ancestor being hidden during closing.
		const style = getComputedStyle(container.current);
		const milliseconds = (value: string) => parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000);
		const durations = style.transitionDuration.split(",").map(milliseconds);
		const delays = style.transitionDelay.split(",").map(milliseconds);
		const duration = Math.max(...durations.map((value, index) => value + (delays[index % delays.length] ?? 0)));
		if (!duration) { setRetained(false); return; }
		const timer = window.setTimeout(() => setRetained(false), duration + 50);
		return () => window.clearTimeout(timer);
	}, [open, retained]);
	return <div ref={container} id={id} className={`sidebar-collapse ${open ? "expanded" : ""}`} aria-hidden={!open} {...(!open ? { inert: "" } : {})} onTransitionEnd={(event) => {
		if (!open && event.target === event.currentTarget && event.propertyName === "grid-template-rows") setRetained(false);
	}}>
		<div className="sidebar-collapse-content">{(open || retained) && children()}</div>
	</div>;
}

export function Sidebar({ projects, chats, activeId, activeProjectId, homeActive, disabled, navigationDisabled = disabled, connected, onHome, onNewChat, onSelectChat, onSelectProject, onAddProject, onClose, onRenameChat, onRenameProject, onDeleteChat, onDeleteProject, onTogglePinChat }: {
	projects: Project[];
	chats: Conversation[];
	activeId?: string;
	activeProjectId?: string;
	homeActive: boolean;
	disabled: boolean;
	navigationDisabled?: boolean;
	connected: boolean;
	onHome: () => void;
	onNewChat: () => void;
	onSelectChat: (id: string) => void;
	onSelectProject: (id: string) => void;
	onAddProject: () => void;
	onClose: () => void;
	onRenameChat: (id: string, title: string) => void;
	onRenameProject: (id: string, name: string) => void;
	onDeleteChat: (id: string) => void;
	onDeleteProject: (id: string) => void;
	onTogglePinChat: (id: string, pinned: boolean) => void;
}) {
	const projectsListId = useId();
	const [projectsExpanded, setProjectsExpanded] = useState(() => { try { return localStorage.getItem("skiff.sidebar.projects-expanded") !== "false"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.projects-expanded", String(projectsExpanded)); } catch { /* Optional layout preference. */ } }, [projectsExpanded]);
	const [collapsed, setCollapsed] = useState<Set<string>>(() => { try { const ids = JSON.parse(localStorage.getItem("skiff.sidebar.collapsed") ?? "[]"); return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []); } catch { return new Set(); } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.collapsed", JSON.stringify([...collapsed])); } catch { /* Optional layout preference. */ } }, [collapsed]);
	const [searchOpen, setSearchOpen] = useState(false);
	const [order, setOrder] = useState<string[]>(readOrder);
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.order", JSON.stringify(order)); } catch { /* Optional layout preference. */ } }, [order]);
	const [search, setSearch] = useState("");
	const [editing, setEditing] = useState<{ id: string; kind: "chat" | "project"; text: string; scope?: string }>();
	const [deleting, setDeleting] = useState<{ id: string; kind: "chat" | "project"; name: string }>();
	const [menu, setMenu] = useState<{ x: number; y: number; chatId: string; scope: string }>();
	const [dragId, setDragId] = useState<string>();
	const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean; scope: string }>();
	const skipBlur = useRef(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const closeMenu = () => setMenu(undefined);
	useEffect(() => {
		if (!menu) return;
		const onPointerDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) closeMenu(); };
		const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("resize", closeMenu);
		return () => { window.removeEventListener("pointerdown", onPointerDown); window.removeEventListener("keydown", onKeyDown); window.removeEventListener("resize", closeMenu); };
	}, [menu]);

	// Edge fades hint that the list continues above or below the viewport.
	const updateScrollFades = () => {
		const el = scrollRef.current;
		if (!el) return;
		el.classList.toggle("faded-top", el.scrollTop > 0);
		el.classList.toggle("faded-bottom", el.scrollTop + el.clientHeight < el.scrollHeight - 1);
	};
	useEffect(() => { updateScrollFades(); });

	const commitRename = () => {
		if (!editing) return;
		if (editing.kind === "chat") onRenameChat(editing.id, editing.text);
		else onRenameProject(editing.id, editing.text);
		setEditing(undefined);
	};
	const startEdit = (next: { id: string; kind: "chat" | "project"; text: string; scope?: string }) => { skipBlur.current = false; setEditing(next); };
	const cancelRename = () => { skipBlur.current = true; setEditing(undefined); };
	const renameInput = () => editing && <Input className="rename-input" autoFocus aria-label="新名称" value={editing.text} onChange={(event) => setEditing({ ...editing, text: event.target.value })} onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } commitRename(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); cancelRename(); } if (event.key === "Enter") { event.preventDefault(); commitRename(); } }} />;

	const sortedChats = useMemo(() => {
		const rank = new Map(order.map((id, index) => [id, index]));
		return [...chats].sort((a, b) => {
			if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
			const aRank = rank.get(a.id);
			const bRank = rank.get(b.id);
			if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;
			if (aRank !== undefined) return -1;
			if (bRank !== undefined) return 1;
			return b.updatedAt - a.updatedAt;
		});
	}, [chats, order]);
	const projectHistory = useMemo(() => {
		const projectNames = new Map(projects.map((project) => [project.id, project.name.toLowerCase()]));
		const histories = new Map<string, Conversation[]>();
		const recent: Conversation[] = [];
		const query = search.toLowerCase();
		for (const chat of sortedChats) {
			if ((!chat.hasMessages && chat.id !== activeId) || (query && !chat.title.toLowerCase().includes(query) && !projectNames.get(chat.projectId)?.includes(query))) continue;
			recent.push(chat);
			const bucket = histories.get(chat.projectId);
			if (bucket) bucket.push(chat);
			else histories.set(chat.projectId, [chat]);
		}
		return { histories, recent };
	}, [sortedChats, projects, search, activeId]);

	const openChatMenu = (event: ReactMouseEvent, chat: Conversation, scope: string) => {
		if (navigationDisabled) return;
		event.preventDefault();
		setMenu({ x: Math.min(event.clientX, window.innerWidth - 170), y: Math.min(event.clientY, window.innerHeight - 190), chatId: chat.id, scope });
	};

	const handleDrop = (list: Conversation[], targetId: string, before: boolean) => {
		const source = dragId;
		setDragId(undefined);
		setDropTarget(undefined);
		if (!source || source === targetId) return;
		const rest = list.map((chat) => chat.id).filter((id) => id !== source);
		const position = rest.indexOf(targetId);
		if (position < 0) return;
		rest.splice(before ? position : position + 1, 0, source);
		setOrder((previous) => [...rest, ...previous.filter((id) => !rest.includes(id))]);
	};

	const renderChatRow = (chat: Conversation, list: Conversation[], scope = chat.projectId) => {
		const showDrop = !!dragId && dragId !== chat.id && dropTarget?.id === chat.id && dropTarget.scope === scope;
		return <div key={chat.id} className={`chat-row ${chat.id === activeId ? "selected" : ""} ${showDrop ? (dropTarget.before ? "drop-above" : "drop-below") : ""}`} draggable={!disabled && !search && editing?.id !== chat.id} onDragStart={(event) => { setDragId(chat.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragId(undefined); setDropTarget(undefined); }} onDragOver={(event) => { if (!dragId || dragId === chat.id) return; const source = list.find((item) => item.id === dragId); if (!source || !!source.pinned !== !!chat.pinned) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: chat.id, before: event.clientY < rect.top + rect.height / 2, scope }); }} onDrop={(event) => { event.preventDefault(); handleDrop(list, chat.id, event.clientY < event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2); }} onContextMenu={(event) => openChatMenu(event, chat, scope)}>
			{editing?.id === chat.id && editing.scope === scope ? renameInput() : <button className="chat-link" disabled={navigationDisabled} onClick={() => onSelectChat(chat.id)} title={chat.title} aria-current={chat.id === activeId ? "page" : undefined}>
				<span className="chat-title">{highlight(chat.title, search)}</span>
				{chat.selectedModel && <span className="chat-model">{chat.selectedModel.id}</span>}
				{!!search && <time dateTime={new Date(chat.updatedAt).toISOString()}>{dayLabel(chat.updatedAt)}</time>}
			</button>}
			<div className="sidebar-row-actions">
				<IconButton size="compact"  disabled={disabled} aria-label={`${chat.pinned ? "取消固定" : "固定"}聊天 ${chat.title}`} title={chat.pinned ? "取消固定" : "固定到顶部"} onClick={() => onTogglePinChat(chat.id, !chat.pinned)}><Icon name="pin" size={13} /></IconButton>
				<IconButton size="compact"  disabled={disabled} aria-label={`重命名聊天 ${chat.title}`} title="重命名聊天（Enter 或失焦保存）" onClick={() => startEdit({ id: chat.id, kind: "chat", text: chat.title, scope })}><Icon name="edit" size={13} /></IconButton>
				<IconButton size="compact"  disabled={disabled} aria-label={`删除聊天 ${chat.title}`} title="从侧栏删除聊天" onClick={() => setDeleting({ id: chat.id, kind: "chat", name: chat.title })}><Icon name="trash" size={13} /></IconButton>
			</div>
		</div>;
	};

	const menuChat = menu && chats.find((chat) => chat.id === menu.chatId);
	const visibleProjects = useMemo(() => projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()) || chats.some((chat) => chat.projectId === project.id && chat.title.toLowerCase().includes(search.toLowerCase()))), [projects, chats, search]);
	const recentChats = projectHistory.recent;
	return (
		<aside className="sidebar" aria-label="项目与聊天导航">
			{deleting && <ConfirmDialog title={deleting.kind === "project" ? "移除项目" : "删除聊天"} description={deleting.kind === "project" ? `从侧栏移除 ${deleting.name} 及其聊天，磁盘上的项目与会话文件会保留。` : `从侧栏删除 ${deleting.name}，pi 会话文件会保留。`} onConfirm={() => { if (deleting.kind === "project") onDeleteProject(deleting.id); else onDeleteChat(deleting.id); }} onClose={() => setDeleting(undefined)} />}
			<div className="sidebar-brand"><BrandMark /><span>Skiff</span><IconButton size="compact" className="sidebar-search-toggle" onClick={() => setSearchOpen((open) => !open)} aria-label="搜索项目与聊天" aria-expanded={searchOpen} title="搜索项目与聊天"><Icon name="search" size={16} /></IconButton><IconButton size="compact" className="sidebar-toggle" onClick={onClose} aria-label="收起侧栏" title="收起侧栏"><Icon name="panel" /></IconButton></div>
			<button className="new-chat" onClick={onNewChat} disabled={!projects.length}><Icon name="edit" /><span>新聊天</span><span className="shortcut">Ctrl N</span></button>
			<button className={`home-nav ${homeActive ? "active" : ""}`} onClick={onHome} disabled={!projects.length} aria-current={homeActive ? "page" : undefined}><Icon name="home" /><span>主页</span></button>
			{searchOpen && <div className="sidebar-search"><Icon name="search" size={14} /><Input autoFocus aria-label="搜索项目与聊天" placeholder="搜索项目与聊天" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setSearch(""); setSearchOpen(false); } }} /><IconButton size="compact"  onClick={() => { setSearch(""); setSearchOpen(false); }} aria-label="关闭搜索" title="关闭搜索"><Icon name="close" size={13} /></IconButton></div>}
			<div className="sidebar-scroll" ref={scrollRef} onScroll={updateScrollFades} onTransitionEnd={updateScrollFades}>
				<div className="section-label"><button type="button" className="section-name" onClick={() => setProjectsExpanded((expanded) => !expanded)} aria-expanded={projectsExpanded} aria-controls={projectsListId} title={projectsExpanded ? "收起项目" : "展开项目"}>项目<span className={`section-toggle ${projectsExpanded ? "expanded" : ""}`}><Icon name="chevron" size={13} /></span></button><IconButton size="compact"  onClick={onAddProject} disabled={disabled} aria-label="添加项目" title="添加项目"><Icon name="plus" size={16} /></IconButton></div>
				<SidebarCollapse open={projectsExpanded} id={projectsListId}>
					{() => <nav aria-label="项目列表">
						{visibleProjects.map((project) => {
							const isCollapsed = collapsed.has(project.id);
							const history = projectHistory.histories.get(project.id) ?? [];
							const renderRows = () => {
								if (search) return history.map((chat) => renderChatRow(chat, history));
								const rows: ReactNode[] = [];
								const pinnedChats = history.filter((chat) => chat.pinned);
								if (pinnedChats.length) {
									rows.push(<div className="chat-group-label" key="pinned">已固定</div>);
									rows.push(...pinnedChats.map((chat) => renderChatRow(chat, history)));
								}
								const groups = new Map<string, Conversation[]>();
								for (const chat of history.filter((item) => !item.pinned)) {
									const label = dayLabel(chat.updatedAt);
									const bucket = groups.get(label);
									if (bucket) bucket.push(chat);
									else groups.set(label, [chat]);
								}
								for (const [label, items] of groups) {
									rows.push(<div className="chat-group-label" key={label}>{label}</div>);
									rows.push(...items.map((chat) => renderChatRow(chat, history)));
								}
								return rows;
							};
							return <div className="project-group" key={project.id}>
								<div className={`project-row ${project.id === activeProjectId ? "current" : ""}`}>
									<IconButton size="compact" className={`project-chevron ${!isCollapsed || search ? "expanded" : ""}`} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; })} aria-label={`${!isCollapsed || search ? "收起" : "展开"}${project.name}`} aria-expanded={!isCollapsed || !!search} aria-controls={`${projectsListId}-${project.id}`}><Icon name="chevron" size={13} /></IconButton>
									{editing?.id === project.id ? renameInput() : <button className="project-select" disabled={navigationDisabled} onClick={() => onSelectProject(project.id)} title={project.path}><Icon name="folder" size={15} /><span>{project.name}</span><span className="project-count">{history.length}</span></button>}
									<div className="sidebar-row-actions"><IconButton size="compact"  disabled={disabled} aria-label={`重命名项目 ${project.name}`} title="重命名项目（Enter 或失焦保存）" onClick={() => startEdit({ id: project.id, kind: "project", text: project.name })}><Icon name="edit" size={13} /></IconButton><IconButton size="compact"  disabled={disabled || projects.length <= 1} aria-label={`移除项目 ${project.name}`} title={projects.length <= 1 ? "至少保留一个项目" : "移除项目"} onClick={() => setDeleting({ id: project.id, kind: "project", name: project.name })}><Icon name="trash" size={13} /></IconButton></div>
								</div>
								<SidebarCollapse open={!isCollapsed || !!search} id={`${projectsListId}-${project.id}`}>
									{() => <div className="project-chats">
										{renderRows()}
										{!history.length && <span className="no-chats">还没有聊天</span>}
									</div>}
								</SidebarCollapse>
							</div>;
						})}
					</nav>}
				</SidebarCollapse>
				<section className="sidebar-recent" aria-label="最近任务">
					<h2 className="section-label">最近</h2>
					<nav aria-label="最近任务列表">
						{recentChats.map((chat) => renderChatRow(chat, recentChats, "recent"))}
						{!recentChats.length && <span className="no-chats">{search ? "没有匹配的最近任务" : "还没有最近任务"}</span>}
					</nav>
				</section>
			</div>
			<div className="sidebar-footer"><span className={`dot ${connected ? "on" : "off"}`} /><span>{connected ? "pi 已连接" : "pi 未连接"} · 本地工作区</span></div>
			{menu && menuChat && <div className="sidebar-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} role="menu">
				<button disabled={navigationDisabled} onClick={() => { onSelectChat(menu.chatId); closeMenu(); }}><Icon name="message" size={14} />打开</button>
				<button disabled={disabled} onClick={() => { startEdit({ id: menu.chatId, kind: "chat", text: menuChat.title, scope: menu.scope }); closeMenu(); }}><Icon name="edit" size={14} />重命名</button>
				<button disabled={disabled} onClick={() => { onTogglePinChat(menu.chatId, !menuChat.pinned); closeMenu(); }}><Icon name="pin" size={14} />{menuChat.pinned ? "取消固定" : "固定到顶部"}</button>
				<button className="danger" disabled={disabled} onClick={() => { setDeleting({ id: menu.chatId, kind: "chat", name: menuChat.title }); closeMenu(); }}><Icon name="trash" size={14} />删除</button>
			</div>}
		</aside>
	);
}
