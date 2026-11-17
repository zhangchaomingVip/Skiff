import { useState } from "react";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import { assetCanvasId, type DesignCanvas } from "../workbench/designCanvases";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { IconButton, Tooltip } from "./ui";

/** Studio navigation owns the workspace, not the creation mode: canvases scope
 *  the flow and the chat keeps the single creation surface at its foot. Text-to-
 *  image, image-to-image and the reference slot all live in the composer. */
export function DesignSidebar({ studio, onOpenCanvas, onCollapse }: { studio: GenerationStudio; onOpenCanvas: (id: string) => void; onCollapse?: () => void }) {
	const [naming, setNaming] = useState(false);
	const [renaming, setRenaming] = useState<DesignCanvas>();
	const [removing, setRemoving] = useState<DesignCanvas>();
	const canvasId = studio.canvasId;
	// Highlight belongs to the visible route: the launcher owns "首页" even when
	// the draft already targets a canvas, and a canvas row only lights up in the
	// canvas route. Otherwise two rows claim the same page.
	const home = !studio.canvasView && !studio.assetView;
	const canvasScene = studio.canvasView;
	const counts = new Map<string, number>();
	let live = 0;
	for (const asset of studio.assets) {
		if (asset.job?.removed ?? asset.removed) continue;
		const id = assetCanvasId(asset, studio.canvases);
		counts.set(id, (counts.get(id) ?? 0) + 1);
		live++;
	}
	return <aside className="design-sidebar" aria-label="Design 导航">
		<header>
			<span className="generation-eyebrow">DESIGN WORKSPACE</span>
			<div className="design-sidebar-title">
				<h1>Studio</h1>
				{onCollapse && <Tooltip text="收起导航"><IconButton className="design-sidebar-collapse" size="compact" variant="ghost" aria-label="收起导航" onClick={onCollapse}><Icon name="panel" size={16} /></IconButton></Tooltip>}
			</div>
			<p>首页汇总作品，画布负责分组</p>
		</header>
		<nav className="design-canvases" aria-label="创作">
			<div className="design-canvas-row" data-active={home || undefined}><button type="button" className="design-canvas-row-main" aria-current={home ? "page" : undefined} onClick={studio.openGallery}><Icon name="spark" size={15} /><span>首页</span><small>{live}</small></button></div>
		</nav>
		<nav className="design-canvases" aria-label="画布">
			<div className="design-sidebar-heading"><h2>画布</h2><Tooltip text="新建画布"><IconButton size="compact" variant="ghost" aria-label="新建画布" onClick={() => setNaming(true)}><Icon name="plus" size={14} /></IconButton></Tooltip></div>
			<div className="design-canvas-row" data-active={(canvasScene && canvasId === "") || undefined}><button type="button" className="design-canvas-row-main" aria-current={canvasScene && canvasId === "" ? "page" : undefined} onClick={() => onOpenCanvas("")}><Icon name="archive" size={15} /><span>未分组</span><small>{counts.get("") ?? 0}</small></button></div>
			{studio.canvases.map((canvas) => <div key={canvas.id} className="design-canvas-row" data-active={(canvasScene && canvasId === canvas.id) || undefined}>
				<button type="button" className="design-canvas-row-main" aria-current={canvasScene && canvasId === canvas.id ? "page" : undefined} onClick={() => onOpenCanvas(canvas.id)}><Icon name="layers" size={15} /><span title={canvas.name}>{canvas.name}</span><small>{counts.get(canvas.id) ?? 0}</small></button>
				<span className="design-canvas-row-actions">
					<Tooltip text="重命名画布"><IconButton size="compact" variant="ghost" aria-label={`重命名画布：${canvas.name}`} onClick={() => setRenaming(canvas)}><Icon name="edit" size={14} /></IconButton></Tooltip>
					<Tooltip text="删除画布"><IconButton size="compact" variant="ghost" aria-label={`删除画布：${canvas.name}`} onClick={() => setRemoving(canvas)}><Icon name="close" size={14} /></IconButton></Tooltip>
				</span>
			</div>)}
		</nav>
		<nav className="design-canvases" aria-label="素材">
			<div className="design-sidebar-heading"><h2>素材</h2></div>
			<div className="design-canvas-row" data-active={studio.assetView || undefined}><button type="button" className="design-canvas-row-main" aria-current={studio.assetView ? "page" : undefined} onClick={studio.openAssets}><Icon name="layers" size={15} /><span>资产库</span><small>{live}</small></button></div>
		</nav>
		{naming && <CanvasNameDialog title="新建画布" confirmText="创建画布" onConfirm={(name) => onOpenCanvas(studio.createCanvas(name))} onClose={() => setNaming(false)} />}
		{renaming && <CanvasNameDialog title="重命名画布" initial={renaming.name} confirmText="保存名称" onConfirm={(name) => studio.renameCanvas(renaming.id, name)} onClose={() => setRenaming(undefined)} />}
		{removing && <ConfirmDialog title="删除画布" description={`“${removing.name}”只会被删除分组，里面的 ${counts.get(removing.id) ?? 0} 件作品会回到未分组，原文件不受影响。`} confirmText="删除画布" onConfirm={() => { studio.deleteCanvas(removing.id); if (canvasId === removing.id) studio.openGallery(); }} onClose={() => setRemoving(undefined)} />}
	</aside>;
}
