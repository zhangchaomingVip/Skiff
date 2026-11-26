import { useEffect, useId, useRef, useState } from "react";
import { isArchivedDesignCanvas } from "../workbench/designCanvases";
import type { GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { GenerationThread } from "./GenerationWorkspace";
import { Icon } from "./Icon";
import { Button, Input, ListRow } from "./ui";

const formatArchiveTime = (timestamp: number) => new Date(timestamp).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function DesignArchives({ active, kind, studio, onRestore }: { active: boolean; kind: GenerationKind; studio: GenerationStudio; onRestore: (id: string) => void }) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string>();
	const headingId = useId();
	const heading = useRef<HTMLHeadingElement>(null);
	const search = useRef<HTMLInputElement>(null);
	const archived = studio.canvases.filter(isArchivedDesignCanvas);
	const canvas = archived.find((item) => item.id === selected);
	const previewId = canvas?.id;
	useEffect(() => {
		if (!active) return;
		const frame = requestAnimationFrame(() => (previewId ? heading.current : search.current)?.focus());
		return () => cancelAnimationFrame(frame);
	}, [active, previewId]);
	if (canvas) return <section className="design-stage design-archive-preview" aria-labelledby={headingId}>
		<header className="design-archive-header">
			<Button size="compact" variant="ghost" aria-label="返回已归档对话" title="返回已归档对话" onClick={() => setSelected(undefined)}><Icon name="arrowLeft" size={16} /></Button>
			<h1 id={headingId} ref={heading} tabIndex={-1}>{canvas.name}</h1>
			<Button size="compact" onClick={() => onRestore(canvas.id)}><Icon name="refresh" size={14} />恢复对话</Button>
		</header>
		<GenerationThread key={canvas.id} studio={studio} kind={kind} canvasId={canvas.id} active={active} />
	</section>;
	const text = query.trim().toLocaleLowerCase();
	const matches = archived.filter((item) => item.name.toLocaleLowerCase().includes(text)).sort((before, after) => after.archivedAt - before.archivedAt);
	return <section className="design-archives" aria-labelledby={headingId}>
		<h1 id={headingId}>已归档对话</h1>
		<Input ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索已归档对话" placeholder="搜索对话标题" />
		{matches.length ? <ul className="design-archive-list">
			{matches.map((item) => <li key={item.id}><ListRow className="design-archive-row" onClick={() => setSelected(item.id)}>
				<Icon name="message" size={15} />
				<span>{item.name}</span>
				<time dateTime={new Date(item.archivedAt).toISOString()}>{formatArchiveTime(item.archivedAt)}</time>
				<Icon name="chevron" size={13} />
			</ListRow></li>)}
		</ul> : <p className="design-archive-empty" role="status">{text ? "没有匹配的已归档对话" : "没有已归档对话"}</p>}
	</section>;
}
