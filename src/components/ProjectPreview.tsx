import { useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js";
import { gitDiff, readFile, type DiffPreview, type FilePreview, type PreviewMode, type PreviewTab } from "../workbench/projectWorkbench";
import { Icon } from "./Icon";
import { Button, IconButton } from "./ui";

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

function DiffText({ content }: { content: string }) {
	return <div className="diff-preview">{content.split("\n").map((line, index) => <div key={index} className={line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "remove" : line.startsWith("@@") ? "hunk" : ""}><span>{index + 1}</span><code>{line || " "}</code></div>)}</div>;
}

export function ProjectPreview({ tabs, activeId, revision, onActivate, onClose, onMode, onBack }: { tabs: PreviewTab[]; activeId?: string; revision: number; onActivate: (id: string) => void; onClose: (id: string) => void; onMode: (id: string, mode: PreviewMode) => void; onBack: () => void }) {
	const tab = tabs.find((item) => item.id === activeId);
	const [result, setResult] = useState<FilePreview | DiffPreview>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [refresh, setRefresh] = useState(0);
	const request = useRef(0);
	useEffect(() => {
		if (!tab) { setResult(undefined); return; }
		const ticket = ++request.current;
		setLoading(true); setError(undefined); setResult(undefined);
		const promise = tab.mode === "diff" ? gitDiff(tab.root, tab.path) : readFile(tab.root, tab.path);
		void promise.then((value) => { if (ticket === request.current) setResult(value); }).catch((reason) => { if (ticket === request.current) setError(String(reason)); }).finally(() => { if (ticket === request.current) setLoading(false); });
		return () => { request.current += 1; };
	}, [tab?.id, tab?.mode, tab?.root, tab?.path, refresh, revision]);
	if (!tab) return null;
	const text = result?.kind === "text" ? result.content : undefined;
	return <section className="project-preview" aria-label="文件预览">
		<header className="preview-header">
			<Button size="compact" variant="ghost" onClick={onBack}><Icon name="arrow" />返回聊天</Button>
			<div className="preview-tabs" role="tablist" aria-label="打开的文件">{tabs.map((item) => <div key={item.id} className={`preview-tab ${item.id === tab.id ? "active" : ""}`} role="tab" aria-selected={item.id === tab.id} title={`${item.projectName} · ${item.path}`}><button onClick={() => onActivate(item.id)}><Icon name="file" /><span>{item.name}</span>{item.mode === "diff" && <small>Diff</small>}</button><IconButton size="compact" aria-label={`关闭 ${item.name}`} onClick={() => onClose(item.id)}><Icon name="close" /></IconButton></div>)}</div>
			<IconButton size="compact" aria-label="刷新预览" onClick={() => setRefresh((value) => value + 1)}><Icon name="refresh" /></IconButton>
		</header>
		<div className="preview-subheader"><div><strong>{tab.name}</strong><span title={`${tab.projectName} · ${tab.path}`}>{tab.projectName} / {tab.path}</span></div><div className="preview-mode" role="group" aria-label="预览模式"><button aria-pressed={tab.mode === "file"} onClick={() => onMode(tab.id, "file")}>文件</button><button aria-pressed={tab.mode === "diff"} onClick={() => onMode(tab.id, "diff")}>Diff</button></div></div>
		<div className="preview-content">
			{loading && <div className="preview-state">正在读取…</div>}
			{error && <div className="preview-state error"><Icon name="alert" size={20} /><p>无法预览这个文件</p><span>{error}</span><Button size="compact" onClick={() => setRefresh((value) => value + 1)}>重试</Button></div>}
			{result?.kind === "binary" && <div className="preview-state"><Icon name="file" size={24} /><p>二进制内容无法以文本预览</p></div>}
			{result?.kind === "tooLarge" && <div className="preview-state"><Icon name="file" size={24} /><p>文件超过 2 MB 预览上限</p><span>{(result.size / 1024 / 1024).toFixed(1)} MB</span></div>}
			{tab.mode === "file" && typeof text === "string" && <TextPreview content={text} path={tab.path} />}
			{tab.mode === "diff" && typeof text === "string" && <><DiffText content={text} />{(result as DiffPreview).truncated && <div className="workbench-limit">Diff 超过 2 MB，仅显示前段内容</div>}</>}
		</div>
	</section>;
}
