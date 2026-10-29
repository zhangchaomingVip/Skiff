import { useEffect, useMemo, useState } from "react";
import type { Project } from "../chat/workspace";
import { layoutCommitGraph, readCommitDiff, readGitCommit, type CommitDetail, type CommitFile, type GraphRow, type HistoryCommit, type HistoryRef } from "../workbench/gitHistory";
import type { GitHistoryState } from "../workbench/useGitHistory";
import type { DiffPreview } from "../workbench/projectWorkbench";
import { Icon } from "./Icon";
import { Button, IconButton, Input } from "./ui";
import { CopyButton } from "./CopyButton";
import { DiffText } from "./ProjectPreview";
import { GitLogColumns } from "./GitLogColumns";
import "./git-tree.css";

const commitDateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function UpdateProjectButton({ history }: { history: GitHistoryState }) {
	return <IconButton className="git-update-project" size="compact" variant="ghost" aria-label="Update Project" title={`Update Project\n${history.updateTitle}`} loading={history.updating} disabled={!history.canUpdate || history.loading} onClick={() => void history.update()}>{!history.updating && <Icon name="updateProject" />}</IconButton>;
}

export function GitBranches({ history, onSelect }: { history: GitHistoryState; onSelect: (reference: string) => void }) {
	const [query, setQuery] = useState("");
	const refs = history.data?.refs ?? [];
	const filtered = refs.filter((ref) => ref.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
	const row = (ref: HistoryRef) => <button key={ref.name} className="git-ref-row" aria-pressed={history.reference === ref.name} onClick={() => onSelect(ref.name)} title={ref.name}><Icon name={ref.kind === "tag" ? "flag" : "git"} /><span>{ref.label}</span>{ref.name === `refs/heads/${history.data?.branch}` && <small>当前</small>}</button>;
	return <section className="workbench-section git-branches" aria-label="分支树">
		<div className="workbench-toolbar"><strong>Git Tree</strong><span /><UpdateProjectButton history={history} /></div>
		<div className="git-tree-search"><Icon name="search" /><Input appearance="plain" aria-label="搜索分支或标签" placeholder="分支或标签" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
		<div className="git-ref-list">
			<button className="git-ref-row" aria-pressed={!history.reference} onClick={() => onSelect("")}><Icon name="git" /><span>所有分支</span></button>
			<button className="git-ref-row" aria-pressed={history.reference === "HEAD"} onClick={() => onSelect("HEAD")}><Icon name="target" /><span>HEAD · 当前提交</span></button>
			{([ ["local", "本地分支"], ["remote", "远程分支"], ["tag", "标签"] ] as const).map(([kind, label]) => <details className="git-ref-group" key={kind} open>
				<summary><Icon name="chevron" /><span>{label}</span><small>{filtered.filter((ref) => ref.kind === kind).length}</small></summary>
				{kind === "remote" ? [...new Set(filtered.filter((ref) => ref.kind === kind).map((ref) => ref.label.split("/")[0]))].map((remote) => <details className="git-ref-remote" key={remote} open><summary><Icon name="chevron" /><Icon name="folder" /><span>{remote}</span></summary>{filtered.filter((ref) => ref.kind === kind && ref.label.startsWith(`${remote}/`)).map(row)}</details>) : filtered.filter((ref) => ref.kind === kind).map(row)}
			</details>)}
			{query && !filtered.length && <p className="workbench-empty">没有匹配的分支或标签</p>}
		</div>
		{history.data && <div className="git-tree-scope" title={history.data.repositoryRoot}>{history.data.scope ? `项目范围：${history.data.scope}` : "整个仓库"}<span>{history.data.repositoryRoot}</span></div>}
	</section>;
}

function CommitGraph({ row, width, filtered }: { row: GraphRow; width: number; filtered: boolean }) {
	const x = (column: number) => column * 14 + 10;
	return <svg className="commit-graph" width={width * 14 + 12} height={32} aria-hidden="true">
		{!filtered && row.lines.map((line, index) => <path key={index} className={`graph-color-${line.color}`} d={`M${x(line.from)} ${line.start} C${x(line.from)} ${(line.start + line.end) / 2} ${x(line.to)} ${(line.start + line.end) / 2} ${x(line.to)} ${line.end}`} />)}
		<circle className={`graph-color-${row.color}`} cx={x(row.column)} cy={16} r={4} />
	</svg>;
}

function HistoryDiff({ root, hash, file, onClose }: { root: string; hash: string; file: CommitFile; onClose: () => void }) {
	const [result, setResult] = useState<DiffPreview>();
	const [error, setError] = useState<string>();
	const [retry, setRetry] = useState(0);
	useEffect(() => {
		let cancelled = false;
		setResult(undefined); setError(undefined);
		void readCommitDiff(root, hash, file.path).then((value) => { if (!cancelled) setResult(value); }).catch((reason) => { if (!cancelled) setError(String(reason)); });
		return () => { cancelled = true; };
	}, [root, hash, file.path, retry]);
	return <section className="history-diff" aria-label="历史文件 Diff">
		<header><span title={file.path}>{file.path}</span><IconButton size="compact" aria-label="关闭历史 Diff" onClick={onClose}><Icon name="close" /></IconButton></header>
		{!result && !error && <p className="workbench-empty" role="status">正在读取历史 Diff…</p>}
		{error && <div className="workbench-empty error" role="alert"><p>{error}</p><Button size="compact" onClick={() => setRetry((value) => value + 1)}>重试 Diff</Button></div>}
		{result?.kind === "binary" && <p className="workbench-empty">二进制文件，无法显示文本差异</p>}
		{result?.kind === "text" && <><DiffText content={result.content || "此文件没有文本差异（可能仅更改了路径或权限）。"} />{result.truncated && <p className="workbench-limit">Diff 超过 2 MB，仅显示前段内容</p>}</>}
	</section>;
}

type FileNode = { files: CommitFile[]; directories: Map<string, FileNode> };
function buildFileTree(files: CommitFile[]) {
	const root: FileNode = { files: [], directories: new Map() };
	for (const file of files) {
		const parts = file.path.split("/");
		let node = root;
		for (const part of parts.slice(0, -1)) {
			if (!node.directories.has(part)) node.directories.set(part, { files: [], directories: new Map() });
			node = node.directories.get(part)!;
		}
		node.files.push(file);
	}
	return root;
}

function CommitFiles({ node, selected, onSelect }: { node: FileNode; selected?: string; onSelect: (file: CommitFile) => void }) {
	return <>{[...node.directories].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => <details className="commit-file-folder" key={name} open><summary><Icon name="chevron" /><Icon name="folder" /><span>{name}</span></summary><div><CommitFiles node={child} selected={selected} onSelect={onSelect} /></div></details>)}{node.files.map((file) => <button className="commit-file" key={file.path} aria-pressed={selected === file.path} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path} onClick={() => onSelect(file)}><Icon name="file" /><span>{file.path.split("/").pop()}</span><small className={`file-status-${file.status[0]}`}>{file.status[0]}</small></button>)}</>;
}

