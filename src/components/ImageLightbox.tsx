import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { GenerationAsset } from "../workbench/useGenerationStudio";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton } from "./ui";
import "./image-lightbox.css";

const fittedView = { scale: 1, x: 0, y: 0 };

/** Scale is relative to the fitted image; translations are viewport pixels. */
export function ImageLightbox({ asset, onClose }: { asset: GenerationAsset; onClose: () => void }) {
	const viewport = useRef<HTMLDivElement>(null);
	const drag = useRef<{ id: number; x: number; y: number; panX: number; panY: number }>();
	const [view, setView] = useState(fittedView);
	const [dragging, setDragging] = useState(false);
	const [failed, setFailed] = useState(false);
	const zoom = (factor: number, point = { x: 0, y: 0 }) => setView((current) => {
		const scale = Math.min(5, Math.max(0.5, current.scale * factor));
		if (scale <= 1) return { scale, x: 0, y: 0 };
		const ratio = scale / current.scale;
		return { scale, x: point.x - (point.x - current.x) * ratio, y: point.y - (point.y - current.y) * ratio };
	});
	useEffect(() => {
		const node = viewport.current;
		if (!node) return;
		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			const bounds = node.getBoundingClientRect();
			const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
			zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002), { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 });
		};
		const reset = () => { drag.current = undefined; setDragging(false); setView(fittedView); };
		node.addEventListener("wheel", wheel, { passive: false });
		window.addEventListener("resize", reset);
		return () => { node.removeEventListener("wheel", wheel); window.removeEventListener("resize", reset); };
	}, []);
	const stopDrag = (event: PointerEvent<HTMLImageElement>) => {
		if (drag.current?.id !== event.pointerId) return;
		drag.current = undefined; setDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
	};
	return <Dialog className="image-lightbox" aria-label="图片预览" returnFocusSelector=".design-result-card .generation-card-preview" onClose={onClose}>
		<IconButton className="image-lightbox-close" variant="ghost" aria-label="关闭作品预览" onClick={onClose}><Icon name="close" size={20} /></IconButton>
		<div className="image-lightbox-viewport" ref={viewport} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			{failed ? <p role="status">暂时无法预览这个文件</p> : <img src={asset.url} alt="生成作品" draggable={false} className="image-lightbox-image" data-zoomed={view.scale > 1} data-dragging={dragging} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} onError={() => setFailed(true)} onDoubleClick={() => { setView(view.scale === 1 ? { scale: 2, x: 0, y: 0 } : fittedView); }} onPointerDown={(event) => {
				if (event.button !== 0 || view.scale <= 1 || drag.current) return;
				event.preventDefault();
				drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: view.x, panY: view.y };
				event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
			}} onPointerMove={(event) => {
				const start = drag.current;
				if (!start || start.id !== event.pointerId) return;
				setView((current) => ({ ...current, x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y }));
			}} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={() => { drag.current = undefined; setDragging(false); }} />}
		</div>
		<div className="image-lightbox-controls" role="group" aria-label="图片缩放">
			<IconButton variant="ghost" aria-label="缩小" disabled={failed || view.scale <= 0.5} onClick={() => zoom(1 / 1.25)}><Icon name="minus" size={16} /></IconButton>
			<output aria-label="当前缩放">{Math.round(view.scale * 100)}%</output>
			<IconButton variant="ghost" aria-label="放大" disabled={failed || view.scale >= 5} onClick={() => zoom(1.25)}><Icon name="plus" size={16} /></IconButton>
			<Button variant="ghost" aria-label="复位缩放" title="适应窗口" disabled={failed} onClick={() => setView(fittedView)}>1:1</Button>
		</div>
	</Dialog>;
}
