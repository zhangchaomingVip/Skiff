import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GenerationAsset, GenerationStudio } from "../workbench/useGenerationStudio";
import { assetCanvasId, ungroupedCanvasId, type DesignCanvas } from "../workbench/designCanvases";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, IconButton, Popover } from "./ui";

const visibleCount = 8;
const earlyName = "早期作品";

function ConversationMenu({ canvas, archiveReason, onRename, onArchive, onDelete }: {
	canvas: DesignCanvas;
	archiveReason?: string;
	onRename: () => void;
	onArchive: () => void;
	onDelete: () => void;
}) {
	const id = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (open) document.getElementById(id)?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
	}, [id, open]);
	const close = () => { setOpen(false); trigger.current?.focus(); };
	return <span className="design-canvas-row-actions">
		<IconButton ref={trigger} size="compact" variant="ghost" aria-label={`更多操作：${canvas.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? close() : setOpen(true)} onKeyDown={(event) => {
			if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
		}}><Icon name="more" size={16} /></IconButton>
		{open && createPortal(<Popover anchor={trigger} id={id} role="menu" aria-label={`对话操作：${canvas.name}`} className="generation-actions-menu" onClose={() => setOpen(false)} onKeyDown={(event) => {
			if (event.key === "Tab") { close(); return; }
			if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
			const index = items.indexOf(document.activeElement as HTMLButtonElement);
			const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
			items[next]?.focus();
		}}>
			<Button role="menuitem" tabIndex={-1} variant="ghost" onClick={() => { close(); onRename(); }}><Icon name="edit" size={14} />重命名</Button>
			<Button role="menuitem" tabIndex={-1} variant="ghost" aria-disabled={!!archiveReason || undefined} aria-describedby={archiveReason ? `${id}-reason` : undefined} onClick={() => { if (!archiveReason) { close(); onArchive(); } }}><Icon name="archive" size={14} />归档</Button>
			{archiveReason && <span className="design-archive-reason" id={`${id}-reason`}>{archiveReason}</span>}
			<Button role="menuitem" tabIndex={-1} variant="ghost" className="generation-menu-remove" onClick={() => { close(); onDelete(); }}><Icon name="trash" size={14} />删除</Button>
		</Popover>, trigger.current?.closest("dialog") ?? document.body)}
	</span>;
}

/** Studio navigation: a blank launcher, the library, then conversations newest first.
 *  Conversations are created by sending from the launcher, never by an empty "new" button. */
export function DesignSidebar({ studio, onOpenCanvas, onOpenArchives, onArchive }: { studio: GenerationStudio; onOpenCanvas: (id: string) => void; onOpenArchives: () => void; onArchive: (id: string) => boolean }) {
	const [renaming, setRenaming] = useState<DesignCanvas>();
	const [removing, setRemoving] = useState<DesignCanvas>();
	const [showAll, setShowAll] = useState(false);
	const archivesButton = useRef<HTMLButtonElement>(null);
	const canvasId = studio.canvasId;
	const counts = new Map<string, number>();
	const latest = new Map<string, number>();
	const covers = new Map<string, GenerationAsset>();
	for (const asset of studio.assets) {
		if (asset.job?.removed ?? asset.removed) continue;
		const id = assetCanvasId(asset, studio.canvases);
		counts.set(id, (counts.get(id) ?? 0) + 1);
		latest.set(id, Math.max(latest.get(id) ?? 0, asset.createdAt));
		const cover = covers.get(id);
		if (asset.kind === "image" && (!cover || asset.createdAt > cover.createdAt)) covers.set(id, asset);
	}
	const conversations = [...studio.activeCanvases].sort((before, after) => Math.max(after.updatedAt, latest.get(after.id) ?? 0) - Math.max(before.updatedAt, latest.get(before.id) ?? 0));
	// Keep the open conversation visible even when it would fall under "更多".
	const openIndex = conversations.findIndex((canvas) => canvas.id === canvasId);
	const shown = showAll || openIndex >= visibleCount ? conversations : conversations.slice(0, visibleCount);
	const early = counts.get(ungroupedCanvasId) ?? 0;
	const row = (id: string, name: string, extra?: ReactNode, system = false) => {
		const active = studio.view === "canvas" && canvasId === id;
		const cover = covers.get(id);
		return <div key={id || "early"} className={`design-canvas-row${system ? " design-canvas-row-system" : ""}`} data-active={active || undefined}>
			<button type="button" className="design-canvas-row-main" aria-current={active ? "page" : undefined} onClick={() => onOpenCanvas(id)}>
				<span className="design-conversation-thumb" aria-hidden="true">{cover ? <img src={cover.url} alt="" loading="lazy" decoding="async" /> : <Icon name={system ? "archive" : "message"} size={13} />}</span>
				<span title={name}>{name}</span>
			</button>
			{extra}
		</div>;
	};
	return <aside className="design-sidebar" aria-label="Design 导航">
		<header className="design-sidebar-title">
			<h1>Studio</h1>
		</header>
		<nav className="design-canvases" aria-label="创作">
			<div className="design-canvas-row" data-active={studio.view === "home" || undefined}><button type="button" className="design-canvas-row-main" aria-current={studio.view === "home" ? "page" : undefined} onClick={studio.openGallery}><Icon name="squarePen" size={15} /><span>新对话</span></button></div>
			<div className="design-canvas-row" data-active={studio.view === "assets" || undefined}><button type="button" className="design-canvas-row-main" aria-current={studio.view === "assets" ? "page" : undefined} onClick={studio.openAssets}><Icon name="grid" size={15} /><span title="按网格浏览、筛选和整理全部作品">资产库</span></button></div>
			<div className="design-canvas-row" data-active={studio.view === "archives" || undefined}><button ref={archivesButton} type="button" className="design-canvas-row-main" aria-current={studio.view === "archives" ? "page" : undefined} onClick={onOpenArchives}><Icon name="archive" size={15} /><span>已归档对话</span></button></div>
		</nav>
		<nav className="design-canvases" aria-label="对话">
			<div className="design-sidebar-heading"><h2>对话</h2></div>
			{shown.map((canvas) => row(canvas.id, canvas.name, <ConversationMenu canvas={canvas} archiveReason={studio.canvasArchiveReason(canvas.id)} onRename={() => setRenaming(canvas)} onArchive={() => { if (onArchive(canvas.id)) archivesButton.current?.focus(); }} onDelete={() => setRemoving(canvas)} />))}
			{conversations.length > shown.length && <button type="button" className="design-canvas-more" onClick={() => setShowAll(true)}>更多</button>}
			{showAll && conversations.length > visibleCount && <button type="button" className="design-canvas-more" onClick={() => setShowAll(false)}>收起</button>}
			{!conversations.length && !early && <p className="design-canvas-empty">在新对话里发送第一条描述，对话会出现在这里</p>}
			{early > 0 && row(ungroupedCanvasId, earlyName, undefined, true)}
		</nav>
		{renaming && <CanvasNameDialog title="重命名对话" initial={renaming.name} confirmText="保存名称" onConfirm={(name) => studio.renameCanvas(renaming.id, name)} onClose={() => setRenaming(undefined)} />}
		{removing && <ConfirmDialog title="删除对话" description={`“${removing.name}”会从列表里移除，里面的 ${counts.get(removing.id) ?? 0} 件作品会移到「${earlyName}」，原文件不受影响。`} confirmText="删除对话" onConfirm={() => studio.deleteCanvas(removing.id)} onClose={() => setRemoving(undefined)} />}
	</aside>;
}
