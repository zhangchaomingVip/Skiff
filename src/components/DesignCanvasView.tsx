import { useState, type ReactNode } from "react";
import { assetCanvasId, canvasLabel, type DesignCanvas } from "../workbench/designCanvases";
import type { GenerationAsset, GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { MediaView } from "./GenerationWorkspace";
import { Icon } from "./Icon";
import { MoveAssetDialog } from "./MoveAssetDialog";
import { Button, Chip, Dialog, IconButton, SegmentedControl, Tooltip } from "./ui";

type BoardFilter = "all" | GenerationKind;

const assetTitle = (asset: GenerationAsset) => asset.prompt?.trim().replace(/\s+/g, " ") || asset.name;

/** Shared mixed-media board: canvases and the asset library only differ in the
 *  header and whether a work shows its canvas. It stays a gallery, never a
 *  freeform board with panning or zooming. */
function AssetBoard({ eyebrow, title, ariaLabel, description, note, emptyTitle, emptyText, assets, actions, onCreate, createLabel, showCanvas, studio, onImageToImage, onImageToVideo }: {
	eyebrow: string;
	title: string;
	ariaLabel: string;
	description: string;
	note: string;
	emptyTitle: string;
	emptyText: string;
	assets: GenerationAsset[];
	actions?: ReactNode;
	onCreate: () => void;
	createLabel: string;
	showCanvas?: boolean;
	studio: GenerationStudio;
	onImageToImage: (asset: GenerationAsset) => void;
	onImageToVideo: (asset: GenerationAsset) => void;
}) {
	const [filter, setFilter] = useState<BoardFilter>("all");
	const [selected, setSelected] = useState<GenerationAsset>();
	const [moving, setMoving] = useState<GenerationAsset>();
	const images = assets.filter((asset) => asset.kind === "image").length;
	const videos = assets.length - images;
	const sorted = [...assets].sort((before, after) => after.createdAt - before.createdAt).filter((asset) => filter === "all" || asset.kind === filter);
	return <section className="generation-gallery design-canvas" data-columns="3" aria-label={ariaLabel}>
		<div className="generation-gallery-scroll">
			<div className="generation-gallery-heading">
				<div>
					<span className="generation-eyebrow">{eyebrow}</span>
					<h2>{title}<span>{assets.length.toString().padStart(2, "0")}</span></h2>
					<p>{description}</p>
				</div>
				<div className="generation-gallery-heading-actions">
					<SegmentedControl label="画布筛选" value={filter} onChange={setFilter} options={[{ value: "all", label: `全部 ${assets.length}` }, { value: "image", label: `图片 ${images}` }, { value: "video", label: `视频 ${videos}` }]} />
					<Button size="compact" onClick={onCreate}><Icon name="spark" size={14} />{createLabel}</Button>
					{actions}
				</div>
			</div>
			<p className="design-canvas-note">{note}</p>
			{sorted.length > 0 ? <div className="generation-gallery-grid">
				{sorted.map((asset) => <article className="generation-card" key={asset.id} data-kind={asset.kind}>
					<div className="generation-card-media">
						<button type="button" className="generation-card-preview" aria-label={`预览作品：${asset.name}`} onClick={() => setSelected(asset)}><MediaView asset={asset} /></button>
					</div>
					<div className="generation-card-caption"><strong title={asset.prompt ?? asset.name}>{assetTitle(asset)}</strong><Chip>{asset.kind === "image" ? "图片" : "视频"}</Chip></div>
					{asset.job && <div className="generation-asset-info"><span title={asset.job.modelId}>{asset.job.modelId}</span><span>{(asset.job.actualSize ?? asset.job.size).replace("x", " × ")}</span></div>}
					{asset.videoJob && <div className="generation-asset-info"><span title={asset.videoJob.modelId}>{asset.videoJob.modelId}</span><span>{asset.videoJob.duration} 秒</span></div>}
					{showCanvas && <div className="generation-asset-info"><span>{canvasLabel(studio.canvases, assetCanvasId(asset, studio.canvases))}</span><span>{asset.imported ? "导入" : "生成"}</span></div>}
				</article>)}
			</div> : <div className="generation-empty">
				<Icon name={filter === "video" ? "video" : "image"} size={28} />
				<h2>{filter === "all" ? emptyTitle : filter === "image" ? "还没有图片" : "还没有视频"}</h2>
				<p>{emptyText}</p>
				<Button variant="ghost" size="compact" onClick={onCreate}><Icon name="spark" size={14} />去创作</Button>
			</div>}
		</div>
		{selected && <Dialog className="generation-preview-dialog" aria-label="作品预览" returnFocusSelector=".design-canvas .generation-card-preview" onClose={() => setSelected(undefined)}>
			<header><div><strong>{assetTitle(selected)}</strong><small>{selected.name}</small></div><IconButton size="compact" variant="ghost" aria-label="关闭作品预览" onClick={() => setSelected(undefined)}><Icon name="close" /></IconButton></header>
			<div className="generation-preview-media"><MediaView key={selected.id} asset={selected} playing /></div>
			<div className="generation-preview-info">
				{selected.prompt && <p>{selected.prompt}</p>}
				{selected.job && <small>{selected.job.serviceName} · {selected.job.modelId} · {(selected.job.actualSize ?? selected.job.size).replace("x", " × ")} · {new Date(selected.createdAt).toLocaleString()}</small>}
				{selected.videoJob && <small>{selected.videoJob.serviceName} · {selected.videoJob.modelId} · {selected.videoJob.duration} 秒 · {new Date(selected.createdAt).toLocaleString()}</small>}
				<small>画布：{canvasLabel(studio.canvases, assetCanvasId(selected, studio.canvases))}</small>
			</div>
			<footer>
				{selected.kind === "image" && <><Button size="compact" onClick={() => { setSelected(undefined); onImageToImage(selected); }}><Icon name="imageSpark" />用作参考图</Button>
					<Button size="compact" onClick={() => { setSelected(undefined); onImageToVideo(selected); }}><Icon name="video" />用作首帧</Button></>}
				<Button size="compact" variant="ghost" onClick={() => { setMoving(selected); setSelected(undefined); }}><Icon name="layers" size={14} />移到画布…</Button>
			</footer>
		</Dialog>}
		{moving && <MoveAssetDialog asset={moving} canvases={studio.canvases} onMove={(target) => { void studio.moveAsset(moving, target); setSelected(undefined); }} onClose={() => setMoving(undefined)} />}
	</section>;
}

export function DesignCanvasView({ studio, canvas, assets, onCreate, onImageToImage, onImageToVideo }: {
	studio: GenerationStudio;
	canvas?: DesignCanvas;
	assets: GenerationAsset[];
	onCreate: () => void;
	onImageToImage: (asset: GenerationAsset) => void;
	onImageToVideo: (asset: GenerationAsset) => void;
}) {
	const [renaming, setRenaming] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const images = assets.filter((asset) => asset.kind === "image").length;
	const name = canvas?.name ?? "未分组";
	return <>
		<AssetBoard
			ariaLabel="画布"
			eyebrow={canvas ? "CANVAS" : "UNGROUPED"}
			title={name}
			description={`${images} 张图片 · ${assets.length - images} 段视频${canvas ? "" : " · 尚未归入任何画布"}`}
			note={canvas ? "画布只做分组：删除画布不会删除作品，它们会回到未分组。" : "这些作品还没有画布。选一个画布作为提交目标，或在这里新建。"}
			emptyTitle="这个画布还没有作品"
			emptyText={canvas ? "在这个画布下生成的作品会自动收进来。\n也可以切换画布查看其他作品。" : "选择一个画布作为提交目标，新作品就会归入其中。"}
			assets={assets}
			onCreate={onCreate}
			createLabel="在此画布创作"
			studio={studio}
			onImageToImage={onImageToImage}
			onImageToVideo={onImageToVideo}
			actions={canvas && <>
				<Tooltip text="重命名画布"><IconButton size="compact" variant="ghost" aria-label="重命名画布" onClick={() => setRenaming(true)}><Icon name="edit" size={15} /></IconButton></Tooltip>
				<Tooltip text="删除画布"><IconButton size="compact" variant="ghost" aria-label="删除画布" onClick={() => setConfirming(true)}><Icon name="close" size={15} /></IconButton></Tooltip>
			</>}
		/>
		{renaming && canvas && <CanvasNameDialog title="重命名画布" initial={canvas.name} confirmText="保存名称" onConfirm={(next) => studio.renameCanvas(canvas.id, next)} onClose={() => setRenaming(false)} />}
		{confirming && canvas && <ConfirmDialog title="删除画布" description={`“${canvas.name}”只会被删除分组，里面的 ${assets.length} 件作品会回到未分组，原文件不受影响。`} confirmText="删除画布" onConfirm={() => { studio.deleteCanvas(canvas.id); studio.openGallery(); }} onClose={() => setConfirming(false)} />}
	</>;
}

/** Cross-canvas reuse: every generated or imported work in one place. */
export function DesignAssetLibrary({ studio, assets, onCreate, onImageToImage, onImageToVideo }: {
	studio: GenerationStudio;
	assets: GenerationAsset[];
	onCreate: () => void;
	onImageToImage: (asset: GenerationAsset) => void;
	onImageToVideo: (asset: GenerationAsset) => void;
}) {
	const imported = assets.filter((asset) => asset.imported).length;
	return <AssetBoard
		ariaLabel="资产库"
		eyebrow="ASSETS"
		title="资产库"
		description={`${assets.length} 件素材 · 导入 ${imported} 件 · 跨画布共用`}
		note="所有生成与导入的作品都在这里，可用作参考图、首帧，或移动到任意画布。"
		emptyTitle="还没有素材"
		emptyText="生成或导入作品后，会在这里集中展示，方便跨画布复用。"
		assets={assets}
		onCreate={onCreate}
		createLabel="去创作"
		showCanvas
		studio={studio}
		onImageToImage={onImageToImage}
		onImageToVideo={onImageToVideo}
	/>;
}
