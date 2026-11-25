import { useState, type ReactNode } from "react";
import type { GenerationAsset, GenerationStudio } from "../workbench/useGenerationStudio";
import { assetCanvasId, ungroupedCanvasId, type DesignCanvas } from "../workbench/designCanvases";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { IconButton, Tooltip } from "./ui";

const visibleCount = 8;
const earlyName = "早期作品";

/** Studio navigation: a blank launcher, the library, then conversations newest first.
 *  Conversations are created by sending from the launcher, never by an empty "new" button. */
export function DesignSidebar({ studio, onOpenCanvas, onCollapse }: { studio: GenerationStudio; onOpenCanvas: (id: string) => void; onCollapse?: () => void }) {
	const [renaming, setRenaming] = useState<DesignCanvas>();
	const [removing, setRemoving] = useState<DesignCanvas>();
	const [showAll, setShowAll] = useState(false);
	const canvasId = studio.canvasId;
	const home = !studio.canvasView && !studio.assetView;
	const inConversation = studio.canvasView;
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
	const conversations = [...studio.canvases].sort((before, after) => Math.max(after.updatedAt, latest.get(after.id) ?? 0) - Math.max(before.updatedAt, latest.get(before.id) ?? 0));
	// Keep the open conversation visible even when it would fall under "更多".
	const openIndex = conversations.findIndex((canvas) => canvas.id === canvasId);
	const shown = showAll || openIndex >= visibleCount ? conversations : conversations.slice(0, visibleCount);
	const early = counts.get(ungroupedCanvasId) ?? 0;
	const row = (id: string, name: string, extra?: ReactNode, system = false) => {
		const active = inConversation && canvasId === id;
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
			{onCollapse && <Tooltip text="收起导航"><IconButton className="design-sidebar-collapse" size="compact" variant="ghost" aria-label="收起导航" onClick={onCollapse}><Icon name="panel" size={16} /></IconButton></Tooltip>}
		</header>
		<nav className="design-canvases" aria-label="创作">
			<div className="design-canvas-row" data-active={home || undefined}><button type="button" className="design-canvas-row-main" aria-current={home ? "page" : undefined} onClick={studio.openGallery}><Icon name="squarePen" size={15} /><span>新对话</span></button></div>
			<div className="design-canvas-row" data-active={studio.assetView || undefined}><button type="button" className="design-canvas-row-main" aria-current={studio.assetView ? "page" : undefined} onClick={studio.openAssets}><Icon name="grid" size={15} /><span title="按网格浏览、筛选和整理全部作品">资产库</span></button></div>
		</nav>
		<nav className="design-canvases" aria-label="对话">
			<div className="design-sidebar-heading"><h2>对话</h2></div>
			{shown.map((canvas) => row(canvas.id, canvas.name, <span className="design-canvas-row-actions">
				<Tooltip text="重命名"><IconButton size="compact" variant="ghost" aria-label={`重命名对话：${canvas.name}`} onClick={() => setRenaming(canvas)}><Icon name="edit" size={14} /></IconButton></Tooltip>
				<Tooltip text="删除对话"><IconButton size="compact" variant="ghost" aria-label={`删除对话：${canvas.name}`} onClick={() => setRemoving(canvas)}><Icon name="close" size={14} /></IconButton></Tooltip>
			</span>))}
			{conversations.length > shown.length && <button type="button" className="design-canvas-more" onClick={() => setShowAll(true)}>更多</button>}
			{showAll && conversations.length > visibleCount && <button type="button" className="design-canvas-more" onClick={() => setShowAll(false)}>收起</button>}
			{!conversations.length && !early && <p className="design-canvas-empty">在新对话里发送第一条描述，对话会出现在这里</p>}
			{early > 0 && row(ungroupedCanvasId, earlyName, undefined, true)}
		</nav>
		{renaming && <CanvasNameDialog title="重命名对话" initial={renaming.name} confirmText="保存名称" onConfirm={(name) => studio.renameCanvas(renaming.id, name)} onClose={() => setRenaming(undefined)} />}
		{removing && <ConfirmDialog title="删除对话" description={`“${removing.name}”会从列表里移除，里面的 ${counts.get(removing.id) ?? 0} 件作品会移到「${earlyName}」，原文件不受影响。`} confirmText="删除对话" onConfirm={() => { studio.deleteCanvas(removing.id); if (canvasId === removing.id) studio.openGallery(); }} onClose={() => setRemoving(undefined)} />}
	</aside>;
}
