import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { assembleSystemPrompt, describePromptSections, layoutPromptTreemap, measurePrompt, type SystemPromptSnapshot } from "../chat/systemPrompt";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { Button, Dialog, ListRow } from "./ui";

type PromptSection = ReturnType<typeof describePromptSections>[number];
const integer = new Intl.NumberFormat("zh-CN");
const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const formatShare = (share: number) => share > 0 && share < 0.001 ? "<0.1%" : percent.format(share);
const formatSize = ({ characters, tokens }: ReturnType<typeof measurePrompt>) =>
	`${integer.format(characters)} 字 · 约 ${tokens >= 1000 ? `${decimal.format(tokens / 1000)}K` : integer.format(tokens)} token`;

function PromptTreemap({ sections, active, onHover, onFocus, onOpen }: {
	sections: PromptSection[];
	active: string | undefined;
	onHover: (name: string | undefined) => void;
	onFocus: (name: string | undefined) => void;
	onOpen: (name: string) => void;
}) {
	const canvas = useRef<HTMLDivElement>(null);
	const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
	useEffect(() => {
		const observer = new ResizeObserver(([{ contentRect }]) => setSize({ width: contentRect.width, height: contentRect.height }));
		if (canvas.current) observer.observe(canvas.current);
		return () => observer.disconnect();
	}, []);
	const tiles = useMemo(() => layoutPromptTreemap(sections, width, height), [sections, width, height]);

	return <div ref={canvas} className="prompt-map" role="group" aria-label="系统提示词组成图">
		{tiles.map(({ section, rect }) => {
			const size = `${integer.format(section.characters)} 字 · ${formatShare(section.share)}`;
			const title = `${section.label}${section.label === section.name ? "" : ` (${section.name})`} · ${size}`;
			const label = rect.width >= (section.label.length > 4 ? 84 : 72) ? section.label : section.shortLabel;
			const style: CSSProperties = { left: rect.x / width * 100 + "%", top: rect.y / height * 100 + "%", width: rect.width / width * 100 + "%", height: rect.height / height * 100 + "%" };
			return <div key={section.name} className="prompt-map-cell" style={style}>
				<button type="button" className="prompt-map-tile" data-section={section.name} data-tone={section.tone}
					data-highlighted={active === section.name || undefined} title={title} aria-label={title} aria-haspopup="dialog"
					onMouseEnter={() => onHover(section.name)} onMouseLeave={() => onHover(undefined)}
					onFocus={() => onFocus(section.name)} onBlur={() => onFocus(undefined)} onClick={() => onOpen(section.name)}>
					{rect.width >= 46 && rect.height >= 27 && label && <strong>{label}</strong>}
					{rect.width >= 108 && rect.height >= 46 && <span>{size}</span>}
				</button>
			</div>;
		})}
	</div>;
}

function PromptReader({ initialSection, sections, fullText, onClose }: {
	initialSection: string | null;
	sections: PromptSection[];
	fullText: string;
	onClose: () => void;
}) {
	const [selected, setSelected] = useState(initialSection);
	const selectedFilter = useRef<HTMLButtonElement>(null);
	const current = sections.find((section) => section.name === selected);
	const text = current?.text ?? fullText;
	const stats = useMemo(() => measurePrompt(text), [text]);
	const copyLabel = current ? `复制${current.label}` : "复制完整提示词";

	return <Dialog variant="modal" className="prompt-reader" aria-labelledby="prompt-reader-title"
		initialFocus={selectedFilter} returnFocusSelector=".prompt-open-reader" onClose={onClose}>
		<header className="prompt-reader-heading">
			<h2 id="prompt-reader-title"><span className="prompt-dot" data-tone={current?.tone ?? "rules"} aria-hidden="true" />系统内置指令 · {current?.label ?? "完整提示词"}</h2>
			<div className="prompt-reader-tools">
				<span>{formatSize(stats)}</span>
				{text.length > 0 && <CopyButton key={selected ?? ""} text={text} label={copyLabel} />}
			</div>
		</header>
		<div className="prompt-reader-filters" role="group" aria-label="筛选提示词段落">
			<Button ref={current ? undefined : selectedFilter} size="compact" variant="ghost" aria-pressed={!current} onClick={() => setSelected(null)}>全部</Button>
			{sections.map((section) => <Button key={section.name} ref={current === section ? selectedFilter : undefined} size="compact" variant="ghost"
				aria-pressed={current === section} title={section.name} onClick={() => setSelected(section.name)}>
				<span className="prompt-dot" data-tone={section.tone} aria-hidden="true" /><span className="prompt-filter-label">{section.label}</span>
			</Button>)}
		</div>
		<pre key={selected ?? ""} className="prompt-reader-content" tabIndex={0} aria-label={current?.label ?? "完整系统提示词"}>{text || (current ? "该段落没有内容。" : "该快照没有提示词正文。")}</pre>
		<footer className="prompt-reader-footer">
			<span>来自当前对话的最新快照 · 只读</span>
			<Button variant="primary" size="compact" onClick={onClose}>关闭</Button>
		</footer>
	</Dialog>;
}

