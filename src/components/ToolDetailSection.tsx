import { useState, type ReactNode } from "react";
import { Button } from "./ui";
import { CopyButton } from "./CopyButton";

/** Card sections stay visible; only long content is shortened, always with a useful preview. */
export function ToolDetailSection({ title, copy, children }: { title: string; copy?: { text: string; label: string }; children: ReactNode }) {
	return <section className="tool-detail-section" aria-label={title}>
		<div className="tool-detail-heading"><span>{title}</span>{copy && <CopyButton {...copy} />}</div>
		{children}
	</section>;
}

export function ToolDetailText({ text, diff = false, tail = false }: { text: string; diff?: boolean; tail?: boolean }) {
	const [full, setFull] = useState(false);
	const lines = text.split("\n");
	const shown = full ? lines : tail ? lines.slice(-12) : lines.slice(0, 12);
	return <>
		{diff ? <pre className="tool-diff">{shown.map((line, i) => <div key={i} className={/^\s*\+/.test(line) ? "diff-add" : /^\s*-/.test(line) ? "diff-remove" : ""}>{line || " "}</div>)}</pre> : <pre className="tool-output">{shown.join("\n") || "无内容"}</pre>}
		{lines.length > 12 && <Button size="compact" className="tool-detail-more" aria-expanded={full} onClick={() => setFull(!full)}>{full ? "收起长内容" : `显示全部 ${lines.length} 行${tail ? "（当前为末尾）" : ""}`}</Button>}
	</>;
}
