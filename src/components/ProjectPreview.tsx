import { memo, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js";
import { readFile, type DiffPreview, type FilePreview, type PreviewMode, type PreviewTab } from "../workbench/projectWorkbench";
import { Icon } from "./Icon";
import { Button, IconButton } from "./ui";
import { useProjectGitStatus } from "../workbench/useProjectGitStatus";
import { projectDiffCache } from "../workbench/projectDiffCache";

const languageFor = (path: string) => {
	const extension = path.split(".").pop()?.toLowerCase();
	return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", rs: "rust", json: "json", css: "css", html: "xml", md: "markdown", py: "python", sh: "shell", ps1: "powershell", toml: "ini", yaml: "yaml", yml: "yaml" } as Record<string, string>)[extension ?? ""];
};

function TextPreview({ content, path }: { content: string; path: string }) {
	const html = useMemo(() => {
		const language = languageFor(path);
		try { return language && hljs.getLanguage(language) ? hljs.highlight(content, { language }).value : hljs.highlightAuto(content).value; }
		catch { return content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
	}, [content, path]);
	return <div className="source-preview"><div className="source-lines" aria-hidden="true">{content.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div><pre><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre></div>;
}

export const DiffText = memo(function DiffText({ content }: { content: string }) {
	return <div className="diff-preview">{content.split("\n").map((line, index) => <div key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "remove" : line.startsWith("@@") ? "hunk" : ""}><span>{index + 1}</span><code>{line || " "}</code></div>)}</div>;
});

function PreviewFileTab({ item, active, onActivate, onClose }: { item: PreviewTab; active: boolean; onActivate: (id: string) => void; onClose: (id: string) => void }) {
	const { status } = useProjectGitStatus({ path: item.root });
	const kind = status?.entries.find((entry) => entry.path.replaceAll("\\", "/") === item.path.replaceAll("\\", "/"))?.kind;
	return <div className={`preview-tab ${active ? "active" : ""}`} data-git-kind={kind} role="tab" aria-selected={active} title={`${item.projectName} · ${item.path}`}>
		<button className="preview-tab-open" onClick={() => onActivate(item.id)}><Icon name="file" /><span>{item.name}</span></button>
		<IconButton className="preview-tab-close" size="compact" variant="ghost" aria-label={`关闭 ${item.name}`} title={`关闭 ${item.name}`} onClick={() => onClose(item.id)}><Icon name="close" size={14} /></IconButton>
	</div>;
}

export function ProjectPreview({ tabs, activeId, revision, onActivate, onClose, onMode, onBack }: { tabs: PreviewTab[]; activeId?: string; revision: number; onActivate: (id: string) => void; onClose: (id: string) => void; onMode: (id: string, mode: PreviewMode) => void; onBack: () => void }) {
	const tab = tabs.find((item) => item.id === activeId);
	const git = useProjectGitStatus(tab ? { path: tab.root } : undefined);
	const gitVersion = tab?.mode === "diff" ? git.status?.version : undefined;
	const [preview, setPreview] = useState<{ key: string; result?: FilePreview | DiffPreview; loading: boolean; error?: string }>();
	const [refresh, setRefresh] = useState(0);
	const request = useRef(0);
	const tabList = useRef<HTMLDivElement>(null);
	useEffect(() => { tabList.current?.querySelector(".preview-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [activeId]);
	const key = JSON.stringify([tab?.id, tab?.mode, tab?.root, tab?.path, gitVersion, refresh, revision]);
	const cached = tab?.mode === "diff" ? projectDiffCache.get(tab.root, tab.path) : undefined;
	const { result, loading, error } = preview?.key === key ? preview : { result: cached, loading: !!tab && !cached, error: undefined };
	const refreshPreview = () => {
		if (tab?.mode === "diff") projectDiffCache.invalidate(tab.root, tab.path);
		setRefresh((value) => value + 1);
	};
	useEffect(() => {
		if (!tab) return;
		const ticket = ++request.current;
		const retained = tab.mode === "diff" ? projectDiffCache.get(tab.root, tab.path) : undefined;
		if (retained) { setPreview({ key, result: retained, loading: false }); return; }
		setPreview({ key, loading: true });
		const promise = tab.mode === "diff" ? projectDiffCache.load(tab.root, tab.path) : readFile(tab.root, tab.path);
		void promise.then((value) => { if (ticket === request.current) setPreview({ key, result: value, loading: false }); }).catch((reason) => { if (ticket === request.current) setPreview({ key, error: String(reason), loading: false }); });
		return () => { request.current += 1; };
	}, [key]);
	if (!tab) return null;
	const text = result?.kind === "text" ? result.content : undefined;
	return <section className="project-preview" aria-label="文件预览">
		<header className="preview-header">
			<Button size="compact" variant="ghost" onClick={onBack}><Icon name="arrow" />返回聊天</Button>
			<div className="preview-tabs" ref={tabList} role="tablist" aria-label="打开的文件">{tabs.map((item) => <PreviewFileTab key={item.id} item={item} active={item.id === tab.id} onActivate={onActivate} onClose={onClose} />)}</div>
		</header>
		<div className="preview-subheader"><div><strong>{tab.name}</strong><span title={`${tab.projectName} · ${tab.path}`}>{tab.projectName} / {tab.path}</span></div><div className="preview-mode" role="group" aria-label="预览模式"><button aria-pressed={tab.mode === "file"} onClick={() => onMode(tab.id, "file")}>文件</button><button aria-pressed={tab.mode === "diff"} onClick={() => onMode(tab.id, "diff")}>Diff</button></div></div>
		<div className="preview-content">
			{loading && <div className="preview-state">正在读取…</div>}
			{error && <div className="preview-state error"><Icon name="alert" size={20} /><p>无法预览这个文件</p><span>{error}</span><Button size="compact" onClick={refreshPreview}>重试</Button></div>}
			{result?.kind === "binary" && <div className="preview-state"><Icon name="file" size={24} /><p>二进制内容无法以文本预览</p></div>}
			{result?.kind === "tooLarge" && <div className="preview-state"><Icon name="file" size={24} /><p>文件超过 2 MB 预览上限</p><span>{(result.size / 1024 / 1024).toFixed(1)} MB</span></div>}
			{tab.mode === "file" && typeof text === "string" && <TextPreview content={text} path={tab.path} />}
			{tab.mode === "diff" && typeof text === "string" && <><DiffText content={text} />{(result as DiffPreview).truncated && <div className="workbench-limit">Diff 超过 2 MB，仅显示前段内容</div>}</>}
		</div>
	</section>;
}
