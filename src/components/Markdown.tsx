import { Children, isValidElement, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { PluggableList } from "unified";
import { highlightCode } from "../chat/highlight";
import { remarkLooseStrong } from "../chat/remarkLooseStrong";
import { hostOf, remarkSources } from "../chat/remarkSources";
import { CopyButton } from "./CopyButton";
import { ImagePreview } from "./ImagePreview";
import { Icon } from "./Icon";

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

const SOURCES_COLLAPSE_AT = 8;
const SOURCES_PREVIEW = 5;

/** Sources live under the reply they belong to, so the text being cited stays in view. */
function SourcesList({ prefix, children }: { prefix: string; children?: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const cards = Children.toArray(children);
	const listId = `${prefix}-sources`;
	const collapsible = cards.length > SOURCES_COLLAPSE_AT;
	const visible = collapsible && !showAll ? cards.slice(0, SOURCES_PREVIEW) : cards;
	const domains = [...new Set(cards.map((card) => isValidElement<{ href?: string }>(card) && typeof card.props.href === "string" ? siteOf(card.props.href) : "").filter(Boolean))];
	const preview = domains.slice(0, 2).join("、");
	const summary = !preview ? `${cards.length} 个网页` : cards.length > 2 || domains.length > 2 ? `${preview} 等 ${cards.length} 个网页` : `${preview} · ${cards.length} 个网页`;
	return <div className="sources-bento">
		<button type="button" className="sources-pill" aria-expanded={open} aria-controls={listId} aria-label={`${open ? "收起" : "查看"}参考来源，共 ${cards.length} 个网页`} title={domains.join("\n")} onClick={() => setOpen(!open)}>
			<Icon name="globe" size={14} /><span className="sources-pill-label">{summary}</span><span className="sources-pill-chevron" aria-hidden="true"><Icon name="chevron" size={12} /></span>
		</button>
		{open && <div id={listId} className="sources-list" aria-label={`参考来源，共 ${cards.length} 个网页`}>
			{visible}
			{collapsible && <button type="button" className="sources-more" onClick={() => setShowAll(!showAll)}>{showAll ? "收起" : `展开全部 ${cards.length} 个`}</button>}
		</div>}
	</div>;
}

type CitationInfo = { index: string; url: string; title: string; host: string };
type PopoverPlacement = { left: number; top: number; above: boolean };
const POPOVER_WIDTH = 320;

/** A citation previews its source in place: no panel covering the reply. */
function CitationBadge({ index, url, title, host }: CitationInfo) {
	const anchor = useRef<HTMLAnchorElement>(null);
	const popover = useRef<HTMLDivElement>(null);
	const timer = useRef<number | undefined>(undefined);
	const [hovered, setHovered] = useState(false);
	const [pinned, setPinned] = useState(false);
	const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
	const popoverId = `citation-${useId().replace(/:/g, "")}`;
	const open = hovered || pinned;
	const hover = (next: boolean, delay: number) => {
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setHovered(next), delay);
	};
	const close = () => { window.clearTimeout(timer.current); setHovered(false); setPinned(false); };
	useEffect(() => () => window.clearTimeout(timer.current), []);
	useLayoutEffect(() => {
		if (!open) { setPlacement(null); return; }
		const place = () => {
			const rect = anchor.current?.getBoundingClientRect();
			if (!rect) return;
			const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
			const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
			const above = rect.bottom + 180 > window.innerHeight && rect.top > 180;
			setPlacement({ left, top: above ? rect.top - 6 : rect.bottom + 6, above });
		};
		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [open]);
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
			close();
			anchor.current?.focus();
		};
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || anchor.current?.contains(event.target) || popover.current?.contains(event.target)) return;
			close();
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [open]);
	const label = title || host || url;
	return <>
		<a ref={anchor} className="citation-badge" href={url} aria-label={`来源 ${index}：${label}`} aria-describedby={open ? popoverId : undefined} aria-expanded={pinned}
			onMouseEnter={() => hover(true, 120)} onMouseLeave={() => hover(false, 160)}
			onFocus={() => hover(true, 0)} onBlur={() => hover(false, 160)}
			onClick={(event) => { event.preventDefault(); if (pinned) close(); else setPinned(true); }}>{index}</a>
		{open && placement && createPortal(<div ref={popover} id={popoverId} role="group" aria-label={`来源 ${index}`} className={`citation-popover${placement.above ? " is-above" : ""}`} style={{ left: placement.left, top: placement.top }}
			onMouseEnter={() => hover(true, 0)} onMouseLeave={() => hover(false, 160)} onFocus={() => hover(true, 0)} onBlur={() => hover(false, 160)}>
			<div className="citation-popover-title"><span className="citation-popover-index">{index}</span><strong>{label}</strong></div>
			<span className="citation-popover-url">{url}</span>
			<button type="button" className="citation-popover-open" onClick={() => { openLink(url); close(); }}><Icon name="link" size={13} /><span>在浏览器打开</span></button>
		</div>, document.body)}
	</>;
}

