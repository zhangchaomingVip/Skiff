import { isValidElement, memo, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { highlightCode } from "../chat/highlight";
import { CopyButton } from "./CopyButton";
import { ImagePreview } from "./ImagePreview";

function CodeBlock({ children, streaming }: { children?: ReactNode; streaming: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const [wrap, setWrap] = useState(false);
	const props = isValidElement<{ children?: string; className?: string }>(children) ? children.props : undefined;
	const code = String(props?.children ?? "").replace(/\n$/, "");
	const language = props?.className?.replace("language-", "") || "text";
	const long = code.split("\n").length > 20;
	// Highlight once the message settles; per-token highlighting would re-tokenize the whole block.
	const highlighted = useMemo(() => (streaming ? undefined : highlightCode(code, language)), [streaming, code, language]);
	return <div className="code-block">
		<div className="code-header"><span>{language}</span><div>
			<button aria-label="切换代码自动换行" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>换行</button>
			{long && <button aria-label={expanded ? "折叠代码" : "展开代码"} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "折叠" : "展开"}</button>}
			<CopyButton text={code} label="复制代码" />
		</div></div>
		<pre className={`${wrap ? "wrap" : ""} ${long && !expanded ? "collapsed" : ""}`}>{highlighted === undefined ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />}</pre>
		{long && !expanded && <button className="code-expand" onClick={() => setExpanded(true)} aria-label="展开完整代码">展开完整代码 · {code.split("\n").length} 行</button>}
	</div>;
}

const plugins = [remarkGfm, remarkBreaks];

export const Markdown = memo(function Markdown({ text, streaming = false, replyKey }: { text: string; streaming?: boolean; replyKey?: string }) {
	const components = useMemo<Components>(() => ({
		pre: ({ children }) => <CodeBlock streaming={streaming}>{children}</CodeBlock>,
		code: ({ children, className }) => <code className={className ?? "inline-code"}>{children}</code>,
		a: ({ children, href }) => {
			const isBareUrl = typeof href === "string" && String(children).trim() === href;
			const label = href?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? "来源";
			return <a className={isBareUrl ? "citation-chip" : undefined} href={href} title={href} target="_blank" rel="noreferrer">{isBareUrl ? `来源 · ${label}` : children}</a>;
		},
		img: ({ src, alt }) => src ? <ImagePreview src={src} alt={alt || "回复中的图片"} /> : null,
		td: ({ children }) => {
			const label = typeof children === "string" ? children : isValidElement<{ children?: ReactNode }>(children) ? children.props.children : undefined;
			return <td className={typeof label === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(label) ? "table-identifier" : undefined}>{children}</td>;
		},
		table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
	}), [streaming]);
	return <div data-reply-text={replyKey} className={`md${streaming ? " is-streaming" : ""}`}><ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown></div>;
});
