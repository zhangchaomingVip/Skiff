import { Dialog, IconButton } from "./ui";
import { useState } from "react";
import { Icon } from "./Icon";

/** Modal lightbox shared by sent message images and composer attachments. */
export function ImageLightbox({ src, alt = "图片", onClose }: { src: string; alt?: string; onClose: () => void }) {
	return <Dialog className="image-lightbox" aria-label="图片预览" onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
		<IconButton autoFocus aria-label="关闭图片预览" onClick={onClose}><Icon name="close" /></IconButton><img src={src} alt={`放大的${alt}`} />
	</Dialog>;
}

export function ImagePreview({ src, alt = "消息附件" }: { src: string; alt?: string }) {
	const [open, setOpen] = useState(false);
	return <>
		<button className="image-trigger" aria-label={`放大图片：${alt}`} onClick={() => setOpen(true)}><img className="message-image" src={src} alt={alt} loading="lazy" /></button>
		{open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
	</>;
}