/** Site-level name for the pill: cheatsheetseries.owasp.org and wstg.owasp.org both read as owasp.org. */
const siteOf = (url: string) => {
	const labels = hostOf(url).split(".");
	if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1])) return labels.join(".");
	// Two-level public suffixes such as com.cn / co.uk keep one more label.
	const keep = /^(com|net|org|gov|edu|co|ac)$/.test(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? 3 : 2;
	return labels.slice(-keep).join(".");
};

/** The last path segment tells same-host sources apart when no title was found. */
function sourceSummary(url: string) {
	try {
		const segments = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean);
		const last = segments[segments.length - 1]?.replace(/\.(html?|php|aspx?)$/i, "");
		return last ? (last.length > 48 ? `${last.slice(0, 47)}…` : last) : "";
	} catch {
		return "";
	}
}

/** Links leave the WebView: navigation would replace the app's own UI. */
const openLink = (url: string) => void invoke("open_url", { url }).catch((error) => console.error(String(error)));

export const Markdown = memo(function Markdown({ text, streaming = false, replyKey, variant }: { text: string; streaming?: boolean; replyKey?: string; variant?: "user" }) {
	const sourcePrefix = `md-${useId().replace(/:/g, "")}`;
	const plugins = useMemo<PluggableList>(() => [[remarkGfm, { singleTilde: false }], remarkLooseStrong, remarkBreaks, [remarkSources, { enabled: variant !== "user" }]], [variant]);
	const components = useMemo<Components>(() => ({
		pre: ({ children }) => <CodeBlock streaming={streaming}>{children}</CodeBlock>,
		code: ({ children, className }) => <code className={className ?? "inline-code"}>{children}</code>,
		a: ({ children, href, className, node }) => {
			const url = typeof href === "string" ? href : undefined;
			const properties = (node?.properties ?? {}) as Record<string, unknown>;
			if (className?.includes("citation-badge") && url) {
				return <CitationBadge index={String(children)} url={url} title={String(properties.dataTitle ?? "")} host={String(properties.dataHost ?? hostOf(url))} />;
			}
			if (className?.includes("source-card") && url) {
				const host = hostOf(url) || url;
				const title = String(properties.dataTitle ?? "");
				const meta = title ? host : sourceSummary(url);
				return <a className="source-card" href={url} title={url} onClick={(event) => { event.preventDefault(); openLink(url); }}>
					<span className="source-card-number">{children}</span>
					<span className="source-card-copy"><strong>{title || host}</strong>{meta && <small>{meta}</small>}</span>
					<span className="source-card-external" aria-hidden="true"><Icon name="link" size={13} /></span>
				</a>;
			}
			const bare = !!url && String(children).trim() === url;
			const open = (event: ReactMouseEvent<HTMLAnchorElement>) => {
				// Only web links leave the app; anchors and other schemes keep their default.
				if (!url || !/^https?:\/\//i.test(url)) return;
				event.preventDefault(); openLink(url);
			};
			// An address someone typed stays readable as an address, in their own words;
			// turning a user's own message into a "来源" citation of itself hides it.
			if (bare && variant === "user") return <a className="message-link" href={url} title={url} onClick={open}>{children}</a>;
			return <a className={bare ? "message-link" : undefined} href={url} title={url} onClick={open}>{children}</a>;
		},
		div: ({ children, className }) => className?.includes("sources-bento") ? <SourcesList prefix={sourcePrefix}>{children}</SourcesList> : <div className={className}>{children}</div>,
		img: ({ src, alt }) => src ? <ImagePreview src={src} alt={alt || "回复中的图片"} /> : null,
		td: ({ children }) => {
			const label = typeof children === "string" ? children : isValidElement<{ children?: ReactNode }>(children) ? children.props.children : undefined;
			return <td className={typeof label === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(label) ? "table-identifier" : undefined}>{children}</td>;
		},
		table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
	}), [sourcePrefix, streaming, variant]);
	return <div data-reply-text={replyKey} className={`md${streaming ? " is-streaming" : ""}`}><ReactMarkdown remarkPlugins={plugins} components={components}>{text}</ReactMarkdown></div>;
});
