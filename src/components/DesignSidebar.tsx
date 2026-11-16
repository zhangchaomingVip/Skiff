import { useState } from "react";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import { assetCanvasId } from "../workbench/designCanvases";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { Icon } from "./Icon";
import { IconButton, Tooltip } from "./ui";

/** Studio navigation owns the workspace, not the creation mode: canvases scope
 *  the works and the gallery keeps the single status filter next to the works.
 *  Text-to-image, image-to-image and the reference slot all live in the composer. */
export function DesignSidebar({ studio, onOpenCanvas }: { studio: GenerationStudio; onOpenCanvas: (id: string) => void }) {
	const [naming, setNaming] = useState(false);
	const canvasId = studio.canvasId;
	// Highlight belongs to the visible route: the launcher owns "首页" even when
	// the draft already targets a canvas, and a canvas row only lights up in the
	// canvas scene. Otherwise two rows claim the same page.
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
		<header><span className="generation-eyebrow">DESIGN WORKSPACE</span><h1>Studio</h1><p>首页汇总作品，画布负责分组</p></header>
		<nav className="design-canvases" aria-label="创作">
			<button type="button" className="design-canvas-row" aria-current={home ? "page" : undefined} onClick={studio.openGallery}><Icon name="spark" size={15} /><span>首页</span><small>{live}</small></button>
		</nav>
		<nav className="design-canvases" aria-label="画布">
			<div className="design-sidebar-heading"><h2>画布</h2><Tooltip text="新建画布"><IconButton size="compact" variant="ghost" aria-label="新建画布" onClick={() => setNaming(true)}><Icon name="plus" size={14} /></IconButton></Tooltip></div>
			<button type="button" className="design-canvas-row" aria-current={canvasScene && canvasId === "" ? "page" : undefined} onClick={() => onOpenCanvas("")}><Icon name="archive" size={15} /><span>未分组</span><small>{counts.get("") ?? 0}</small></button>
			{studio.canvases.map((canvas) => <button key={canvas.id} type="button" className="design-canvas-row" aria-current={canvasScene && canvasId === canvas.id ? "page" : undefined} onClick={() => onOpenCanvas(canvas.id)}><Icon name="layers" size={15} /><span title={canvas.name}>{canvas.name}</span><small>{counts.get(canvas.id) ?? 0}</small></button>)}
		</nav>
		<nav className="design-canvases" aria-label="素材">
			<div className="design-sidebar-heading"><h2>素材</h2></div>
			<button type="button" className="design-canvas-row" aria-current={studio.assetView ? "page" : undefined} onClick={studio.openAssets}><Icon name="layers" size={15} /><span>资产库</span><small>{live}</small></button>
		</nav>
		{naming && <CanvasNameDialog title="新建画布" confirmText="创建画布" onConfirm={(name) => onOpenCanvas(studio.createCanvas(name))} onClose={() => setNaming(false)} />}
	</aside>;
}