export function SystemPromptViewer({ sessionPath }: { sessionPath?: string }) {
	const [snapshot, setSnapshot] = useState<SystemPromptSnapshot>();
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(!!sessionPath);
	const [revision, setRevision] = useState(0);
	const [hovered, setHovered] = useState<string>();
	const [focused, setFocused] = useState<string>();
	const [reader, setReader] = useState<string | null>();
	useEffect(() => {
		if (!sessionPath) return;
		let cancelled = false;
		void invoke<SystemPromptSnapshot>("read_system_prompt", { sessionPath }).then((result) => {
			if (!cancelled) setSnapshot(result);
		}, (reason) => {
			if (cancelled) return;
			setSnapshot(undefined);
			setReader(undefined);
			setError(String(reason));
		}).finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, [sessionPath, revision]);
	const reload = () => {
		setLoading(true);
		setError(undefined);
		setRevision((value) => value + 1);
	};
	const sections = useMemo(() => describePromptSections(snapshot?.sections ?? []), [snapshot]);
	const ranked = useMemo(() => [...sections].sort((a, b) => b.characters - a.characters), [sections]);
	const fullText = useMemo(() => snapshot ? assembleSystemPrompt(snapshot) : "", [snapshot]);
	const stats = useMemo(() => measurePrompt(fullText), [fullText]);
	const active = hovered ?? focused;
	const canRead = !!fullText || sections.length > 0;
	const message = !sessionPath ? "当前对话还没有 pi 会话文件。"
		: loading ? "正在读取当前对话的系统提示词…"
		: canRead ? "当前快照仅包含完整提示词。"
		: "当前会话没有可显示的系统提示词段落。";

	return <section className="prompt-system family-card" aria-labelledby="prompt-system-title">
		<div className="prompt-card-heading">
			<div className="prompt-card-title">
				<h3 id="prompt-system-title"><Icon name="file" size={16} />系统内置指令</h3>
				{canRead && <span>共 {integer.format(sections.length)} 段 · {formatSize(stats)}</span>}
			</div>
			<div className="prompt-card-actions">
				<Button className="prompt-open-reader" size="compact" variant="primary" aria-haspopup="dialog" disabled={!canRead} onClick={() => setReader(null)}><Icon name="expand" size={16} />查看完整指令</Button>
				<Button variant="ghost" size="compact" loading={loading} disabled={!sessionPath} onClick={reload}>
					{loading ? "正在读取…" : <><Icon name="refresh" size={16} />重新读取</>}
				</Button>
			</div>
		</div>
		{error && <p className="form-error" role="alert">{error}</p>}
		{!error && !sections.length && <p className="prompt-state" role="status">{message}</p>}
		{ranked.some(({ characters }) => characters > 0) && <PromptTreemap sections={ranked} active={active} onHover={setHovered} onFocus={setFocused} onOpen={setReader} />}
		{ranked.length > 0 && <ul className="prompt-breakdown" aria-label="系统提示词段落明细">
			{ranked.map((section) => <li key={section.name}>
				<ListRow className="prompt-breakdown-row" data-section={section.name} data-tone={section.tone}
					data-highlighted={active === section.name || undefined} aria-haspopup="dialog"
					onMouseEnter={() => setHovered(section.name)} onMouseLeave={() => setHovered(undefined)}
					onFocus={() => setFocused(section.name)} onBlur={() => setFocused(undefined)} onClick={() => setReader(section.name)}>
					<span className="prompt-breakdown-label"><span className="prompt-dot" aria-hidden="true" /><span title={section.label}>{section.label}</span>{section.label !== section.name && <code title={section.name}>{section.name}</code>}</span>
					<span className="prompt-share-track" aria-hidden="true"><span style={{ width: `${section.share * 100}%` }} /></span>
					<span>{formatShare(section.share)}</span>
					<span>{integer.format(section.characters)} 字</span>
				</ListRow>
			</li>)}
		</ul>}
		{reader !== undefined && canRead && <PromptReader initialSection={reader} sections={sections} fullText={fullText} onClose={() => setReader(undefined)} />}
	</section>;
}
