import { useEffect, useState } from "react";
import { drafts, hasDraft } from "./drafts";
import { invoke } from "@tauri-apps/api/core";
import type { RouteSnapshot } from "./types";
import type { RouteEvent } from "./routeAudit";
import { normalizeRouteEvents } from "./routeAudit";

export interface Project {
	id: string;
	name: string;
	path: string;
	/** Hidden projects keep their chats and drafts so re-adding the path restores them. */
	hiddenAt?: number;
}

export const MAX_PROJECTS = 5;

export const projectPathKey = (value: string) => /^[a-z]:[\\/]|^\\\\/i.test(value) ? value.replaceAll("/", "\\").toLowerCase().replace(/\\+$/, "") : value.replace(/\/+$/, "");

export interface Conversation {
	id: string;
	projectId: string;
	title: string;
	customTitle?: boolean;
	createdAt?: number;
	modelAlias?: string;
	hasDraft?: boolean;
	sessionFile?: string;
	updatedAt: number;
	hasMessages: boolean;
	elapsedMs?: number;
	/** provider/id keep pi compatibility; route/model identify the pinned offer. */
	selectedModel?: { provider: string; id: string; routeId?: string; modelId?: string; offerId?: string };
	/** Snapshots are ordered by completed assistant reply, independent of pi's transcript IDs. */
	routeSnapshots?: Array<RouteSnapshot | null>;
	routeEvents?: RouteEvent[];
	pinned?: boolean;
	archivedAt?: number;
}

export interface Workspace {
	version: 1;
	projects: Project[];
	chats: Conversation[];
	activeId: string;
}

const STORAGE_KEY = "skiff.workspace.v1";
const newChat = (projectId: string): Conversation => ({
	id: crypto.randomUUID(), projectId, title: "新聊天", createdAt: Date.now(), updatedAt: Date.now(), hasMessages: false,
});

export function normalizeSelectedModel(value: unknown): Conversation["selectedModel"] {
	if (!value || typeof value !== "object") return undefined;
	const model = value as Record<string, unknown>;
	if (typeof model.provider !== "string" || typeof model.id !== "string") return undefined;
	const selected: Conversation["selectedModel"] = { provider: model.provider, id: model.id };
	for (const key of ["routeId", "modelId", "offerId"] as const) if (typeof model[key] === "string") selected[key] = model[key];
	return selected;
}

function normalizeRouteSnapshot(value: unknown): RouteSnapshot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const snapshot = value as Record<string, unknown>;
	if (typeof snapshot.providerKey !== "string" || typeof snapshot.familyId !== "string" || typeof snapshot.familyName !== "string" || typeof snapshot.modelId !== "string" || typeof snapshot.relayId !== "string" || typeof snapshot.relayName !== "string" || (snapshot.billingAccountId !== undefined && typeof snapshot.billingAccountId !== "string") || (snapshot.currency !== "CNY" && snapshot.currency !== "USD") || typeof snapshot.inputCost !== "number" || !Number.isFinite(snapshot.inputCost) || typeof snapshot.outputCost !== "number" || !Number.isFinite(snapshot.outputCost)) return undefined;
	return {
		...(typeof snapshot.offerId === "string" ? { offerId: snapshot.offerId } : {}),
		...(typeof snapshot.routeId === "string" ? { routeId: snapshot.routeId } : {}),
		providerKey: snapshot.providerKey, familyId: snapshot.familyId, familyName: snapshot.familyName, modelId: snapshot.modelId,
		...(typeof snapshot.alias === "string" ? { alias: snapshot.alias } : {}),
		relayId: snapshot.relayId, relayName: snapshot.relayName,
		...(typeof snapshot.billingAccountId === "string" ? { billingAccountId: snapshot.billingAccountId } : {}),
		currency: snapshot.currency, inputCost: snapshot.inputCost, outputCost: snapshot.outputCost,
		...(typeof snapshot.cacheReadCost === "number" && Number.isFinite(snapshot.cacheReadCost) ? { cacheReadCost: snapshot.cacheReadCost } : {}),
		...(typeof snapshot.cacheWriteCost === "number" && Number.isFinite(snapshot.cacheWriteCost) ? { cacheWriteCost: snapshot.cacheWriteCost } : {}),
	};
}

export function normalizeRouteSnapshots(value: unknown): Conversation["routeSnapshots"] {
	if (!Array.isArray(value)) return undefined;
	return value.map((item) => item === null ? null : normalizeRouteSnapshot(item) ?? null);
}

