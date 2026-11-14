import { useState } from "react";
import type { GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { assetCanvasId, canvasLabel } from "../workbench/designCanvases";
import { designTaskStats, type DesignCollection } from "../workbench/designWorkspace";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { Icon, type IconName } from "./Icon";
import { Button } from "./ui";

/** Studio navigation. Canvases group works instead of mirroring Code projects,
 *  and the collection counts stay scoped to the canvas that is open. */
export function DesignSidebar({ studio, kind, collection, onCollection, onCreate, onOpenCanvas }: {
	studio: GenerationStudio; kind: GenerationKind; collection: DesignCollection; onCollection: (collection: DesignCollection) => void;
	onCreate: (kind: GenerationKind, reference?: boolean) => void;
	onOpenCanvas: (id: string) => void;
}) {
	const [naming, setNaming] = useState(false);
	const canvasId = studio.canvasId;
	const inCanvas = (asset: { canvasId?: string }) => assetCanvasId(asset, studio.canvases) === canvasId;
	const live = studio.assets.filter((asset) => !(asset.job?.removed ?? asset.removed));
	const assets = live.filter((asset) => asset.kind === kind && inCanvas(asset));
	const stats = designTaskStats(studio, kind, inCanvas);
	const counts = new Map<string, number>();
	for (const asset of live) { const id = assetCanvasId(asset, studio.canvases); counts.set(id, (counts.get(id) ?? 0) + 1); }
	const removedCount = studio.assets.filter((asset) => asset.kind === kind && inCanvas(asset) && (asset.job?.removed ?? asset.removed)).length;
	const groups: { id: DesignCollection; label: string; icon: IconName; count: number }[] = [
		{ id: "all", label: "全部作品", icon: "layers", count: assets.length },
		{ id: "tasks", label: "进行中", icon: "clock", count: stats.pending },
		{ id: "failures", label: "失败记录", icon: "alert", count: stats.failed },
		{ id: "removed", label: "已移除", icon: "archive", count: removedCount },
	];
	return <aside className="design-sidebar" aria-label="Design 导航">
		<header><span className="generation-eyebrow">DESIGN WORKSPACE</span><h1>Studio</h1><p>从灵感到成形的作品</p></header>
		<section className="design-quick-create" aria-label="快捷创作"><h2>创作</h2><Button variant="ghost" size="compact" onClick={() => onCreate("image")}><Icon name="imageSpark" />文生图</Button><Button variant="ghost" size="compact" onClick={() => onCreate("image", true)}><Icon name="image" />图生图</Button><Button variant="ghost" size="compact" onClick={() => onCreate("video")}><Icon name="video" />生成视频</Button></section>
		<nav className="design-canvases" aria-label="画布">
			<h2>画布</h2>
			<button type="button" className="design-canvas-row" aria-current={canvasId === "" ? "page" : undefined} onClick={() => onOpenCanvas("")}><Icon name="archive" size={15} /><span>未分组</span><small>{counts.get("") ?? 0}</small></button>
			{studio.canvases.map((canvas) => <button key={canvas.id} type="button" className="design-canvas-row" aria-current={canvasId === canvas.id ? "page" : undefined} onClick={() => onOpenCanvas(canvas.id)}><Icon name="layers" size={15} /><span title={canvas.name}>{canvas.name}</span><small>{counts.get(canvas.id) ?? 0}</small></button>)}
			<Button variant="ghost" size="compact" className="design-canvas-new" onClick={() => setNaming(true)}><Icon name="plus" size={14} />新建画布</Button>
		</nav>
		<nav className="design-canvases" aria-label="素材">
			<h2>素材</h2>
			<button type="button" className="design-canvas-row" aria-current={studio.assetView ? "page" : undefined} onClick={studio.openAssets}><Icon name="layers" size={15} /><span>资产库</span><small>{live.length}</small></button>
		</nav>
		<nav className="design-collections" aria-label="设计资产分组"><h2>当前画布<small>{canvasLabel(studio.canvases, canvasId)}</small></h2>{groups.filter((group) => kind === "image" || group.id !== "removed").map((group) => <button key={group.id} type="button" aria-current={collection === group.id ? "page" : undefined} onClick={() => onCollection(group.id)}><Icon name={group.icon} size={15} /><span>{group.label}</span><small>{group.count}</small></button>)}</nav>
		<div className="design-sidebar-footer"><div className="design-task-summary" aria-label="生成任务统计"><span>进行中 <strong>{stats.pending}</strong></span><span>成功 <strong>{stats.completed}</strong></span><span>失败 <strong>{stats.failed}</strong></span></div><small>画布只做分组，作品文件都保存在本机；删除画布会把作品放回未分组。</small></div>
		{naming && <CanvasNameDialog title="新建画布" confirmText="创建画布" onConfirm={(name) => onOpenCanvas(studio.createCanvas(name))} onClose={() => setNaming(false)} />}
	</aside>;
}
