import { useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../chat/types";
import { conversationToShareMarkdown } from "../chat/share";
import { Button, Dialog, IconButton } from "./ui";
import { Icon } from "./Icon";

export function ShareDialog({ title, messages, onClose }: { title?: string; messages: ChatMessage[]; onClose: () => void }) {
	const text = useMemo(() => conversationToShareMarkdown(title, messages), [title, messages]);
	const [status, setStatus] = useState("");
	const shareButton = useRef<HTMLButtonElement>(null);
	const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setStatus("已复制全文");
		} catch {
			setStatus("复制失败，请手动选择文本");
		}
	};
	const share = async () => {
		if (!canShare) return copy();
		try {
			await navigator.share({ title: title?.trim() || "Skiff 对话", text });
			setStatus("已打开分享");
		} catch (error) {
			// Closing the native share sheet is a normal user action.
			if (error instanceof DOMException && error.name === "AbortError") return;
			setStatus("系统分享失败，请复制全文");
		}
	};
	return <Dialog className="share-dialog" onClose={onClose} initialFocus={shareButton} aria-label="分享对话">
		<div className="dialog-heading"><div><h2>分享对话</h2><p className="share-hint">分享当前会话的完整内容。内容只会复制到剪贴板或交给系统分享，不会上传。</p></div><IconButton aria-label="关闭分享对话" onClick={onClose}><Icon name="close" /></IconButton></div>
		<textarea className="share-preview" readOnly value={text} aria-label="对话分享内容" onFocus={(event) => event.currentTarget.select()} />
		{status && <p className="share-status" role="status">{status}</p>}
		<div className="dialog-actions"><Button onClick={onClose}>关闭</Button><Button variant="primary" ref={shareButton} onClick={() => void share()}>{canShare ? "系统分享" : "复制全文"}</Button>{canShare && <Button onClick={() => void copy()}><Icon name="copy" size={15} />复制全文</Button>}</div>
	</Dialog>;
}
