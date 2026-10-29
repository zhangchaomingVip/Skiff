import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { Project } from "../chat/workspace";
import { commitFiles, listDirectory, rollbackFiles, selectedChangeCounts, type DirectoryEntry, type DirectoryPage, type GitEntry, type PreviewMode, type WorkbenchTool } from "../workbench/projectWorkbench";
import { projectGitCache, useProjectGitStatus } from "../workbench/useProjectGitStatus";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton, TextArea } from "./ui";
import { WorkbenchProjectPicker } from "./WorkbenchProjectPicker";
import { GitChanges } from "./GitChanges";
import { projectDiffCache } from "../workbench/projectDiffCache";

const fileGitLabels: Record<GitEntry["kind"], string> = { modified: "已修改", added: "已新增", untracked: "未跟踪", deleted: "已删除", renamed: "已重命名", conflict: "存在冲突" };

function TreeRow({ project, entry, gitKind, depth, expanded, page, loading, error, onToggle, onOpen }: { project: Project; entry: DirectoryEntry; gitKind?: GitEntry["kind"]; depth: number; expanded: boolean; page?: DirectoryPage; loading: boolean; error?: string; onToggle: (path: string) => void; onOpen: (project: Project, path: string, mode: PreviewMode) => void }) {
	const directory = entry.kind === "directory";
	return <>
		<button className="file-tree-row" data-git-kind={gitKind} aria-description={gitKind ? fileGitLabels[gitKind] : undefined} style={{ paddingLeft: `${10 + depth * 16}px` }} title={entry.path} onClick={() => directory ? onToggle(entry.path) : entry.kind === "file" && onOpen(project, entry.path, "file")}>
			<span className={`file-tree-chevron ${expanded ? "expanded" : ""}`}>{directory && <Icon name="chevron" />}</span>
			<Icon name={directory ? "folder" : entry.kind === "link" ? "share" : "file"} />
			<span>{entry.name}</span>
		</button>
		{directory && expanded && <div role="group">
			{loading && <p className="workbench-inline-state" style={{ paddingLeft: `${30 + depth * 16}px` }}>加载中…</p>}
			{error && <button className="workbench-inline-error" style={{ marginLeft: `${30 + depth * 16}px` }} onClick={() => onToggle(entry.path)}>读取失败，重试</button>}
			{page?.entries.map((child) => <TreeNode key={child.path} project={project} entry={child} depth={depth + 1} onToggle={onToggle} onOpen={onOpen} />)}
			{page && !page.entries.length && <p className="workbench-inline-state" style={{ paddingLeft: `${30 + depth * 16}px` }}>空文件夹</p>}
			{page?.truncated && <p className="workbench-inline-state warning" style={{ paddingLeft: `${30 + depth * 16}px` }}>仅显示前 500 项</p>}
		</div>}
	</>;
}

type TreeContextValue = { expanded: Set<string>; pages: Map<string, DirectoryPage>; loading: Set<string>; errors: Map<string, string>; gitKinds: Map<string, GitEntry["kind"]> };
const TreeContext = createContext<TreeContextValue>({ expanded: new Set(), pages: new Map(), loading: new Set(), errors: new Map(), gitKinds: new Map() });

function TreeNode({ project, entry, depth, onToggle, onOpen }: { project: Project; entry: DirectoryEntry; depth: number; onToggle: (path: string) => void; onOpen: (project: Project, path: string, mode: PreviewMode) => void }) {
	const tree = useContext(TreeContext);
	return <TreeRow project={project} entry={entry} gitKind={entry.kind === "directory" ? undefined : tree.gitKinds.get(entry.path.replaceAll("\\", "/"))} depth={depth} expanded={tree.expanded.has(entry.path)} page={tree.pages.get(entry.path)} loading={tree.loading.has(entry.path)} error={tree.errors.get(entry.path)} onToggle={onToggle} onOpen={onOpen} />;
}

