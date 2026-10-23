import { Input, IconButton } from "./ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { Conversation, Project } from "../chat/workspace";
import { Icon } from "./Icon";
import { calendarGroup, conversationLabel, conversationTooltip } from "../chat/conversationDisplay";
import { statusLabels, statusSymbols, type ConversationStatus } from "../chat/sessionStatus";
import type { MessageLocation, SearchProgress } from "../chat/historySearch";
import { SearchText } from "./SearchText";
import { ConfirmDialog } from "./ConfirmDialog";
import { ProjectRemoveDialog } from "./ProjectRemoveDialog";


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

export function Sidebar({ projects, chats, activeId, activeProjectId, homeActive, disabled, navigationDisabled = disabled, runningIds, statuses, searchProgress, searchQuery, onSearch, onSearchMatch, canCloseChat, connected, onHome, onNewChat, onSelectChat, onSelectProject, onAddProject, onRenameChat, onRenameProject, onDeleteChat, onHideProject, onPurgeProject, onArchiveChat, onPurgeChat, onTogglePinChat }: {
	projects: Project[];
	chats: Conversation[];
	activeId?: string;
	activeProjectId?: string;
	homeActive: boolean;
	disabled: boolean;
	navigationDisabled?: boolean;
	runningIds?: ReadonlySet<string>;
	statuses?: ReadonlyMap<string, ConversationStatus>;
	searchProgress?: SearchProgress;
	searchQuery?: string;
	onSearch?: (query: string) => void;
	onSearchMatch?: (location: MessageLocation) => void;
	canCloseChat?: (id: string) => boolean;
	connected: boolean;
	onHome: () => void;
	onNewChat: () => void;
	onSelectChat: (id: string) => void;
	onSelectProject: (id: string) => void;
	onAddProject: () => void;
	onRenameChat: (id: string, title: string) => void;
	onRenameProject: (id: string, name: string) => void;
	onDeleteChat: (id: string) => void;
	/** Collapses the project but keeps its chats, drafts and session references. */
	onHideProject: (id: string) => void;
	/** Removes the project, its chats and their pi session files. Irreversible. */
	onPurgeProject: (id: string) => void;
	onArchiveChat: (id: string) => void;
	/** Irreversible: removes the pi session file, not just the sidebar entry. */
	onPurgeChat?: (id: string) => void;
	onTogglePinChat: (id: string, pinned: boolean) => void;
}) {
	const projectsListId = useId();
	const [projectsExpanded, setProjectsExpanded] = useState(() => { try { return localStorage.getItem("skiff.sidebar.projects-expanded") !== "false"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.projects-expanded", String(projectsExpanded)); } catch { /* Optional layout preference. */ } }, [projectsExpanded]);
	const [collapsed, setCollapsed] = useState<Set<string>>(() => { try { const ids = JSON.parse(localStorage.getItem("skiff.sidebar.collapsed") ?? "[]"); return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []); } catch { return new Set(); } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.collapsed", JSON.stringify([...collapsed])); } catch { /* Optional layout preference. */ } }, [collapsed]);
	const [resultLimit, setResultLimit] = useState(200);
	const [searchOpen, setSearchOpen] = useState(!!searchQuery?.trim());
	const [order, setOrder] = useState<string[]>(readOrder);
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.order", JSON.stringify(order)); } catch { /* Optional layout preference. */ } }, [order]);
	const [localSearch, setLocalSearch] = useState("");
	const search = searchQuery ?? localSearch;
	const setSearch = (value: string) => { setLocalSearch(value); onSearch?.(value); setResultLimit(200); };
	const [editing, setEditing] = useState<{ id: string; kind: "chat" | "project"; text: string; scope?: string }>();
	const [deleting, setDeleting] = useState<{ id: string; kind: "chat" | "purge"; name: string; hasFile?: boolean }>();
	const [removingProject, setRemovingProject] = useState<{ id: string; name: string; chatCount: number; sessionCount: number }>();
	const [menu, setMenu] = useState<
		| { x: number; y: number; kind: "chat"; chatId: string; scope: string }
		| { x: number; y: number; kind: "project"; projectId: string }
	>();
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
			if ((!chat.hasMessages && !chat.hasDraft && chat.id !== activeId) || (query && !conversationLabel(chat, chats).toLowerCase().includes(query) && !projectNames.get(chat.projectId)?.includes(query))) continue;
			recent.push(chat);
			const bucket = histories.get(chat.projectId);
			if (bucket) bucket.push(chat);
			else histories.set(chat.projectId, [chat]);
		}
		return { histories, recent };
	}, [sortedChats, projects, search, activeId]);

	const menuPoint = (event: ReactMouseEvent) => ({ x: Math.min(event.clientX, window.innerWidth - 170), y: Math.min(event.clientY, window.innerHeight - 264) });
	const openChatMenu = (event: ReactMouseEvent, chat: Conversation, scope: string) => {
		if (navigationDisabled) return;
		event.preventDefault();
		setMenu({ ...menuPoint(event), kind: "chat", chatId: chat.id, scope });
	};
	// Project actions live in the context menu so the row stays quiet on hover.
	const openProjectMenu = (event: ReactMouseEvent, project: Project) => {
		if (navigationDisabled) return;
		event.preventDefault();
		setMenu({ ...menuPoint(event), kind: "project", projectId: project.id });
	};
	const removeProject = (project: Project) => {
		const projectChats = chats.filter((chat) => chat.projectId === project.id);
		setRemovingProject({ id: project.id, name: project.name, chatCount: projectChats.length, sessionCount: projectChats.filter((chat) => chat.hasMessages && chat.sessionFile).length });
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
			{editing?.id === chat.id && editing.scope === scope ? renameInput() : <button className="chat-link" disabled={navigationDisabled} onClick={() => onSelectChat(chat.id)} title={conversationTooltip(chat, chats)} aria-current={chat.id === activeId ? "page" : undefined}>
				<span className="chat-title">{highlight(conversationLabel(chat, chats), search)}</span>
				{statuses?.get(chat.id) && statuses.get(chat.id) !== "idle" ? <span className={`session-status ${statuses.get(chat.id)}`} role="status" aria-label={statusLabels[statuses.get(chat.id)!]} title={statusLabels[statuses.get(chat.id)!]}>{statusSymbols[statuses.get(chat.id)!]}</span> : runningIds?.has(chat.id) && <span className="dot busy" role="status" aria-label="正在生成" />}
				{chat.hasDraft && <span className="chat-draft">草稿</span>}
				{!!search && <time dateTime={new Date(chat.updatedAt).toISOString()}>{calendarGroup(chat.updatedAt)}</time>}
			</button>}
			<div className="sidebar-row-actions">
				<IconButton size="compact"  disabled={disabled} aria-label={`${chat.pinned ? "取消固定" : "固定"}聊天 ${chat.title}`} title={chat.pinned ? "取消固定" : "固定到顶部"} onClick={() => onTogglePinChat(chat.id, !chat.pinned)}><Icon name="pin" size={13} /></IconButton>
				<IconButton size="compact" disabled={disabled || canCloseChat?.(chat.id) === false} aria-label={`归档聊天 ${chat.title}`} title="归档聊天" onClick={() => onArchiveChat(chat.id)}><Icon name="archive" size={13} /></IconButton>
			</div>
		</div>;
	};

	const menuChat = menu?.kind === "chat" ? chats.find((chat) => chat.id === menu.chatId) : undefined;
	const menuProject = menu?.kind === "project" ? projects.find((project) => project.id === menu.projectId) : undefined;
	const visibleProjects = useMemo(() => projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()) || chats.some((chat) => chat.projectId === project.id && chat.title.toLowerCase().includes(search.toLowerCase()))), [projects, chats, search]);
	/** Cross-project quick access: recent chats whose project is collapsed, so no row shows twice. */
	const recentChats = useMemo(() => {
		const shown = new Set<string>();
		if (projectsExpanded) for (const project of visibleProjects) {
			if (collapsed.has(project.id)) continue;
			for (const chat of chats) if (chat.projectId === project.id) shown.add(chat.id);
		}
		return chats.filter((chat) => !shown.has(chat.id)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 40);
	}, [chats, collapsed, projectsExpanded, visibleProjects]);
	return (
		<aside className="sidebar" aria-label="项目与聊天导航">
			{deleting && <ConfirmDialog title={deleting.kind === "purge" ? "永久删除聊天" : "删除聊天"} description={deleting.kind === "purge" ? `永久删除 ${deleting.name}？${deleting.hasFile ? "将直接删除 pi 会话目录中的对话文件，无法恢复。" : "该聊天还没有 pi 会话文件，只会移除侧栏索引。"}` : `从侧栏删除 ${deleting.name}，pi 会话文件会保留。`} onConfirm={() => { if (deleting.kind === "purge") void onPurgeChat?.(deleting.id); else onDeleteChat(deleting.id); }} onClose={() => setDeleting(undefined)} />}
			{removingProject && <ProjectRemoveDialog name={removingProject.name} chatCount={removingProject.chatCount} sessionCount={removingProject.sessionCount} onHide={() => onHideProject(removingProject.id)} onPurge={() => void onPurgeProject(removingProject.id)} onClose={() => setRemovingProject(undefined)} />}
			<button className="new-chat" onClick={onNewChat} disabled={!projects.length}><Icon name="edit" /><span>新聊天</span><span className="shortcut">Ctrl N</span></button>
			<button className={`home-nav ${homeActive ? "active" : ""}`} onClick={onHome} disabled={!projects.length} aria-current={homeActive ? "page" : undefined}><Icon name="home" /><span>主页</span></button>
			{searchOpen && <div className="sidebar-search"><Icon name="search" size={14} /><Input autoFocus aria-label="搜索项目与聊天" placeholder="搜索项目与聊天" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setSearch(""); setSearchOpen(false); } }} /><IconButton size="compact"  onClick={() => { setSearch(""); setSearchOpen(false); }} aria-label="关闭搜索" title="关闭搜索"><Icon name="close" size={13} /></IconButton></div>}
			<div className="sidebar-scroll" ref={scrollRef} onScroll={updateScrollFades} onTransitionEnd={updateScrollFades}>
				{!!search.trim() && <section className="sidebar-search-results" aria-label="聊天搜索结果"><h2>标题命中</h2>{projectHistory.recent.length ? projectHistory.recent.map((chat) => renderChatRow(chat, projectHistory.recent)) : <p>无标题命中</p>}<h2>正文命中</h2><p role="status">{searchProgress?.loading ? `正在搜索 ${searchProgress.scanned}/${searchProgress.total}` : searchProgress ? `已搜索 ${searchProgress.scanned}/${searchProgress.total} · ${searchProgress.matches.length} 条命中` : "等待搜索…"}{!!searchProgress?.failures.length && ` · ${searchProgress.failures.length} 个历史无法读取，结果不完整`}</p>{searchProgress?.matches.slice(0, resultLimit).map((match, index) => { const chat = chats.find((item) => item.id === match.location.chatId); return chat && <button className="body-search-match" key={`${match.location.chatId}:${index}`} disabled={navigationDisabled} onClick={() => onSearchMatch?.(match.location)}><strong>{conversationLabel(chat, chats)}</strong><span><SearchText text={match.snippet} query={search} /></span></button>; })}{searchProgress && searchProgress.matches.length > resultLimit && <button className="body-search-match" onClick={() => setResultLimit((value) => value + 200)}>显示更多正文命中（共 {searchProgress.matches.length} 条）</button>}{searchProgress && !searchProgress.loading && !searchProgress.matches.length && <p>无正文命中</p>}</section>}
				{!search.trim() && <><div className="section-label"><button type="button" className="section-name" onClick={() => setProjectsExpanded((expanded) => !expanded)} aria-expanded={projectsExpanded} aria-controls={projectsListId} title={projectsExpanded ? "收起项目" : "展开项目"}>项目<span className={`section-toggle ${projectsExpanded ? "expanded" : ""}`}><Icon name="chevron" size={13} /></span></button><IconButton size="compact"  onClick={() => setSearchOpen((open) => !open)} aria-label="搜索项目与聊天" aria-expanded={searchOpen} title="搜索项目与聊天"><Icon name="search" size={16} /></IconButton><IconButton size="compact"  onClick={onAddProject} disabled={disabled} aria-label="添加项目" title="添加项目"><Icon name="plus" size={16} /></IconButton></div>
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
									rows.push(<div className="chat-group-label" key="pinned">已固定 · {pinnedChats.length}</div>);
									rows.push(...pinnedChats.map((chat) => renderChatRow(chat, history)));
								}
								const groups = new Map<string, Conversation[]>();
								for (const chat of history.filter((item) => !item.pinned)) {
									const label = calendarGroup(chat.updatedAt);
									const bucket = groups.get(label);
									if (bucket) bucket.push(chat);
									else groups.set(label, [chat]);
								}
								for (const [label, items] of groups) {
									rows.push(<div className="chat-group-label" key={label}>{label} · {items.length}</div>);
									rows.push(...items.map((chat) => renderChatRow(chat, history)));
								}
								return rows;
							};
							return <div className="project-group" key={project.id}>
								<div className={`project-row ${project.id === activeProjectId ? "current" : ""}`} onContextMenu={(event) => openProjectMenu(event, project)}>
									<IconButton size="compact" className={`project-chevron ${!isCollapsed || search ? "expanded" : ""}`} onClick={() => setCollapsed((previous) => { const next = new Set(previous); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; })} aria-label={`${!isCollapsed || search ? "收起" : "展开"}${project.name}`} aria-expanded={!isCollapsed || !!search} aria-controls={`${projectsListId}-${project.id}`}><Icon name="chevron" size={13} /></IconButton>
									{editing?.id === project.id ? renameInput() : <button className="project-select" disabled={navigationDisabled} onClick={() => onSelectProject(project.id)} title={project.path}><Icon name="folder" size={15} /><span>{project.name}</span></button>}
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
				{!!recentChats.length && <section className="sidebar-recent" aria-label="最近会话">
					<div className="section-label">最近</div>
					{recentChats.map((chat) => renderChatRow(chat, [], chat.projectId))}
				</section>}
				</>}
			</div>
			<div className="sidebar-footer"><span className={`dot ${connected ? "on" : "off"}`} />{activeId ? `pi ${connected ? "已连接" : "未连接"}` : "无活动会话"}</div>
			{menu?.kind === "chat" && menuChat && <div className="sidebar-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} role="menu">
				<button disabled={navigationDisabled} onClick={() => { onSelectChat(menu.chatId); closeMenu(); }}><Icon name="message" size={14} />打开</button>
				<button disabled={disabled} onClick={() => { startEdit({ id: menu.chatId, kind: "chat", text: menuChat.title, scope: menu.scope }); closeMenu(); }}><Icon name="edit" size={14} />重命名</button>
				<button disabled={disabled} onClick={() => { onTogglePinChat(menu.chatId, !menuChat.pinned); closeMenu(); }}><Icon name="pin" size={14} />{menuChat.pinned ? "取消固定" : "固定到顶部"}</button>
				<button disabled={disabled || canCloseChat?.(menu.chatId) === false} onClick={() => { onArchiveChat(menu.chatId); closeMenu(); }}><Icon name="archive" size={14} />归档</button>
				<div className="sidebar-menu-divider" role="separator" />
				<button disabled={disabled} onClick={() => { setDeleting({ id: menu.chatId, kind: "chat", name: menuChat.title }); closeMenu(); }}><Icon name="close" size={14} />从侧栏移除</button>
				<button className="danger" disabled={disabled || canCloseChat?.(menu.chatId) === false} onClick={() => { setDeleting({ id: menu.chatId, kind: "purge", name: menuChat.title, hasFile: !!menuChat.sessionFile && menuChat.hasMessages }); closeMenu(); }}><Icon name="trash" size={14} />永久删除</button>
			</div>}
			{menu?.kind === "project" && menuProject && <div className="sidebar-menu" ref={menuRef} style={{ left: menu.x, top: menu.y }} role="menu" aria-label={`项目 ${menuProject.name}`}>
				<button disabled={disabled} onClick={() => { startEdit({ id: menuProject.id, kind: "project", text: menuProject.name }); closeMenu(); }}><Icon name="edit" size={14} />重命名项目</button>
				<button disabled={disabled || projects.length <= 1 || chats.some((chat) => chat.projectId === menuProject.id && canCloseChat?.(chat.id) === false)} title={projects.length <= 1 ? "至少保留一个项目" : undefined} onClick={() => { removeProject(menuProject); closeMenu(); }}><Icon name="trash" size={14} />移除项目</button>
			</div>}
		</aside>
	);
}
