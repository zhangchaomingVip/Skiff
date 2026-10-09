import { Dialog, IconButton } from "./ui";
import { useState } from "react";
import { Icon } from "./Icon";

export function ImagePreview({ src, alt = "消息附件" }: { src: string; alt?: string }) {
	const [open, setOpen] = useState(false);
	return <>
		<button className="image-trigger" aria-label={`放大图片：${alt}`} onClick={() => setOpen(true)}><img className="message-image" src={src} alt={alt} loading="lazy" /></button>
		{open && <Dialog className="image-lightbox" aria-label="图片预览" onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
			<IconButton autoFocus aria-label="关闭图片预览" onClick={() => setOpen(false)}><Icon name="close" /></IconButton><img src={src} alt={`放大的${alt}`} />
		</Dialog>}
	</>;
}
