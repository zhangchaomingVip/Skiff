import { useEffect, useRef, useSyncExternalStore } from "react";
import { MAX_PROJECTS, type Conversation, type Project } from "../chat/workspace";
import type { ChatMessage } from "../chat/types";
import { gitStatus } from "./projectWorkbench";
import { GIT_REFRESH_MS, GitStatusCache } from "./gitStatusCache";
import { ProjectGitActivity } from "./projectGitActivity";
import { projectDiffCache } from "./projectDiffCache";
import { invalidateProjectFiles } from "./projectFiles";

export const projectGitCache = new GitStatusCache(gitStatus, (root, snapshot) => {
	if (!snapshot.loading) {
		projectDiffCache.setVersion(root, snapshot.status?.version);
		if (snapshot.status) projectDiffCache.prefetch(root, snapshot.status.entries.map((entry) => entry.path), snapshot.status.version);
	}
});

export function useProjectGitPolling(projects: Project[]) {
	useEffect(() => {
		const roots = projects.slice(0, MAX_PROJECTS).map((project) => project.path);
		projectDiffCache.retainRoots(roots);
		projectGitCache.setProjects(roots);
		void projectGitCache.refreshAll();
		const refresh = () => { void projectGitCache.refreshAll(); };
		const timer = window.setInterval(refresh, GIT_REFRESH_MS);
		window.addEventListener("focus", refresh);
		return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
	}, [projects]);
}

export function useProjectGitStatus(project?: Pick<Project, "path">) {
	return useSyncExternalStore(projectGitCache.subscribe, () => projectGitCache.get(project?.path));
}

export function useProjectGitActivity(messages: Map<string, ChatMessage[]>, runningIds: Set<string>, chats: Conversation[], projects: Project[]) {
	const activity = useRef(new ProjectGitActivity());
	const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	useEffect(() => {
		const roots = new Map(chats.flatMap((chat) => {
			const project = projects.find((item) => item.id === chat.projectId);
			return project ? [[chat.id, project.path] as const] : [];
		}));
		for (const root of activity.current.update(messages, runningIds, roots)) {
			clearTimeout(timers.current.get(root));
			timers.current.set(root, setTimeout(() => {
				timers.current.delete(root);
				for (const project of projects) if (project.path === root) invalidateProjectFiles(project.id);
				void projectGitCache.refreshChanged(root);
			}, 750));
		}
	}, [messages, runningIds, chats, projects]);
	useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);
}
