import { Dialog, IconButton, Input, Button } from "./ui";
import { useRef, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Icon } from "./Icon";

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function ProjectDialog({ onAdd, onClose }: { onAdd: (path: string, name?: string) => Promise<void>; onClose: () => void }) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [folder, setFolder] = useState("");
	const [error, setError] = useState<string>();
	const [pending, setPending] = useState(false);
	const [browsing, setBrowsing] = useState(false);
	// Remember the name we filled in from a folder, so picking another folder
	// updates it while a name typed by the user survives.
	const autoName = useRef("");
	const pickFolder = async () => {
		if (pending || browsing) return;
		setBrowsing(true);
		try {
			const selected = await open({ directory: true, multiple: false, title: "选择源文件夹" }) as string | null;
			if (!selected) return;
			const base = folderName(selected);
			setName((current) => current.trim() && current !== autoName.current ? current : base);
			autoName.current = base;
			setFolder(selected);
			setError(undefined);
		} catch (e) { setError(`无法打开文件夹选择器：${String(e)}`); }
		finally { setBrowsing(false); }
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (pending || !folder) return;
		setPending(true);
		try { await onAdd(folder, name); onClose(); } catch (e) { setError(String(e)); setPending(false); }
	};
	return <Dialog onClose={onClose} pending={pending} initialFocus={inputRef} className="project-dialog" aria-labelledby="project-dialog-title" >
		<form onSubmit={(event) => void submit(event)}>
			<div className="dialog-heading"><h2 id="project-dialog-title">创建项目</h2><IconButton type="button" onClick={onClose} disabled={pending} aria-label="关闭"><Icon name="close" /></IconButton></div>
			<div className="project-name-field">
				<Icon name="folder" size={20} />
				<span className="project-name-divider" aria-hidden="true" />
				<Input ref={inputRef} aria-label="项目名称" autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="项目名称" disabled={pending} />
			</div>
			<div className="project-source">
				<span className="project-source-label" id="project-source-label">源文件夹</span>
				<div className={`project-source-card ${folder ? "selected" : ""}`} role="group" aria-labelledby="project-source-label">
					{folder
						? <div className="project-source-selected">
							<Icon name="folder" size={16} />
							<span title={folder}>{folder}</span>
							<Button type="button" variant="ghost" size="compact" aria-label="更改源文件夹" onClick={() => void pickFolder()} disabled={pending}>更改</Button>
						</div>
						: <>
							<button type="button" className="project-source-pick" onClick={() => void pickFolder()} disabled={pending}>在此电脑上添加文件夹<Icon name="chevron" size={14} /></button>
							<Button type="button" className="project-source-add" size="compact" aria-label="添加源文件夹" loading={browsing} onClick={() => void pickFolder()} disabled={pending}><Icon name="folderPlus" size={16} />添加</Button>
						</>}
				</div>
				{error && <span className="ui-field-help" role="alert">{error}</span>}
			</div>
			<div className="dialog-actions"><Button variant="ghost" onClick={onClose} disabled={pending}>取消</Button><Button type="submit" variant="primary" size="primary" loading={pending} disabled={!folder}>{pending ? "正在创建…" : "创建项目"}</Button></div>
		</form>
	</Dialog>;
}
