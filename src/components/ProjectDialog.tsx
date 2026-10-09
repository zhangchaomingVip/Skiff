import { Dialog, IconButton, Field, Button } from "./ui";
import { useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";

export function ProjectDialog({ onAdd, onClose }: { onAdd: (path: string) => Promise<void>; onClose: () => void }) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [path, setPath] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending || !path.trim()) return;
		setPending(true);
		try { await onAdd(path); onClose(); } catch (e) { setError(String(e)); setPending(false); }
	};
	return <Dialog onClose={onClose} pending={pending} initialFocus={inputRef}  className="project-dialog" aria-labelledby="project-dialog-title" >
		<form onSubmit={(event) => void submit(event)}>
			<div className="dialog-heading"><h2 id="project-dialog-title">添加项目</h2><IconButton type="button"  onClick={onClose} disabled={pending} aria-label="关闭"><Icon name="close" /></IconButton></div>
			<p className="muted">选择你的工作目录，聊天将在这个项目中运行。</p>
			<Field label="项目文件夹路径" error={error} ref={inputRef} id="project-path" autoFocus required value={path} onChange={(event) => { setPath(event.target.value); setError(undefined); }} placeholder="例如 D:\workspace\my-project" disabled={pending} />
			<div className="dialog-actions"><Button variant="ghost" onClick={onClose} disabled={pending}>取消</Button><Button type="submit" variant="primary" size="primary" loading={pending} disabled={!path.trim()}>{pending ? "正在添加…" : "添加项目"}</Button></div>
		</form>
	</Dialog>;
}
