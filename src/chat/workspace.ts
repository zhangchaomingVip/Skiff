import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RouteSnapshot } from "./types";
import type { RouteEvent } from "./routeAudit";
import { normalizeRouteEvents } from "./routeAudit";

export interface Project {
	id: string;
	name: string;
	path: string;
}

export interface Conversation {
	id: string;
	projectId: string;
	title: string;
	customTitle?: boolean;
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
	id: crypto.randomUUID(), projectId, title: "新聊天", updatedAt: Date.now(), hasMessages: false,
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
		for (const chat of workspace.chats) {
			const selected = normalizeSelectedModel(chat.selectedModel);
			if (selected) chat.selectedModel = selected; else delete chat.selectedModel;
			const snapshots = normalizeRouteSnapshots(chat.routeSnapshots);
			if (snapshots) chat.routeSnapshots = snapshots; else delete chat.routeSnapshots;
			const events = normalizeRouteEvents(chat.routeEvents);
			if (events) chat.routeEvents = events; else delete chat.routeEvents;
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

export function persistableConversations(chats: Conversation[], activeId: string): Conversation[] {
	return chats.filter((chat) => chat.hasMessages || chat.id === activeId || isArchived(chat));
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

	const activeChat = workspace?.chats.find((c) => c.id === workspace.activeId);
	const activeProject = workspace?.projects.find((p) => p.id === activeChat?.projectId);
	const createChat = (projectId = activeProject?.id, selectedModel?: Conversation["selectedModel"], unavailableDraftIds?: ReadonlySet<string>) => {
		if (!projectId) return;
		setWorkspace((w) => {
			if (!w) return w;
			const draft = w.chats.find((c) => c.id === w.activeId && c.projectId === projectId && !c.hasMessages && !isArchived(c) && !unavailableDraftIds?.has(c.id));
			const chat = draft ? { ...draft, ...(selectedModel ? { selectedModel } : {}) } : { ...newChat(projectId), ...(selectedModel ? { selectedModel } : {}) };
			return { ...w, chats: draft ? w.chats.map((item) => item.id === draft.id ? chat : item) : [...w.chats, chat], activeId: chat.id };
		});
	};
	const selectProject = (id: string) => {
		const latest = workspace?.chats.filter((c) => c.projectId === id && !isArchived(c)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
		if (latest) setWorkspace((w) => w && w.activeId !== latest.id ? { ...w, activeId: latest.id } : w);
		else createChat(id);
	};
	const addProject = async (path: string) => {
		const directory = await invoke<{ name: string; path: string }>("validate_project_directory", { path: path.trim() });
		const pathKey = (value: string) => /^[a-z]:\\|^\\\\/i.test(value) ? value.toLowerCase() : value;
		const existing = workspace?.projects.find((p) => pathKey(p.path) === pathKey(directory.path));
		if (existing) { selectProject(existing.id); return; }
		const project = { ...directory, id: crypto.randomUUID() };
		const chat = newChat(project.id);
		setWorkspace((w) => w ? { ...w, projects: [...w.projects, project], chats: [...w.chats, chat], activeId: chat.id } : { version: 1, projects: [project], chats: [chat], activeId: chat.id });
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
		workspace, activeChat, activeProject, error, loading, initialize, addProject, createChat, selectProject, updateChat,
		selectChat: (id: string) => setWorkspace((w) => w && w.activeId !== id && w.chats.some((chat) => chat.id === id && !isArchived(chat)) ? { ...w, activeId: id } : w),
		archiveChat: (id: string, archivedAt = Date.now()) => setWorkspace((w) => w ? archiveConversation(w, id, archivedAt) : w),
		restoreChat: (id: string) => setWorkspace((w) => w ? restoreConversation(w, id) : w),
		clearError: () => setError(undefined),
		renameChat: (id: string, title: string) => { if (title.trim()) updateChat(id, { title: title.trim().slice(0, 100), customTitle: true }); },
		renameProject: (id: string, name: string) => setWorkspace((w) => w && name.trim() ? { ...w, projects: w.projects.map((p) => p.id === id ? { ...p, name: name.trim().slice(0, 100) } : p) } : w),
		deleteChat: (id: string) => setWorkspace((w) => w ? deleteConversation(w, id) : w),
		deleteProject: (id: string) => setWorkspace((w) => {
			if (!w || w.projects.length <= 1) return w;
			const projects = w.projects.filter((project) => project.id !== id);
			const chats = w.chats.filter((chat) => chat.projectId !== id);
			if (chats.some((chat) => chat.id === w.activeId)) return { ...w, projects, chats };
			const next = visibleConversations(chats).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? newChat(projects[0].id);
			return { ...w, projects, chats: chats.includes(next) ? chats : [...chats, next], activeId: next.id };
		}),
	};
}