export function normalizeWorkspace(value: unknown): Workspace | null {
	try {
		if (!value || typeof value !== "object") return null;
		const workspace = value as Workspace;
		if (workspace.version !== 1 || !Array.isArray(workspace.projects) || !Array.isArray(workspace.chats)) return null;
		if (!workspace.projects.length || !workspace.projects.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.path === "string")) return null;
		if (!workspace.chats.every((c) => c && typeof c.id === "string" && typeof c.title === "string" && typeof c.updatedAt === "number" && typeof c.hasMessages === "boolean" && (c.sessionFile === undefined || typeof c.sessionFile === "string") && workspace.projects.some((p) => p.id === c.projectId))) return null;
		if (!workspace.chats.some((c) => c.id === workspace.activeId)) return null;
		for (const project of workspace.projects) if (project.hiddenAt !== undefined && (typeof project.hiddenAt !== "number" || !Number.isFinite(project.hiddenAt))) delete project.hiddenAt;
		for (const chat of workspace.chats) {
			const selected = normalizeSelectedModel(chat.selectedModel);
			if (selected) chat.selectedModel = selected; else delete chat.selectedModel;
			const snapshots = normalizeRouteSnapshots(chat.routeSnapshots);
			if (snapshots) chat.routeSnapshots = snapshots; else delete chat.routeSnapshots;
			const events = normalizeRouteEvents(chat.routeEvents);
			if (events) chat.routeEvents = events; else delete chat.routeEvents;
			if (chat.createdAt !== undefined && (typeof chat.createdAt !== "number" || !Number.isFinite(chat.createdAt))) delete chat.createdAt;
			if (typeof chat.hasDraft !== "boolean") delete chat.hasDraft;
			if (typeof chat.modelAlias !== "string") delete chat.modelAlias;
			if (chat.pinned !== undefined && typeof chat.pinned !== "boolean") delete chat.pinned;
			if (chat.archivedAt !== undefined && (typeof chat.archivedAt !== "number" || !Number.isFinite(chat.archivedAt))) delete chat.archivedAt;
		}
		return workspace;
	} catch {
		return null;
	}
}

export function isArchived(chat: Conversation): boolean {
	return typeof chat.archivedAt === "number" && Number.isFinite(chat.archivedAt);
}

export function visibleConversations(chats: Conversation[]): Conversation[] {
	return chats.filter((chat) => !isArchived(chat));
}

export function isHiddenProject(project: Project): boolean {
	return typeof project.hiddenAt === "number" && Number.isFinite(project.hiddenAt);
}

export function visibleProjects(projects: Project[]): Project[] {
	return projects.filter((project) => !isHiddenProject(project));
}

export function persistableConversations(chats: Conversation[], activeId: string): Conversation[] {
	return chats.filter((chat) => chat.hasMessages || chat.hasDraft || chat.id === activeId || isArchived(chat));
}

