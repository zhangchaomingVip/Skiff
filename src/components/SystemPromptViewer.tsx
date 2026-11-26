import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { assembleSystemPrompt, describePromptSections, measurePrompt, type SystemPromptSnapshot } from "../chat/systemPrompt";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { Button, Dialog, ListRow, SegmentedControl } from "./ui";

type PromptSection = ReturnType<typeof describePromptSections>[number];
type SectionSort = "size" | "order";
const sortOptions: { value: SectionSort; label: string }[] = [
	{ value: "size", label: "按大小" },
	{ value: "order", label: "按顺序" },
];
const integer = new Intl.NumberFormat("zh-CN");
const decimal = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatShare = (share: number) => share > 0 && share < 0.001 ? "<0.1%" : percent.format(share);
const formatSize = ({ characters, tokens }: ReturnType<typeof measurePrompt>) =>
	`${integer.format(characters)} 字 · 约 ${tokens >= 1000 ? `${decimal.format(tokens / 1000)}K` : integer.format(tokens)} token`;

function PromptShareBar({ sections, active, onHover, onFocus, onOpen }: {
	sections: PromptSection[];
	active: string | undefined;
	onHover: (name: string | undefined) => void;
	onFocus: (name: string | undefined) => void;
	onOpen: (name: string) => void;
}) {
	return <div className="prompt-share-bar" role="group" aria-label="系统提示词分段比例">
		{sections.filter(({ characters }) => characters > 0).map((section) => {
			const name = section.label === section.name ? section.name : `${section.label} (${section.name})`;
			const title = `${name} · ${integer.format(section.characters)} 字 · ${formatShare(section.share)}`;
			return <button key={section.name} type="button" className="prompt-share-segment" data-section={section.name} data-tone={section.tone}
				data-dimmed={active !== undefined && active !== section.name || undefined} style={{ flexGrow: section.characters }}
				title={title} aria-label={title} aria-haspopup="dialog"
				onMouseEnter={() => onHover(section.name)} onMouseLeave={() => onHover(undefined)}
				onFocus={() => onFocus(section.name)} onBlur={() => onFocus(undefined)} onClick={() => onOpen(section.name)} />;
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
	const [sort, setSort] = useState<SectionSort>("size");
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
	const shown = sort === "size" ? ranked : sections;
	const maxCharacters = ranked[0]?.characters ?? 0;
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
				<Button variant="ghost" size="compact" loading={loading} disabled={!sessionPath} onClick={reload}>
					{loading ? "正在读取…" : <><Icon name="refresh" size={16} />重新读取</>}
				</Button>
				<Button className="prompt-open-reader" size="compact" variant="secondary" aria-haspopup="dialog" disabled={!canRead} onClick={() => setReader(null)}><Icon name="eye" size={16} />查看完整指令</Button>
			</div>
		</div>
		{error && <p className="form-error" role="alert">{error}</p>}
		{!error && !sections.length && <p className="prompt-state" role="status">{message}</p>}
		{shown.length > 0 && <>
			<div className="prompt-breakdown-toolbar">
				{maxCharacters > 0 && <PromptShareBar sections={shown} active={active} onHover={setHovered} onFocus={setFocused} onOpen={setReader} />}
				<SegmentedControl label="段落排序" value={sort} options={sortOptions} onChange={setSort} />
			</div>
			<ul className="prompt-breakdown" aria-label="系统提示词段落明细" data-sort={sort}>
				{shown.map((section, index) => <li key={section.name}>
					<ListRow className="prompt-breakdown-row" data-section={section.name} data-tone={section.tone}
						data-highlighted={active === section.name || undefined} aria-haspopup="dialog"
						onMouseEnter={() => setHovered(section.name)} onMouseLeave={() => setHovered(undefined)}
						onFocus={() => setFocused(section.name)} onBlur={() => setFocused(undefined)} onClick={() => setReader(section.name)}>
						{sort === "order" && <span className="prompt-breakdown-number">{index + 1}.</span>}
						<span className="prompt-dot" aria-hidden="true" />
						<span className="prompt-breakdown-name" title={section.label}>{section.label}</span>
						<code className="prompt-breakdown-key" title={section.label === section.name ? undefined : section.name}>{section.label === section.name ? "" : section.name}</code>
						<span className="prompt-share-track" aria-hidden="true">
							{section.characters > 0 && <span style={{ width: `${section.characters / maxCharacters * 100}%` }} />}
						</span>
						<span>{formatShare(section.share)}</span>
						<span>{integer.format(section.characters)} 字</span>
					</ListRow>
				</li>)}
			</ul>
		</>}
		{reader !== undefined && canRead && <PromptReader initialSection={reader} sections={sections} fullText={fullText} onClose={() => setReader(undefined)} />}
	</section>;
}
