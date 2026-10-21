import { useMemo, useState } from "react";
import type { SearchDetails } from "../chat/toolDetails";
import { CopyButton } from "./CopyButton";

function SiteIcon({ url, source }: { url: string; source: string }) {
	const [failed, setFailed] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const icon = useMemo(() => new URL("/favicon.ico", url).href, [url]);
	return <span className="tool-search-site-icon" aria-hidden="true"><span>{source.replace(/^www\./, "").charAt(0).toUpperCase()}</span>{!failed && <img src={icon} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className={loaded ? "is-loaded" : undefined} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}</span>;
}

export function ToolSearchResults({ text, details }: { text: string; details: SearchDetails }) {
	return <div className="tool-search-results">
		{details.results.length > 0 && <ol className="tool-search-list">{details.results.map((hit, i) => <li key={`${i}:${hit.url}`}>
			<a className="tool-search-link" href={hit.url} target="_blank" rel="noreferrer"><SiteIcon url={hit.url} source={hit.source} /><span className="tool-search-title">{hit.title}</span><span className="tool-search-source">{hit.source}</span></a>
		</li>)}</ol>}
		{details.results.length === 0 && details.intro && <p className="tool-search-empty">{details.intro}</p>}
		<div className="tool-search-actions">
			<CopyButton text={text} label="复制搜索结果" />
		</div>
		{!text.trim() && <p className="muted">没有找到相关结果。</p>}
	</div>;
}
