import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
	selectedModel?: { provider: string; id: string };
	pinned?: boolean;
}

interface Workspace {
	version: 1;
	projects: Project[];
	chats: Conversation[];
	activeId: string;
}

const STORAGE_KEY = "skiff.workspace.v1";
const newChat = (projectId: string): Conversation => ({
	id: crypto.randomUUID(), projectId, title: "新聊天", updatedAt: Date.now(), hasMessages: false,
});

function readWorkspace(): Workspace | null {
	try {
		const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Workspace | null;
		if (!value || value.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.chats)) return null;
		if (!value.projects.length || !value.projects.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.path === "string")) return null;
		if (!value.chats.every((c) => c && typeof c.id === "string" && typeof c.title === "string" && typeof c.updatedAt === "number" && typeof c.hasMessages === "boolean" && (c.sessionFile === undefined || typeof c.sessionFile === "string") && value.projects.some((p) => p.id === c.projectId))) return null;
		if (!value.chats.some((c) => c.id === value.activeId)) return null;
		for (const chat of value.chats) {
			if (chat.selectedModel && (typeof chat.selectedModel.provider !== "string" || typeof chat.selectedModel.id !== "string")) delete chat.selectedModel;
			if (chat.pinned !== undefined && typeof chat.pinned !== "boolean") delete chat.pinned;
		}
		return value;
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
			// Empty drafts are transient; keep only the active one alongside history.
			localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...workspace, chats: workspace.chats.filter((c) => c.hasMessages || c.id === workspace.activeId) }));
		} catch {
			setError("无法保存聊天索引。关闭应用后可能无法从侧栏找回本次聊天。");
		}
	}, [workspace]);

	const activeChat = workspace?.chats.find((c) => c.id === workspace.activeId);
	const activeProject = workspace?.projects.find((p) => p.id === activeChat?.projectId);
	const createChat = (projectId = activeProject?.id) => {
		if (!projectId) return;
		setWorkspace((w) => {
			if (!w) return w;
			const draft = w.chats.find((c) => c.projectId === projectId && !c.hasMessages);
			const chat = draft ?? newChat(projectId);
			return { ...w, chats: draft ? w.chats : [...w.chats, chat], activeId: chat.id };
		});
	};
	const selectProject = (id: string) => {
		const latest = workspace?.chats.filter((c) => c.projectId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
		if (latest) setWorkspace((w) => w ? { ...w, activeId: latest.id } : w);
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
		selectChat: (id: string) => setWorkspace((w) => w ? { ...w, activeId: id } : w),
		clearError: () => setError(undefined),
		renameChat: (id: string, title: string) => { if (title.trim()) updateChat(id, { title: title.trim().slice(0, 100), customTitle: true }); },
		renameProject: (id: string, name: string) => setWorkspace((w) => w && name.trim() ? { ...w, projects: w.projects.map((p) => p.id === id ? { ...p, name: name.trim().slice(0, 100) } : p) } : w),
		deleteChat: (id: string) => setWorkspace((w) => {
			if (!w) return w;
			const removed = w.chats.find((chat) => chat.id === id);
			if (!removed) return w;
			const chats = w.chats.filter((chat) => chat.id !== id);
			if (w.activeId !== id) return { ...w, chats };
			const next = chats.filter((chat) => chat.projectId === removed.projectId).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? newChat(removed.projectId);
			return { ...w, chats: chats.includes(next) ? chats : [...chats, next], activeId: next.id };
		}),
		deleteProject: (id: string) => setWorkspace((w) => {
			if (!w || w.projects.length <= 1) return w;
			const projects = w.projects.filter((project) => project.id !== id);
			const chats = w.chats.filter((chat) => chat.projectId !== id);
			if (chats.some((chat) => chat.id === w.activeId)) return { ...w, projects, chats };
			const next = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? newChat(projects[0].id);
			return { ...w, projects, chats: chats.includes(next) ? chats : [...chats, next], activeId: next.id };
		}),
	};
}
