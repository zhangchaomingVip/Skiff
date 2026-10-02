import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";

export function ProjectDialog({ onAdd, onClose }: { onAdd: (path: string) => Promise<void>; onClose: () => void }) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [path, setPath] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	useEffect(() => { dialogRef.current?.showModal(); inputRef.current?.focus(); }, []);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending || !path.trim()) return;
		setPending(true);
		try { await onAdd(path); onClose(); } catch (e) { setError(String(e)); setPending(false); }
	};
	return <dialog ref={dialogRef} className="project-dialog" aria-labelledby="project-dialog-title" onCancel={(event) => { if (pending) event.preventDefault(); else onClose(); }}>
		<form onSubmit={(event) => void submit(event)}>
			<div className="dialog-heading"><h2 id="project-dialog-title">添加项目</h2><button type="button" className="icon-btn" onClick={onClose} disabled={pending} aria-label="关闭"><Icon name="close" /></button></div>
			<p className="muted">选择你的工作目录，聊天将在这个项目中运行。</p>
			<label htmlFor="project-path">项目文件夹路径</label>
			<input ref={inputRef} id="project-path" autoFocus required value={path} onChange={(event) => { setPath(event.target.value); setError(undefined); }} placeholder="例如 D:\workspace\my-project" disabled={pending} aria-describedby={error ? "project-error" : undefined} />
			{error && <p id="project-error" className="form-error" role="alert">{error}</p>}
			<div className="dialog-actions"><button type="button" className="btn ghost" onClick={onClose} disabled={pending}>取消</button><button className="btn primary" disabled={pending || !path.trim()}>{pending ? "正在添加…" : "添加项目"}</button></div>
		</form>
	</dialog>;
}
