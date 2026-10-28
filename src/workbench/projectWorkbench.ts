import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../chat/workspace";

export type WorkbenchTool = "chats" | "files" | "git";

export interface DirectoryEntry {
	name: string;
	path: string;
	kind: "directory" | "file" | "link";
	size?: number;
}

export interface DirectoryPage {
	path: string;
	entries: DirectoryEntry[];
	truncated: boolean;
}

export interface FilePreview {
	path: string;
	kind: "text" | "binary" | "tooLarge";
	content?: string;
	size: number;
	modifiedMs?: number;
	version: string;
}

export interface GitEntry {
	path: string;
	oldPath?: string;
	kind: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
	indexStatus: string;
	worktreeStatus: string;
	selectable: boolean;
	rollbackable: boolean;
}

export interface GitStatus {
	repositoryRoot: string;
	scope: string;
	branch: string;
	head?: string;
	operation?: string;
	version: string;
	entries: GitEntry[];
}

export interface DiffPreview {
	path: string;
	kind: "text" | "binary";
	content?: string;
	truncated: boolean;
	version: string;
}

export interface GitWriteResult {
	repositoryRoot: string;
	commit?: string;
	changedPaths: string[];
	version: string;
}

export type PreviewMode = "file" | "diff";
export interface PreviewTab {
	id: string;
	projectId: string;
	projectName: string;
	root: string;
	path: string;
	name: string;
	mode: PreviewMode;
}

export const previewId = (projectId: string, path: string) => `${projectId}\0${path.replaceAll("\\", "/")}`;

export function openPreviewTab(tabs: PreviewTab[], incoming: Omit<PreviewTab, "id">, limit = 3): { tabs: PreviewTab[]; activeId: string } {
	const id = previewId(incoming.projectId, incoming.path);
	const existing = tabs.findIndex((tab) => tab.id === id);
	if (existing >= 0) return { tabs: tabs.map((tab, index) => index === existing ? { ...tab, mode: incoming.mode } : tab), activeId: id };
	const next = [...tabs, { ...incoming, id }];
	return { tabs: next.slice(Math.max(0, next.length - limit)), activeId: id };
}

export function resolveBrowseProject(projects: Project[], activeProjectId: string | undefined, manualProjectId: string | undefined): { project?: Project; manualProjectId?: string } {
	if (manualProjectId) {
		const manual = projects.find((project) => project.id === manualProjectId);
		if (manual) return { project: manual, manualProjectId };
	}
	return { project: projects.find((project) => project.id === activeProjectId) };
}

export const listDirectory = (root: string, path = "") => invoke<DirectoryPage>("list_project_directory", { root, path });
export const readFile = (root: string, path: string) => invoke<FilePreview>("read_project_file", { root, path });
export const gitStatus = (root: string) => invoke<GitStatus>("get_project_git_status", { root });
export const gitDiff = (root: string, path: string) => invoke<DiffPreview>("get_project_git_diff", { root, path });
export const commitFiles = (root: string, paths: string[], message: string, expectedVersion: string) => invoke<GitWriteResult>("commit_project_files", { root, paths, message, expectedVersion });
export const rollbackFiles = (root: string, paths: string[], expectedVersion: string) => invoke<GitWriteResult>("rollback_project_files", { root, paths, expectedVersion });
