import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ResizeSeparator } from "./ResizeSeparator";

const storageKey = "skiff.git-tree.columns.v1";
const bounds = { summary: { min: 240, max: 1200 }, author: { min: 80, max: 400 } };
type ColumnWidths = { summary?: number; author?: number };

function readWidths(): ColumnWidths {
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
		const result: ColumnWidths = {};
		for (const column of ["summary", "author"] as const) {
			const value = saved?.[column];
			if (typeof value === "number" && Number.isFinite(value)) result[column] = Math.min(bounds[column].max, Math.max(bounds[column].min, value));
		}
		return result;
	} catch { return {}; }
}

export function GitLogColumns({ children }: { children: ReactNode }) {
	const container = useRef<HTMLDivElement>(null);
	const [available, setAvailable] = useState(0);
	const [widths, setWidths] = useState<ColumnWidths>(readWidths);
	const current = useRef(widths);
	useEffect(() => {
		const element = container.current;
		if (!element?.parentElement) return;
		const viewport = element.parentElement;
		const observer = new ResizeObserver(() => setAvailable(viewport.clientWidth));
		setAvailable(viewport.clientWidth);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, []);
	const author = widths.author ?? 140;
	const summary = widths.summary ?? Math.min(bounds.summary.max, Math.max(bounds.summary.min, available - author - 168));
	const resize = (column: keyof ColumnWidths, value: number, persist = false) => {
		// Freeze the automatic first-column width on the first drag, so resizing
		// the author column moves only its right boundary.
		const next = { summary, author, ...current.current, [column]: value };
		current.current = next;
		setWidths(next);
		if (persist) { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Resizing still works without storage. */ } }
	};
	return <div ref={container} className="commit-log-grid" style={{ "--commit-summary-width": `${summary}px`, "--commit-author-width": `${author}px` } as CSSProperties}>
		{children}
		<div className="commit-column-handle commit-summary-handle"><ResizeSeparator label="调整提交信息列宽" value={summary} bounds={bounds.summary} onResize={(value) => resize("summary", value)} onCommit={(value) => resize("summary", value, true)} /></div>
		<div className="commit-column-handle commit-author-handle"><ResizeSeparator label="调整作者列宽" value={author} bounds={bounds.author} onResize={(value) => resize("author", value)} onCommit={(value) => resize("author", value, true)} /></div>
	</div>;
}