function FilePanel({ project, onOpen }: { project?: Project; onOpen: (project: Project, path: string, mode: PreviewMode) => void }) {
	const { status } = useProjectGitStatus(project);
	const gitKinds = useMemo(() => new Map((status?.entries ?? []).map((entry) => [entry.path.replaceAll("\\", "/"), entry.kind])), [status?.entries]);
	const [pages, setPages] = useState(() => new Map(retainedFilePages));
	const [expandedByProject, setExpandedByProject] = useState<Record<string, string[]>>(() => ({ ...retainedExpandedProjects }));
	const [loading, setLoading] = useState(() => new Set<string>());
	const [errors, setErrors] = useState(() => new Map<string, string>());
	const requests = useRef(new Map<string, number>());
	const prefix = `${project?.id ?? "none"}:`;
	const key = useCallback((path: string) => `${prefix}${path}`, [prefix]);
	const expanded = useMemo(() => new Set(expandedByProject[project?.id ?? ""] ?? []), [expandedByProject, project?.id]);
	const projectPages = useMemo(() => new Map(Array.from(pages).filter(([item]) => item.startsWith(prefix)).map(([item, page]) => [item.slice(prefix.length), page])), [pages, prefix]);
	const projectLoading = useMemo(() => new Set(Array.from(loading).filter((item) => item.startsWith(prefix)).map((item) => item.slice(prefix.length))), [loading, prefix]);
	const projectErrors = useMemo(() => new Map(Array.from(errors).filter(([item]) => item.startsWith(prefix)).map(([item, error]) => [item.slice(prefix.length), error])), [errors, prefix]);

	const load = useCallback(async (path: string, force = false) => {
		if (!project || (!force && pages.has(key(path)))) return;
		const requestKey = key(path);
		const ticket = (requests.current.get(requestKey) ?? 0) + 1;
		requests.current.set(requestKey, ticket);
		setLoading((current) => new Set(current).add(requestKey));
		setErrors((current) => { const next = new Map(current); next.delete(requestKey); return next; });
		try {
			const page = await listDirectory(project.path, path);
			if (requests.current.get(requestKey) !== ticket) return;
			setPages((current) => { const next = new Map(current).set(requestKey, page); retainedFilePages.clear(); for (const item of next) retainedFilePages.set(...item); return next; });
		} catch (error) {
			if (requests.current.get(requestKey) === ticket) setErrors((current) => new Map(current).set(requestKey, String(error)));
		} finally {
			if (requests.current.get(requestKey) === ticket) setLoading((current) => { const next = new Set(current); next.delete(requestKey); return next; });
		}
	}, [key, pages, project]);

	useEffect(() => { if (project) void load(""); }, [project?.id]);
	useEffect(() => {
		const invalidate = (event: Event) => {
			if ((event as CustomEvent<string>).detail !== project?.id) return;
			for (const [key, ticket] of requests.current) if (key.startsWith(prefix)) requests.current.set(key, ticket + 1);
			setPages((current) => new Map(Array.from(current).filter(([item]) => !item.startsWith(prefix))));
			for (const path of ["", ...expanded]) void load(path, true);
		};
		window.addEventListener("skiff:project-files-updated", invalidate);
		return () => window.removeEventListener("skiff:project-files-updated", invalidate);
	}, [project?.id, prefix, expanded, load]);
	const toggle = (path: string) => {
		if (!project) return;
		const wasOpen = expanded.has(path);
		setExpandedByProject((current) => { const next = { ...current, [project.id]: wasOpen ? (current[project.id] ?? []).filter((item) => item !== path) : [...(current[project.id] ?? []), path] }; Object.assign(retainedExpandedProjects, next); return next; });
		if (!wasOpen) void load(path, projectErrors.has(path));
	};
	const refresh = () => {
		if (!project) return;
		setPages((current) => { const next = new Map(Array.from(current).filter(([item]) => !item.startsWith(prefix))); retainedFilePages.clear(); for (const item of next) retainedFilePages.set(...item); return next; });
		for (const path of ["", ...expanded]) void load(path, true);
		void projectGitCache.refreshChanged(project.path);
	};
	const tree = useMemo(() => ({ expanded, pages: projectPages, loading: projectLoading, errors: projectErrors, gitKinds }), [expanded, projectPages, projectLoading, projectErrors, gitKinds]);
	const root = projectPages.get("");
	return <section className="workbench-section file-panel" aria-label="项目文件">
		<div className="workbench-tab-actions"><IconButton size="compact" aria-label="全部折叠" onClick={() => project && setExpandedByProject((current) => { const next = { ...current, [project.id]: [] }; Object.assign(retainedExpandedProjects, next); return next; })}><Icon name="minus" /></IconButton><IconButton size="compact" aria-label="刷新文件树" onClick={refresh}><Icon name="refresh" /></IconButton></div>
		{!project ? <div className="workbench-empty">选择一个项目以浏览文件</div> : <div className="file-tree" role="tree" aria-label={`${project.name} 文件树`} ref={(node) => { if (node && node.dataset.project !== project.id) { node.dataset.project = project.id; node.scrollTop = retainedFileScroll.get(project.id) ?? 0; } }} onScroll={(event) => retainedFileScroll.set(project.id, event.currentTarget.scrollTop)}>
			{projectLoading.has("") && !root && <div className="workbench-empty">正在读取文件…</div>}
			{projectErrors.has("") && <div className="workbench-empty error"><p>{projectErrors.get("")}</p><Button size="compact" onClick={() => void load("", true)}>重试</Button></div>}
			<TreeContext.Provider value={tree}>{root?.entries.map((entry) => <TreeNode key={entry.path} project={project} entry={entry} depth={0} onToggle={toggle} onOpen={onOpen} />)}</TreeContext.Provider>
			{root && !root.entries.length && <div className="workbench-empty">项目目录为空</div>}
			{root?.truncated && <p className="workbench-limit">目录内容过多，仅显示前 500 项</p>}
		</div>}
	</section>;
}

