import { useRef, useState, type DragEvent } from "react";

/** Card-wide drop target for a single reference image. Enter and leave are
 *  counted across descendants so dragging over the textarea or a chip never
 *  flickers the overlay. */
export function useReferenceDrop(onFile: (file: File) => void) {
	const [dragging, setDragging] = useState(false);
	const depth = useRef(0);
	const accepts = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
	const reset = () => { depth.current = 0; setDragging(false); };
	return {
		dragging,
		handlers: {
			onDragEnter: (event: DragEvent) => { if (!accepts(event)) return; event.preventDefault(); depth.current += 1; setDragging(true); },
			onDragOver: (event: DragEvent) => { if (!accepts(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; },
			onDragLeave: (event: DragEvent) => { if (!accepts(event)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
			onDrop: (event: DragEvent) => { if (!accepts(event)) { reset(); return; } event.preventDefault(); reset(); const file = event.dataTransfer.files[0]; if (file) onFile(file); },
		},
	};
}
