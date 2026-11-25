import { useRef, useState } from "react";
import { maxCanvasNameLength } from "../workbench/designCanvases";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton, Input } from "./ui";

/** Shared naming step for creating and renaming a canvas. */
export function CanvasNameDialog({ title, initial = "", confirmText, onConfirm, onClose }: {
	title: string;
	initial?: string;
	confirmText: string;
	onConfirm: (name: string) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(initial);
	const input = useRef<HTMLInputElement>(null);
	const valid = name.trim().length > 0;
	return <Dialog className="project-dialog canvas-name-dialog" aria-label={title} initialFocus={input} onClose={onClose}>
		<form onSubmit={(event) => { event.preventDefault(); if (!valid) return; onConfirm(name.trim()); onClose(); }}>
			<div className="dialog-heading"><h2>{title}</h2><IconButton aria-label="关闭对话命名" onClick={onClose}><Icon name="close" /></IconButton></div>
			<p>给这个对话起个好认的名字，里面的作品不受影响。</p>
			<label className="canvas-name-field"><span>对话名称</span><Input ref={input} value={name} maxLength={maxCanvasNameLength} aria-label="对话名称" placeholder="例如：夏日短片" onChange={(event) => setName(event.target.value)} /></label>
			<div className="dialog-actions"><Button type="submit" variant="primary" disabled={!valid} aria-label={confirmText}>{confirmText}</Button></div>
		</form>
	</Dialog>;
}