// The drawer and desktop panel intentionally unmount while closed. These
// run-lifetime caches keep browsing context without writing it into workspace v1.
const retainedFilePages = new Map<string, DirectoryPage>();
const retainedExpandedProjects: Record<string, string[]> = {};
const retainedFileScroll = new Map<string, number>();
const retainedGitDrafts: Record<string, string> = {};
const retainedGitSelections = new Map<string, { version: string; paths: string[] }>();

export function invalidateProjectFiles(projectId: string) {
	for (const key of retainedFilePages.keys()) if (key.startsWith(`${projectId}:`)) retainedFilePages.delete(key);
	window.dispatchEvent(new CustomEvent("skiff:project-files-updated", { detail: projectId }));
}

function GitPanel({ project, onOpen, onMutated }: { project?: Project; onOpen: (project: Project, path: string, mode: PreviewMode) => void; onMutated: () => void }) {
	const { status, loading, local, error: readError } = useProjectGitStatus(project);
	const [writeError, setWriteError] = useState<string>();
	const error = writeError ?? readError;
	const [selected, setSelected] = useState<string[]>([]);
	const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...retainedGitDrafts }));
	const [writing, setWriting] = useState(false);
	const [notice, setNotice] = useState<string>();
	const [confirmRollback, setConfirmRollback] = useState(false);
	const draftKey = `${project?.id ?? ""}:${status?.repositoryRoot ?? ""}`;
	const message = drafts[draftKey] ?? "";
	const refresh = () => project ? projectGitCache.refresh(project.path) : Promise.resolve();
	useEffect(() => {
		const retained = retainedGitSelections.get(draftKey);
		setSelected(status && retained?.version === status.version ? retained.paths : []);
		if (retained?.version !== status?.version) retainedGitSelections.delete(draftKey);
	}, [draftKey, status?.version]);
	useEffect(() => { setWriteError(undefined); setNotice(undefined); setConfirmRollback(false); }, [project?.id]);
	const select = (paths: string[]) => {
		setSelected(paths);
		if (status) retainedGitSelections.set(draftKey, { version: status.version, paths });
	};
	const counts = selectedChangeCounts(status?.entries ?? [], selected);
	const commit = async (push = false) => {
		if (!project || !status || !selected.length || !message.trim() || writing || loading || status.operation) return;
		setWriting(true); setNotice(undefined); setWriteError(undefined); projectGitCache.pause(project.path, true);
		try {
			const result = await commitFiles(project.path, selected, message, status.version, push);
			projectDiffCache.invalidateRoot(project.path);
			if (result.pushError) setWriteError(`本地提交 ${result.commit} 已创建并保留；${result.pushError}`);
			else setNotice(result.pushed ? `已提交并推送 ${result.commit}` : `已创建本地提交 ${result.commit}`);
			setDrafts((current) => { const next = { ...current, [draftKey]: "" }; retainedGitDrafts[draftKey] = ""; return next; }); retainedGitSelections.delete(draftKey); setSelected([]); onMutated(); await refresh();
		} catch (reason) { setWriteError(String(reason)); await refresh(); }
		finally { projectGitCache.pause(project.path, false); setWriting(false); }
	};
	const rollbackTargets = status?.entries.filter((entry) => selected.includes(entry.path) && entry.rollbackable) ?? [];
	const rollback = async () => {
		if (!project || !status || !rollbackTargets.length) return;
		setWriting(true); setNotice(undefined); setWriteError(undefined); projectGitCache.pause(project.path, true);
		try {
			await rollbackFiles(project.path, rollbackTargets.flatMap((entry) => [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])]), status.version);
			projectDiffCache.invalidateRoot(project.path);
			setNotice(`已恢复 ${rollbackTargets.length} 个文件到 HEAD`); retainedGitSelections.delete(draftKey); setSelected([]); onMutated(); await refresh();
		} catch (reason) { setWriteError(String(reason)); await refresh(); }
		finally { projectGitCache.pause(project.path, false); setWriting(false); }
	};
	return <section className="workbench-section git-panel" aria-label="Git 变更">
		<div className="workbench-tab-actions"><IconButton size="compact" variant="ghost" aria-label="刷新 Git 状态" title="刷新 Git 状态" onClick={() => { setWriteError(undefined); void refresh(); }} disabled={loading || writing}><Icon name="updateProject" /></IconButton></div>
		{!project ? <div className="workbench-empty">选择一个项目以查看 Git 变更</div> : <>
			{status && <div className="git-repository" title={status.repositoryRoot}><div><Icon name="git" /><strong>{status.branch}</strong>{status.head && <code>{status.head.slice(0, 8)}</code>}</div><span>{status.repositoryRoot}</span>{status.scope && <small>范围：{status.scope}</small>}</div>}
			{local && <div className="workbench-empty git-local-project" role="status"><span><Icon name="laptop" size={20} />本地</span><p>Local project</p></div>}
			{status?.operation && <div className="workbench-banner warning">仓库正在进行 {status.operation}，写操作已禁用。</div>}
			{error && <div className="workbench-banner error" role="alert">{error}</div>}
			{notice && <div className="workbench-banner success" role="status">{notice}</div>}
			{loading && !status && !local ? <div className="workbench-empty">正在读取 Git 状态…</div> : status && <GitChanges key={draftKey} cacheKey={draftKey} entries={status.entries} selected={selected} writing={writing} onSelect={select} onOpen={(entry) => onOpen(project, entry.path, "diff")} />}
			{status && <div className="git-commit-box">
				<div className="git-commit-summary"><span className="git-selected-count">已选 {selected.length} 个文件</span><Button size="compact" variant="ghost" disabled={!rollbackTargets.length || writing || !!status.operation} onClick={() => setConfirmRollback(true)}>恢复所选</Button></div>
				<div className="git-change-counts" aria-label="所选文件分类统计" aria-live="polite">{Object.entries(counts).filter(([, count]) => count > 0).map(([kind, count]) => <span key={kind} data-kind={kind}>{count} {kind}</span>)}</div>
				<TextArea aria-label="提交信息" rows={5} placeholder="Commit Message" disabled={writing} value={message} onChange={(event) => setDrafts((current) => { const next = { ...current, [draftKey]: event.target.value }; retainedGitDrafts[draftKey] = event.target.value; return next; })} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void commit(); } }} />
				<div className="git-commit-actions"><Button size="compact" variant="primary" disabled={writing || loading || !selected.length || !message.trim() || !!status.operation} onClick={() => void commit()}>Commit</Button><Button size="compact" disabled={writing || loading || !selected.length || !message.trim() || !!status.operation} title="提交所选文件，并推送当前分支到已配置的上游" onClick={() => void commit(true)}>Commit and Push</Button></div>
				{writing && <span className="muted" role="status">正在执行 Git 操作…</span>}
			</div>}
		</>}
		{confirmRollback && <Dialog className="project-dialog" aria-label="恢复所选文件" onClose={() => setConfirmRollback(false)}><div className="dialog-heading"><h2>恢复到当前 HEAD？</h2><IconButton aria-label="关闭" onClick={() => setConfirmRollback(false)}><Icon name="close" /></IconButton></div><p>项目：{project?.name}<br />将永久丢弃 {rollbackTargets.map((entry) => entry.path).join("、")} 的暂存区与工作区改动。未跟踪文件不会删除。</p><div className="dialog-actions"><Button onClick={() => setConfirmRollback(false)}>取消</Button><Button variant="danger" onClick={() => { setConfirmRollback(false); void rollback(); }}>确认恢复</Button></div></Dialog>}
	</section>;
}

