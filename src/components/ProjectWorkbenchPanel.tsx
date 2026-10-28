import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../chat/workspace";
import { commitFiles, gitStatus, listDirectory, rollbackFiles, type DirectoryEntry, type DirectoryPage, type GitEntry, type GitStatus, type PreviewMode, type WorkbenchTool } from "../workbench/projectWorkbench";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton, Select, TextArea } from "./ui";

function ProjectPicker({ projects, project, following, onSelect, onFollow }: { projects: Project[]; project?: Project; following: boolean; onSelect: (id: string) => void; onFollow: () => void }) {
	return <div className="workbench-project-picker">
		<label htmlFor="workbench-project">浏览项目</label>
		<Select id="workbench-project" value={project?.id ?? ""} onChange={(event) => onSelect(event.target.value)}>
			{!project && <option value="">选择项目</option>}
			{projects.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.path}</option>)}
		</Select>
		{!following && <Button size="compact" variant="ghost" onClick={onFollow}><Icon name="target" />回到当前项目</Button>}
	</div>;
}

function TreeRow({ project, entry, depth, expanded, page, loading, error, onToggle, onOpen }: { project: Project; entry: DirectoryEntry; depth: number; expanded: boolean; page?: DirectoryPage; loading: boolean; error?: string; onToggle: (path: string) => void; onOpen: (project: Project, path: string, mode: PreviewMode) => void }) {
	const directory = entry.kind === "directory";
	return <>
		<button className="file-tree-row" style={{ paddingLeft: `${10 + depth * 16}px` }} title={entry.path} onClick={() => directory ? onToggle(entry.path) : entry.kind === "file" && onOpen(project, entry.path, "file")}>
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

type TreeContextValue = { expanded: Set<string>; pages: Map<string, DirectoryPage>; loading: Set<string>; errors: Map<string, string> };
const TreeContext = createContext<TreeContextValue>({ expanded: new Set(), pages: new Map(), loading: new Set(), errors: new Map() });

function TreeNode({ project, entry, depth, onToggle, onOpen }: { project: Project; entry: DirectoryEntry; depth: number; onToggle: (path: string) => void; onOpen: (project: Project, path: string, mode: PreviewMode) => void }) {
	const tree = useContext(TreeContext);
	return <TreeRow project={project} entry={entry} depth={depth} expanded={tree.expanded.has(entry.path)} page={tree.pages.get(entry.path)} loading={tree.loading.has(entry.path)} error={tree.errors.get(entry.path)} onToggle={onToggle} onOpen={onOpen} />;
}

function FilePanel({ project, onOpen }: { project?: Project; onOpen: (project: Project, path: string, mode: PreviewMode) => void }) {
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
	const toggle = (path: string) => {
		if (!project) return;
		const wasOpen = expanded.has(path);
		setExpandedByProject((current) => { const next = { ...current, [project.id]: wasOpen ? (current[project.id] ?? []).filter((item) => item !== path) : [...(current[project.id] ?? []), path] }; Object.assign(retainedExpandedProjects, next); return next; });
		if (!wasOpen) void load(path, projectErrors.has(path));
	};
	const refresh = () => {
		if (!project) return;
		setPages((current) => { const next = new Map(Array.from(current).filter(([item]) => !item.startsWith(prefix))); retainedFilePages.clear(); for (const item of next) retainedFilePages.set(...item); return next; });
		void load("", true);
	};
	const tree = useMemo(() => ({ expanded, pages: projectPages, loading: projectLoading, errors: projectErrors }), [expanded, projectPages, projectLoading, projectErrors]);
	const root = projectPages.get("");
	return <section className="workbench-section file-panel" aria-label="项目文件">
		<div className="workbench-toolbar"><strong>文件</strong><span /><IconButton size="compact" aria-label="全部折叠" onClick={() => project && setExpandedByProject((current) => { const next = { ...current, [project.id]: [] }; Object.assign(retainedExpandedProjects, next); return next; })}><Icon name="minus" /></IconButton><IconButton size="compact" aria-label="刷新文件树" onClick={refresh}><Icon name="refresh" /></IconButton></div>
		{!project ? <div className="workbench-empty">选择一个项目以浏览文件</div> : <div className="file-tree" role="tree" aria-label={`${project.name} 文件树`} ref={(node) => { if (node && node.dataset.project !== project.id) { node.dataset.project = project.id; node.scrollTop = retainedFileScroll.get(project.id) ?? 0; } }} onScroll={(event) => retainedFileScroll.set(project.id, event.currentTarget.scrollTop)}>
			{projectLoading.has("") && !root && <div className="workbench-empty">正在读取文件…</div>}
			{projectErrors.has("") && <div className="workbench-empty error"><p>{projectErrors.get("")}</p><Button size="compact" onClick={() => void load("", true)}>重试</Button></div>}
			<TreeContext.Provider value={tree}>{root?.entries.map((entry) => <TreeNode key={entry.path} project={project} entry={entry} depth={0} onToggle={toggle} onOpen={onOpen} />)}</TreeContext.Provider>
			{root && !root.entries.length && <div className="workbench-empty">项目目录为空</div>}
			{root?.truncated && <p className="workbench-limit">目录内容过多，仅显示前 500 项</p>}
		</div>}
	</section>;
}

const kindLabel: Record<GitEntry["kind"], string> = { modified: "M", added: "A", deleted: "D", renamed: "R", untracked: "U", conflict: "!" };

// The drawer and desktop panel intentionally unmount while closed. These
// run-lifetime caches keep browsing context without writing it into workspace v1.
const retainedFilePages = new Map<string, DirectoryPage>();
const retainedExpandedProjects: Record<string, string[]> = {};
const retainedFileScroll = new Map<string, number>();
const retainedGitDrafts: Record<string, string> = {};
const retainedGitSelections = new Map<string, { version: string; paths: string[] }>();

function GitPanel({ project, onOpen, onMutated }: { project?: Project; onOpen: (project: Project, path: string, mode: PreviewMode) => void; onMutated: () => void }) {
	const [status, setStatus] = useState<GitStatus>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [selected, setSelected] = useState<string[]>([]);
	const [drafts, setDrafts] = useState<Record<string, string>>(() => ({ ...retainedGitDrafts }));
	const [writing, setWriting] = useState(false);
	const [notice, setNotice] = useState<string>();
	const [confirmRollback, setConfirmRollback] = useState(false);
	const request = useRef(0);
	const statusIdentity = useRef<{ projectId?: string; version?: string }>({});
	const draftKey = `${project?.id ?? ""}:${status?.repositoryRoot ?? ""}`;
	const message = drafts[draftKey] ?? "";
	const refresh = useCallback(async () => {
		if (!project) { setStatus(undefined); return; }
		const ticket = ++request.current;
		setLoading(true); setError(undefined);
		try {
			const next = await gitStatus(project.path);
			if (ticket !== request.current) return;
			const nextKey = `${project.id}:${next.repositoryRoot}`;
			if (statusIdentity.current.projectId !== project.id || statusIdentity.current.version !== next.version) {
				const retained = retainedGitSelections.get(nextKey);
				setSelected(retained?.version === next.version ? retained.paths : []);
				if (retained?.version !== next.version) retainedGitSelections.delete(nextKey);
			}
			statusIdentity.current = { projectId: project.id, version: next.version };
			setStatus(next);
		} catch (reason) { if (ticket === request.current) { setStatus(undefined); setError(String(reason)); setSelected([]); } }
		finally { if (ticket === request.current) setLoading(false); }
	}, [project?.id, project?.path]);
	useEffect(() => { void refresh(); }, [refresh]);
	useEffect(() => { const focus = () => void refresh(); window.addEventListener("focus", focus); return () => window.removeEventListener("focus", focus); }, [refresh]);
	const toggle = (entry: GitEntry) => setSelected((current) => {
		const next = current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path];
		if (status) retainedGitSelections.set(draftKey, { version: status.version, paths: next });
		return next;
	});
	const commit = async () => {
		if (!project || !status || !selected.length || !message.trim()) return;
		setWriting(true); setNotice(undefined);
		try {
			const result = await commitFiles(project.path, selected, message, status.version);
			setNotice(`已创建本地提交 ${result.commit}`); setDrafts((current) => { const next = { ...current, [draftKey]: "" }; retainedGitDrafts[draftKey] = ""; return next; }); retainedGitSelections.delete(draftKey); setSelected([]); onMutated(); await refresh();
		} catch (reason) { setError(String(reason)); await refresh(); }
		finally { setWriting(false); }
	};
	const rollbackTargets = status?.entries.filter((entry) => selected.includes(entry.path) && entry.rollbackable) ?? [];
	const rollback = async () => {
		if (!project || !status || !rollbackTargets.length) return;
		setWriting(true); setNotice(undefined);
		try {
			await rollbackFiles(project.path, rollbackTargets.flatMap((entry) => [entry.path, ...(entry.oldPath ? [entry.oldPath] : [])]), status.version);
			setNotice(`已恢复 ${rollbackTargets.length} 个文件到 HEAD`); retainedGitSelections.delete(draftKey); setSelected([]); onMutated(); await refresh();
		} catch (reason) { setError(String(reason)); await refresh(); }
		finally { setWriting(false); }
	};
	return <section className="workbench-section git-panel" aria-label="Git 变更">
		<div className="workbench-toolbar"><strong>Git</strong><span /><IconButton size="compact" aria-label="刷新 Git 状态" onClick={() => void refresh()} disabled={loading || writing}><Icon name="refresh" /></IconButton></div>
		{!project ? <div className="workbench-empty">选择一个项目以查看 Git 变更</div> : <>
			{status && <div className="git-repository" title={status.repositoryRoot}><div><Icon name="git" /><strong>{status.branch}</strong>{status.head && <code>{status.head.slice(0, 8)}</code>}</div><span>{status.repositoryRoot}</span>{status.scope && <small>范围：{status.scope}</small>}</div>}
			{status?.operation && <div className="workbench-banner warning">仓库正在进行 {status.operation}，写操作已禁用。</div>}
			{error && <div className="workbench-banner error" role="alert">{error}</div>}
			{notice && <div className="workbench-banner success" role="status">{notice}</div>}
			{loading && !status ? <div className="workbench-empty">正在读取 Git 状态…</div> : status && <div className="git-changes">
				{status.entries.map((entry) => <div key={`${entry.path}:${entry.oldPath ?? ""}`} className="git-change-row">
					<input type="checkbox" aria-label={`选择 ${entry.path}`} checked={selected.includes(entry.path)} disabled={!entry.selectable || writing} onChange={() => toggle(entry)} />
					<button className="git-file" title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path} onClick={() => onOpen(project, entry.path, "diff")}><span className={`git-kind ${entry.kind}`}>{kindLabel[entry.kind]}</span><span>{entry.path}</span>{entry.oldPath && <small>← {entry.oldPath}</small>}</button>
					{entry.kind === "untracked" && !selected.includes(entry.path) && <Button size="compact" variant="ghost" onClick={() => toggle(entry)}>加入提交</Button>}
				</div>)}
				{!status.entries.length && <div className="workbench-empty">工作区没有变更</div>}
			</div>}
			<div className="git-commit-box">
				<TextArea aria-label="提交信息" rows={3} placeholder="填写 commit 信息" value={message} onChange={(event) => setDrafts((current) => { const next = { ...current, [draftKey]: event.target.value }; retainedGitDrafts[draftKey] = event.target.value; return next; })} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void commit(); } }} />
				<div><Button size="compact" variant="danger" disabled={!rollbackTargets.length || writing || !!status?.operation} onClick={() => setConfirmRollback(true)}>恢复所选</Button><Button size="compact" variant="primary" loading={writing} disabled={!selected.length || !message.trim() || !!status?.operation} onClick={() => void commit()}>提交所选 {selected.length} 个文件</Button></div>
			</div>
		</>}
		{confirmRollback && <Dialog className="project-dialog" aria-label="恢复所选文件" onClose={() => setConfirmRollback(false)}><div className="dialog-heading"><h2>恢复到当前 HEAD？</h2><IconButton aria-label="关闭" onClick={() => setConfirmRollback(false)}><Icon name="close" /></IconButton></div><p>项目：{project?.name}<br />将永久丢弃 {rollbackTargets.map((entry) => entry.path).join("、")} 的暂存区与工作区改动。未跟踪文件不会删除。</p><div className="dialog-actions"><Button onClick={() => setConfirmRollback(false)}>取消</Button><Button variant="danger" onClick={() => { setConfirmRollback(false); void rollback(); }}>确认恢复</Button></div></Dialog>}
	</section>;
}

export function ProjectWorkbenchPanel({ tool, projects, project, following, onSelectProject, onFollow, onOpen, onMutated }: { tool: WorkbenchTool; projects: Project[]; project?: Project; following: boolean; onSelectProject: (id: string) => void; onFollow: () => void; onOpen: (project: Project, path: string, mode: PreviewMode) => void; onMutated: () => void }) {
	return <aside className="workbench-panel">
		<ProjectPicker projects={projects} project={project} following={following} onSelect={onSelectProject} onFollow={onFollow} />
		<div className="workbench-tool-slot" hidden={tool !== "files"}><FilePanel project={project} onOpen={onOpen} /></div>
		<div className="workbench-tool-slot" hidden={tool !== "git"}><GitPanel project={project} onOpen={onOpen} onMutated={onMutated} /></div>
	</aside>;
}
