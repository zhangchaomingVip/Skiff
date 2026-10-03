import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function ConfirmDialog({ title, description, onConfirm, onClose }: { title: string; description: string; onConfirm: () => void; onClose: () => void }) {
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); }, []);
	return <dialog className="project-dialog" ref={dialog} aria-label={title} onClose={onClose}>
		<div className="dialog-heading"><h2>{title}</h2><button className="icon-btn" aria-label="关闭删除确认" onClick={onClose}><Icon name="close" /></button></div>
		<p>{description}</p>
		<div className="dialog-actions"><button className="btn" ref={cancel} aria-label="取消删除" onClick={onClose}>取消</button><button className="btn danger" aria-label="确认删除" onClick={() => { onConfirm(); onClose(); }}>确认删除</button></div>
	</dialog>;
}