export function archiveConversation(workspace: Workspace, id: string, archivedAt = Date.now(), makeDraft = newChat): Workspace {
	const target = workspace.chats.find((chat) => chat.id === id);
	if (!target || isArchived(target)) return workspace;
	const chats = workspace.chats.map((chat) => chat.id === id ? { ...chat, archivedAt } : chat);
	if (workspace.activeId !== id) return { ...workspace, chats };
	const next = chats.filter((chat) => chat.id !== id && chat.projectId === target.projectId && !isArchived(chat)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
	if (next) return { ...workspace, chats, activeId: next.id };
	const draft = makeDraft(target.projectId);
	return { ...workspace, chats: [...chats, draft], activeId: draft.id };
}

export function restoreConversation(workspace: Workspace, id: string): Workspace {
	const target = workspace.chats.find((chat) => chat.id === id);
	if (!target || !isArchived(target)) return workspace;
	return { ...workspace, chats: workspace.chats.map((chat) => {
		if (chat.id !== id) return chat;
		const restored = { ...chat };
		delete restored.archivedAt;
		return restored;
	}), activeId: id };
}

/**
 * Hides a project while keeping every chat, session file reference and draft.
 * Re-adding the same folder later restores the whole group.
 */
export function hideProject(workspace: Workspace, id: string, hiddenAt = Date.now(), makeDraft = newChat): Workspace {
	const target = workspace.projects.find((project) => project.id === id);
	if (!target || isHiddenProject(target) || visibleProjects(workspace.projects).length <= 1) return workspace;
	const projects = workspace.projects.map((project) => project.id === id ? { ...project, hiddenAt } : project);
	const active = workspace.chats.find((chat) => chat.id === workspace.activeId);
	if (active?.projectId !== id) return { ...workspace, projects };
	const next = workspace.chats.filter((chat) => chat.projectId !== id && !isArchived(chat)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
	if (next) return { ...workspace, projects, activeId: next.id };
	const draft = makeDraft(visibleProjects(projects)[0].id);
	return { ...workspace, projects, chats: [...workspace.chats, draft], activeId: draft.id };
}

/** Undoes `hideProject` and focuses the newest chat that survived the hiding. */
export function unhideProject(workspace: Workspace, id: string, makeDraft = newChat): Workspace {
	const target = workspace.projects.find((project) => project.id === id);
	if (!target || !isHiddenProject(target)) return workspace;
	const restored = { ...target };
	delete restored.hiddenAt;
	const projects = workspace.projects.map((project) => project.id === id ? restored : project);
	const latest = workspace.chats.filter((chat) => chat.projectId === id && !isArchived(chat)).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? makeDraft(id);
	return { ...workspace, projects, chats: workspace.chats.includes(latest) ? workspace.chats : [...workspace.chats, latest], activeId: latest.id };
}

/** Replace list entries atomically; transcripts, drafts and folders remain intact. */
export function addWorkspaceProject(workspace: Workspace, project: Project, removeIds: string[] = [], makeDraft = newChat): Workspace {
	const existing = workspace.projects.find((item) => projectPathKey(item.path) === projectPathKey(project.path));
	const target = existing ?? project;
	const removed = new Set(removeIds.filter((id) => id !== target.id));
	const projects = workspace.projects.map((item) => {
		if (item.id === target.id) { const restored = { ...item }; delete restored.hiddenAt; return restored; }
		return removed.has(item.id) ? { ...item, hiddenAt: Date.now() } : item;
	});
	if (!existing) projects.push(project);
	if (visibleProjects(projects).length > MAX_PROJECTS) throw new Error(`最多保留 ${MAX_PROJECTS} 个项目，请选择要移出列表的项目。`);
	const latest = workspace.chats.filter((chat) => chat.projectId === target.id && !isArchived(chat)).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? makeDraft(target.id);
	return { ...workspace, projects, chats: workspace.chats.includes(latest) ? workspace.chats : [...workspace.chats, latest], activeId: latest.id };
}

export function deleteConversation(workspace: Workspace, id: string, makeDraft = newChat): Workspace {
	const removed = workspace.chats.find((chat) => chat.id === id);
	if (!removed) return workspace;
	const chats = workspace.chats.filter((chat) => chat.id !== id);
	if (workspace.activeId !== id) return { ...workspace, chats };
	const next = chats.filter((chat) => chat.projectId === removed.projectId && !isArchived(chat)).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? makeDraft(removed.projectId);
	return { ...workspace, chats: chats.includes(next) ? chats : [...chats, next], activeId: next.id };
}

function readWorkspace(): Workspace | null {
	try {
		return normalizeWorkspace(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
	} catch {
		return null;
	}
}

export function useWorkspace() {
	const [workspace, setWorkspace] = useState<Workspace | null>(readWorkspace);
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(false);
	const [draftsReady, setDraftsReady] = useState(drafts.ready);

	const initialize = async () => {
		setLoading(true);
		try {
			const directory = await invoke<{ name: string; path: string }>("get_workspace_directory");
			const project = { ...directory, id: crypto.randomUUID() };
			const chat = newChat(project.id);
			setWorkspace({ version: 1, projects: [project], chats: [chat], activeId: chat.id });
			setError(undefined);
		} catch (e) {
			setError(`无法读取项目目录：${String(e)}`);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => { if (!workspace) void initialize(); }, []);
	useEffect(() => {
		if (!workspace) return;
		try {
			// Archived drafts are intentional records, even when they have no messages.
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...workspace, chats: persistableConversations(workspace.chats, workspace.activeId) }));
		} catch {
			setError("无法保存聊天索引。关闭应用后可能无法从侧栏找回本次聊天。");
		}
	}, [workspace]);

	const draftIds = workspace?.chats.filter((chat) => !isArchived(chat)).map((chat) => chat.id).join(";");
	useEffect(() => {
		if (!workspace) return;
		const ids = workspace.chats.filter((chat) => !isArchived(chat)).map((chat) => chat.id);
		drafts.setAllowed(ids);
		void drafts.hydrate(ids);
	}, [draftIds]);
	useEffect(() => {
		const sync = () => { setDraftsReady(drafts.ready); setWorkspace((current) => {
			if (!current) return current;
			let changed = false;
			const chats = current.chats.map((chat) => {
				const value = !isArchived(chat) && (hasDraft(drafts.get(chat.id)) || (drafts.loadFailed && !!chat.hasDraft));
				if (!!chat.hasDraft === value) return chat;
				changed = true; return { ...chat, hasDraft: value };
			});
			return changed ? { ...current, chats } : current;
		}); };
		const unsubscribe = drafts.subscribe(sync);
		const flush = () => { void drafts.flush(); };
		const exit = () => drafts.flushOnExit();
		window.addEventListener("beforeunload", exit);
		window.addEventListener("pagehide", exit);
		document.addEventListener("visibilitychange", flush);
		return () => { unsubscribe(); flush(); window.removeEventListener("beforeunload", exit); window.removeEventListener("pagehide", exit); document.removeEventListener("visibilitychange", flush); };
	}, []);

	const activeChat = workspace?.chats.find((c) => c.id === workspace.activeId);
	const activeProject = workspace?.projects.find((p) => p.id === activeChat?.projectId);
	const createChat = (projectId = activeProject?.id, selectedModel?: Conversation["selectedModel"], unavailableDraftIds?: ReadonlySet<string>) => {
		if (!projectId) return;
		void drafts.flush();
		setWorkspace((w) => {
			if (!w) return w;
			const draft = w.chats.find((c) => c.id === w.activeId && c.projectId === projectId && !c.hasMessages && !c.hasDraft && !hasDraft(drafts.get(c.id)) && !isArchived(c) && !unavailableDraftIds?.has(c.id));
			const chat = draft ? { ...draft, ...(selectedModel ? { selectedModel } : {}) } : { ...newChat(projectId), ...(selectedModel ? { selectedModel } : {}) };
			return { ...w, chats: draft ? w.chats.map((item) => item.id === draft.id ? chat : item) : [...w.chats, chat], activeId: chat.id };
		});
	};
	const selectProject = (id: string) => {
		void drafts.flush();
		const latest = workspace?.chats.filter((c) => c.projectId === id && !isArchived(c)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
		if (latest) setWorkspace((w) => w && w.activeId !== latest.id ? { ...w, activeId: latest.id } : w);
		else createChat(id);
	};
	const addProject = async (path: string, name?: string, removeIds: string[] = []) => {
		void drafts.flush();
		const directory = await invoke<{ name: string; path: string }>("validate_project_directory", { path: path.trim() });
		const existing = workspace?.projects.find((p) => projectPathKey(p.path) === projectPathKey(directory.path));
		if (existing) {
			// A hidden project keeps its chats, so re-adding the folder restores them.
			if (!isHiddenProject(existing)) { selectProject(existing.id); return; }
		}
		// The dialog's name field wins; an empty name keeps the folder's own name.
		const project = { name: name?.trim() ? name.trim().slice(0, 100) : directory.name, path: directory.path, id: crypto.randomUUID() };
		// Validate before scheduling the state update so the dialog can show errors.
		if (workspace) addWorkspaceProject(workspace, project, removeIds);
		const chat = newChat(project.id);
		setWorkspace((w) => w ? addWorkspaceProject(w, project, removeIds) : { version: 1, projects: [project], chats: [chat], activeId: chat.id });
	};
	const updateChat = (id: string, patch: Partial<Conversation>) => {
		setWorkspace((w) => {
			if (!w) return w;
			const current = w.chats.find((c) => c.id === id);
			if (!current || Object.entries(patch).every(([k, v]) => current[k as keyof Conversation] === v)) return w;
			return { ...w, chats: w.chats.map((c) => c.id === id ? { ...c, ...patch } : c) };
		});
	};

	return {
		workspace, activeChat, activeProject, error, loading, draftsReady, initialize, addProject, createChat, selectProject, updateChat,
		selectChat: (id: string) => { void drafts.flush(); setWorkspace((w) => w && w.activeId !== id && w.chats.some((chat) => chat.id === id && !isArchived(chat)) ? { ...w, activeId: id } : w); },
		archiveChat: (id: string, archivedAt = Date.now()) => { drafts.remove(id); setWorkspace((w) => w ? archiveConversation(w, id, archivedAt) : w); },
		restoreChat: (id: string) => setWorkspace((w) => w ? restoreConversation(w, id) : w),
		clearError: () => setError(undefined),
		renameChat: (id: string, title: string) => { if (title.trim()) updateChat(id, { title: title.trim().slice(0, 100), customTitle: true }); },
		renameProject: (id: string, name: string) => setWorkspace((w) => w && name.trim() ? { ...w, projects: w.projects.map((p) => p.id === id ? { ...p, name: name.trim().slice(0, 100) } : p) } : w),
		deleteChat: (id: string) => { drafts.remove(id); setWorkspace((w) => w ? deleteConversation(w, id) : w); },
		hideProject: (id: string) => setWorkspace((w) => w ? hideProject(w, id) : w),
		deleteProject: (id: string) => {
			if (!workspace || workspace.projects.length <= 1) return;
			for (const chat of workspace.chats.filter((chat) => chat.projectId === id)) drafts.remove(chat.id);
			setWorkspace((w) => {
			if (!w || w.projects.length <= 1) return w;
			const projects = w.projects.filter((project) => project.id !== id);
			const chats = w.chats.filter((chat) => chat.projectId !== id);
			if (chats.some((chat) => chat.id === w.activeId)) return { ...w, projects, chats };
			const next = visibleConversations(chats).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? newChat(projects[0].id);
			return { ...w, projects, chats: chats.includes(next) ? chats : [...chats, next], activeId: next.id };
		}); },
	};
}
