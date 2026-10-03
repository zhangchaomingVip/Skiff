import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

export function ImagePreview({ src, alt = "消息附件" }: { src: string; alt?: string }) {
	const [open, setOpen] = useState(false);
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
	return <>
		<button className="image-trigger" aria-label={`放大图片：${alt}`} onClick={() => setOpen(true)}><img className="message-image" src={src} alt={alt} loading="lazy" /></button>
		{open && <dialog className="image-lightbox" ref={dialog} aria-label="图片预览" onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
			<button className="icon-btn" autoFocus aria-label="关闭图片预览" onClick={() => dialog.current?.close()}><Icon name="close" /></button><img src={src} alt={`放大的${alt}`} />
		</dialog>}
	</>;
}
