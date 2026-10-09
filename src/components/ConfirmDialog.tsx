import { Dialog, IconButton, Button } from "./ui";
import { useRef } from "react";
import { Icon } from "./Icon";

export function ConfirmDialog({ title, description, onConfirm, onClose }: { title: string; description: string; onConfirm: () => void; onClose: () => void }) {
	const cancel = useRef<HTMLButtonElement>(null);
	return <Dialog onClose={onClose} initialFocus={cancel} className="project-dialog"  aria-label={title} >
		<div className="dialog-heading"><h2>{title}</h2><IconButton  aria-label="关闭删除确认" onClick={onClose}><Icon name="close" /></IconButton></div>
		<p>{description}</p>
		<div className="dialog-actions"><Button  ref={cancel} aria-label="取消删除" onClick={onClose}>取消</Button><Button variant="danger" aria-label="确认删除" onClick={() => { onConfirm(); onClose(); }}>确认删除</Button></div>
	</Dialog>;
}