function CommitDetails({ root, commit, refs }: { root: string; commit: HistoryCommit; refs: HistoryRef[] }) {
	const [detail, setDetail] = useState<CommitDetail>();
	const [error, setError] = useState<string>();
	const [retry, setRetry] = useState(0);
	const [file, setFile] = useState<CommitFile>();
	useEffect(() => {
		let cancelled = false;
		setError(undefined); setDetail(undefined);
		void readGitCommit(root, commit.hash).then((value) => { if (!cancelled) setDetail(value); }).catch((reason) => { if (!cancelled) setError(String(reason)); });
		return () => { cancelled = true; };
	}, [root, commit.hash, retry]);
	const tree = useMemo(() => buildFileTree(detail?.files ?? []), [detail]);
	return <aside className="commit-details" aria-label="提交详情">
		<div className="workbench-toolbar"><strong>提交详情</strong><span /><CopyButton text={commit.hash} label="复制提交 hash" /></div>
		<div className="commit-details-scroll">
			{!detail && !error && <p className="workbench-empty" role="status">正在读取提交…</p>}
			{error && <div className="workbench-empty error" role="alert"><p>{error}</p><Button size="compact" onClick={() => setRetry((value) => value + 1)}>重试提交详情</Button></div>}
			{detail && <><section className="commit-changed-files" aria-label="提交变更文件"><div className="commit-section-label">变更文件 <span>{detail.files.length}</span></div>{detail.files.length ? <CommitFiles node={tree} selected={file?.path} onSelect={setFile} /> : <p className="workbench-empty">此提交在项目范围内没有文件变更</p>}</section>
				<section className="commit-metadata"><h2>{commit.subject}</h2><div className="commit-hash">{commit.hash.slice(0, 12)}</div><p>{commit.author}<br /><span>{commit.email}</span><br /><time dateTime={commit.date}>{new Date(commit.date).toLocaleString()}</time></p>{refs.length > 0 && <div className="commit-ref-badges">{refs.map((ref) => <span key={ref.name} title={ref.name}><Icon name={ref.kind === "tag" ? "flag" : "git"} />{ref.label}</span>)}</div>}{detail.message.trim() !== commit.subject.trim() && <pre>{detail.message.split("\n").slice(1).join("\n").trim()}</pre>}<p className="commit-parent-note">{detail.parents.length > 1 ? `合并提交 · 与第一父提交 ${detail.parents[0].slice(0, 8)} 比较` : detail.parents.length ? `父提交 ${detail.parents[0].slice(0, 8)}` : "初始提交 · 与空目录比较"}</p></section>
			</>}
			{file && <HistoryDiff key={file.path} root={root} hash={commit.hash} file={file} onClose={() => setFile(undefined)} />}
		</div>
	</aside>;
}

