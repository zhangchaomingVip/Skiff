import { Dialog, IconButton, Button } from "./ui";
import { useRef } from "react";
import { Icon } from "./Icon";

export function ConfirmDialog({ title, description, onConfirm, onClose, confirmText = "确认删除" }: { title: string; description: string; onConfirm: () => void; onClose: () => void; confirmText?: string }) {
	const cancel = useRef<HTMLButtonElement>(null);
	return <Dialog onClose={onClose} initialFocus={cancel} className="project-dialog"  aria-label={title} >
			<div className="dialog-heading"><h2>{title}</h2><IconButton aria-label={confirmText === "确认删除" ? "关闭删除确认" : "关闭确认"} onClick={onClose}><Icon name="close" /></IconButton></div>
		<p>{description}</p>
		<div className="dialog-actions"><Button ref={cancel} aria-label={confirmText === "确认删除" ? "取消删除" : "取消"} onClick={onClose}>取消</Button><Button variant="danger" aria-label={confirmText} onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Button></div>
	</Dialog>;
}