export function ProjectWorkbenchPanel({ tool, onSelectTab, projects, project, following, onSelectProject, onFollow, onAddProject, onOpen, onMutated, history }: { history?: ReactNode; tool: WorkbenchTool; onSelectTab: (tool: "files" | "git") => void; projects: Project[]; project?: Project; following: boolean; onSelectProject: (id: string) => void; onFollow: () => void; onAddProject: () => void; onOpen: (project: Project, path: string, mode: PreviewMode) => void; onMutated: () => void }) {
	const id = useId();
	const tabs = [{ id: "files", label: "文件" }, { id: "git", label: "Commit" }] as const;
	return <aside className="workbench-panel">
		<WorkbenchProjectPicker projects={projects} project={project} following={following} onSelect={onSelectProject} onFollow={onFollow} onAdd={onAddProject} />
		{tool === "git-tree" && history}
		<div className="workbench-content" hidden={tool === "git-tree"}>
			<div className="workbench-tabs" role="tablist" aria-label="项目文件与提交">{tabs.map((tab, index) => <button key={tab.id} type="button" id={`${id}-tab-${tab.id}`} role="tab" aria-selected={tool === tab.id} aria-controls={`${id}-panel-${tab.id}`} tabIndex={tool === tab.id ? 0 : -1} onClick={() => onSelectTab(tab.id)} onKeyDown={(event) => {
				if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
				event.preventDefault();
				const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
				onSelectTab(tabs[next].id);
				document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
			}}>{tab.label}</button>)}</div>
			<div className="workbench-tool-slot" role="tabpanel" id={`${id}-panel-files`} aria-labelledby={`${id}-tab-files`} hidden={tool !== "files"}><FilePanel project={project} onOpen={onOpen} /></div>
			<div className="workbench-tool-slot" role="tabpanel" id={`${id}-panel-git`} aria-labelledby={`${id}-tab-git`} hidden={tool !== "git"}><GitPanel key={project?.id} project={project} onOpen={onOpen} onMutated={onMutated} /></div>
		</div>
	</aside>;
}
