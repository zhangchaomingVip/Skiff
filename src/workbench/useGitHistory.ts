import { useEffect, useRef, useState } from "react";
import type { Project } from "../chat/workspace";
import { readGitHistory, updateProject, type GitHistory } from "./gitHistory";
import { projectGitCache, useProjectGitStatus } from "./useProjectGitStatus";

export function useGitHistory(project: Project | undefined, enabled: boolean, revision: number, onUpdated: (project: Project) => void) {
	const root = project?.path;
	const git = useProjectGitStatus(project);
	const [choices, setChoices] = useState<Record<string, { reference: string; selected?: string; limit: number }>>({});
	const choice = choices[root ?? ""] ?? { reference: "", limit: 100 };
	const [refresh, setRefresh] = useState(0);
	const pendingUpdate = useRef(false);
	const pendingProject = useRef<Project>();
	const [updating, setUpdating] = useState(false);
	const [notices, setNotices] = useState<Record<string, { tone: "success" | "warning" | "error"; text: string }>>({});
	const activeRoot = useRef(root);
	activeRoot.current = root;
	const updated = useRef(onUpdated);
	updated.current = onUpdated;
	const cache = useRef(new Map<string, GitHistory>());
	const [state, setState] = useState<{ key: string; queryKey: string; data?: GitHistory; loading: boolean; error?: string }>();
	const queryKey = JSON.stringify([root, choice.reference, choice.limit]);
	const key = JSON.stringify([root, choice.reference, choice.limit, refresh, revision, git.status?.head]);
	const current = state?.key === key ? state : undefined;
	useEffect(() => {
		if (!enabled || !root || git.local) return;
		const cached = cache.current.get(key);
		if (cached) { setState({ key, queryKey, data: cached, loading: false }); return; }
		let cancelled = false;
		setState((previous) => ({ key, queryKey, data: previous?.queryKey === queryKey ? previous.data : undefined, loading: true }));
		void readGitHistory(root, choice.reference, choice.limit).then((data) => {
			if (cancelled) return;
			cache.current.set(key, data);
			if (cache.current.size > 20) cache.current.delete(cache.current.keys().next().value!);
			setState({ key, queryKey, data, loading: false });
		}).catch((error) => { if (!cancelled) setState((previous) => ({ key, queryKey, data: previous?.queryKey === queryKey ? previous.data : undefined, error: String(error), loading: false })); });
		return () => { cancelled = true; };
	}, [key, enabled, git.local]);
	const change = (value: Partial<typeof choice>) => { if (root) setChoices((current) => ({ ...current, [root]: { ...choice, ...value } })); };
	const data = current?.data ?? cache.current.get(key) ?? (state?.queryKey === queryKey ? state.data : undefined);
	const selected = data?.commits.find((commit) => commit.hash === choice.selected) ?? data?.commits[0];
	const update = async () => {
		if (!project || pendingUpdate.current) return;
		const target = project;
		pendingUpdate.current = true; pendingProject.current = target; setUpdating(true);
		setNotices((current) => { const next = { ...current }; delete next[target.path]; return next; });
		projectGitCache.pause(target.path, true);
		try {
			const result = await updateProject(target.path);
			const messages = {
				updated: `已从 ${result.upstream} 快进更新到 ${result.head.slice(0, 8)}`,
				upToDate: "已是最新，无需更新",
				ahead: "本地提交领先远程，无需拉取；本地提交已保留",
				diverged: "本地与远程已分叉，无法直接更新。远程记录已刷新，请在 IDE 或命令行处理合并；Skiff 未合并或改写本地提交",
			};
			setNotices((current) => ({ ...current, [target.path]: { tone: result.status === "diverged" ? "warning" : "success", text: `${target.name} · ${result.branch}：${messages[result.status]}` } }));
			if (result.status === "updated") updated.current(target);
		} catch (error) {
			setNotices((current) => ({ ...current, [target.path]: { tone: "error", text: `${target.name}：${String(error)}` } }));
		} finally {
			projectGitCache.pause(target.path, false);
			for (const cachedKey of cache.current.keys()) if (JSON.parse(cachedKey)[0] === target.path) cache.current.delete(cachedKey);
			if (activeRoot.current === target.path) setRefresh((value) => value + 1);
			await projectGitCache.refreshAll();
			pendingUpdate.current = false; setUpdating(false);
		}
	};
	return {
		data, selected, reference: choice.reference, limit: choice.limit,
		update, updating: updating && pendingProject.current?.path === root, canUpdate: !!root && !git.local && !updating, notice: root ? notices[root] : undefined,
		updateTitle: updating ? `${pendingProject.current?.name} 正在更新，请稍候` : `更新 ${project?.name ?? "项目"} 的当前分支 ${data?.branch || git.status?.branch || ""}（仅快进，不切换分支）`,
		loading: !!root && !git.local && !cache.current.has(key) && (!current || current.loading), error: current?.error, local: git.local,
		select: (hash: string) => change({ selected: hash }),
		selectRef: (reference: string) => change({ reference, selected: undefined, limit: 100 }),
		more: () => change({ limit: Math.min(1000, choice.limit + 100) }),
		refresh: () => { if (root) void projectGitCache.refresh(root); setRefresh((value) => value + 1); },
	};
}

export type GitHistoryState = ReturnType<typeof useGitHistory>;