export function GitTreeWorkspace({ project, history, onBack, onBranches }: { project?: Project; history: GitHistoryState; onBack: () => void; onBranches: () => void }) {
	const [query, setQuery] = useState("");
	const commits = history.data?.commits ?? [];
	const graph = useMemo(() => layoutCommitGraph(commits), [commits]);
	const width = Math.max(1, ...graph.map((row) => row.width));
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const visible = commits.flatMap((commit, index) => `${commit.subject} ${commit.author} ${commit.hash}`.toLocaleLowerCase().includes(normalizedQuery) ? [{ commit, graph: graph[index] }] : []);
	const selectedRefs = history.data?.refs.filter((ref) => ref.hash === history.selected?.hash) ?? [];
	const referenceLabel = history.reference === "HEAD" ? "HEAD" : history.data?.refs.find((ref) => ref.name === history.reference)?.label ?? "所有分支";
	return <section className="git-tree-workspace" aria-label="Git Tree 历史">
		<header className="git-history-header"><Button size="compact" variant="ghost" onClick={onBack}><Icon name="message" />返回对话</Button><span /><strong>{project?.name ?? "Git Tree"}</strong><small>提交历史</small><Button className="git-branch-toggle" size="compact" variant="ghost" onClick={onBranches}><Icon name="git" />分支</Button></header>
		{!project ? <div className="workbench-empty">选择一个项目以浏览提交历史</div> : history.local ? <div className="workbench-empty"><Icon name="laptop" size={24} /><p>本地项目，尚未创建 Git 仓库</p></div> : <div className="git-history-columns">
			<section className="commit-log" aria-label="提交记录">
				<div className="git-log-toolbar"><div className="git-tree-search"><Icon name="search" /><Input appearance="plain" aria-label="搜索已加载提交" placeholder="搜索已加载提交、作者或 hash" value={query} onChange={(event) => setQuery(event.target.value)} /></div><span title={history.reference || "所有分支"}>{referenceLabel}</span><UpdateProjectButton history={history} /></div>
				{history.notice && <div className={`workbench-banner ${history.notice.tone}`} role={history.notice.tone === "error" ? "alert" : "status"}>{history.notice.text}</div>}
				{history.error && <div className="workbench-empty error" role="alert"><p>{history.error}</p><Button size="compact" onClick={history.refresh}>重试历史</Button>{history.reference && <Button size="compact" onClick={() => history.selectRef("")}>查看所有分支</Button>}</div>}
				{history.loading && <div className="workbench-empty" role="status">正在读取提交历史…</div>}
				{!history.loading && !history.error && <><div className="commit-log-scroll"><GitLogColumns><div className="commit-log-list" role="listbox" aria-label="提交列表">{visible.map(({ commit, graph: row }) => <button key={commit.hash} role="option" aria-selected={history.selected?.hash === commit.hash} className="commit-log-row" onClick={() => history.select(commit.hash)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = event.key === "ArrowDown" ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling; (next as HTMLElement | null)?.focus(); (next as HTMLButtonElement | null)?.click(); } }} title={`${commit.subject}\n${commit.hash}\n${commit.author} · ${new Date(commit.date).toLocaleString()}`}>
						<span className="commit-row-main"><CommitGraph row={row} width={width} filtered={!!normalizedQuery} /><span className="commit-subject">{commit.subject}</span></span><span className="commit-author">{commit.author}</span><time dateTime={commit.date}>{commitDateFormat.format(new Date(commit.date))}</time>
					</button>)}</div>{!visible.length && <p className="workbench-empty">{query ? "已加载记录中没有匹配的提交" : "此范围暂无提交"}</p>}{history.data?.hasMore && <div className="git-history-more">{history.limit < 1000 ? <Button size="compact" onClick={history.more}>加载更多提交</Button> : <span>已显示最近 1000 条，请选择分支缩小范围</span>}</div>}</GitLogColumns></div><footer className="git-log-footer">{commits.length} 条提交{normalizedQuery && ` · 匹配 ${visible.length} 条（搜索时隐藏连线）`}</footer></>}
			</section>
			{history.selected ? <CommitDetails key={`${project.path}:${history.selected.hash}`} root={project.path} commit={history.selected} refs={selectedRefs} /> : <aside className="commit-details"><div className="workbench-empty">选择提交查看详情</div></aside>}
		</div>}
	</section>;
}
