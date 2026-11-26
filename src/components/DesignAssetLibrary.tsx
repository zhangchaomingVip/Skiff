import { useRef, useEffect, useState, type ReactNode } from "react";
import { assetCanvasId, canvasLabel } from "../workbench/designCanvases";
import type { GenerationAsset, GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { MediaView } from "./GenerationWorkspace";
import { Icon } from "./Icon";
import { MoveAssetDialog } from "./MoveAssetDialog";
import { Button, Dialog, IconButton, SegmentedControl } from "./ui";

/** "removed" is the quiet recovery surface: works hidden from the flow can be
 *  brought back here instead of through a toolbar above the conversation. */
type BoardFilter = "all" | GenerationKind | "removed";

const assetTitle = (asset: GenerationAsset) => asset.prompt?.trim().replace(/\s+/g, " ") || asset.name;
const isRemoved = (asset: GenerationAsset) => !!(asset.job?.removed ?? asset.removed);

/** One decimal at most: 5 -> "5s", 5.1 -> "5.1s". */
function durationLabel(asset: GenerationAsset) {
	const seconds = asset.videoJob?.actualDuration ?? asset.videoJob?.duration ?? 0;
	if (!seconds) return "";
	const rounded = Math.round(seconds * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
}

function dayLabel(timestamp: number) {
	const date = new Date(timestamp);
	const now = new Date();
	const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
	if (days === 0) return "今日";
	if (days === 1) return "昨日";
	return date.getFullYear() === now.getFullYear()
		? `${date.getMonth() + 1}月${date.getDate()}日`
		: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function groupByDay(assets: GenerationAsset[]) {
	const groups = new Map<string, GenerationAsset[]>();
	for (const asset of assets) {
		const label = dayLabel(asset.createdAt);
		const list = groups.get(label) ?? [];
		list.push(asset);
		groups.set(label, list);
	}
	return [...groups.entries()];
}

/** Pure preview: prompt, parameters and actions surface here, never on the grid. */
function AssetPreview({ asset, studio, onClose, onUseImage, onUseVideo }: {
	asset: GenerationAsset;
	studio: GenerationStudio;
	onClose: () => void;
	onUseImage: (asset: GenerationAsset) => void;
	onUseVideo: (asset: GenerationAsset) => void;
}) {
	const [moving, setMoving] = useState<GenerationAsset>();
	return <>
		<Dialog className="generation-preview-dialog" aria-label="作品预览" returnFocusSelector=".asset-thumb-main" onClose={onClose}>
			<header><div><strong>{assetTitle(asset)}</strong><small>{asset.name}</small></div><IconButton size="compact" variant="ghost" aria-label="关闭作品预览" onClick={onClose}><Icon name="close" /></IconButton></header>
			<div className="generation-preview-media"><MediaView key={asset.id} asset={asset} playing /></div>
			<div className="generation-preview-info">
				{asset.prompt && <p>{asset.prompt}</p>}
				{asset.job && <small>{asset.job.serviceName} · {asset.job.modelId} · {(asset.job.actualSize ?? asset.job.size).replace("x", " × ")} · {new Date(asset.createdAt).toLocaleString()}</small>}
				{asset.videoJob && <small>{asset.videoJob.serviceName} · {asset.videoJob.modelId} · {asset.videoJob.duration} 秒 · {new Date(asset.createdAt).toLocaleString()}</small>}
				<small>对话：{canvasLabel(studio.canvases, assetCanvasId(asset, studio.canvases))}</small>
			</div>
			<footer>
				{isRemoved(asset) && <Button size="compact" onClick={() => { onClose(); void studio.setAssetRemoved(asset, false); }}><Icon name="refresh" size={14} />恢复到作品流</Button>}
				{asset.kind === "image" && <><Button size="compact" onClick={() => { onClose(); onUseImage(asset); }}><Icon name="imageSpark" />用作参考图</Button>
					<Button size="compact" onClick={() => { onClose(); onUseVideo(asset); }}><Icon name="video" />用作首帧</Button></>}
				<Button size="compact" variant="ghost" onClick={() => setMoving(asset)}><Icon name="message" size={14} />移到对话…</Button>
			</footer>
		</Dialog>
		{moving && <MoveAssetDialog asset={moving} canvases={studio.activeCanvases} onMove={(target) => void studio.moveAsset(moving, target)} onClose={() => setMoving(undefined)} />}
	</>;
}

/** The visual timeline shared by the asset library and the history drawer: date
 *  groups of bare thumbnails, with a duration badge for video and an optional
 *  detail affordance. */
/** Grid masonry: each tile spans as many small row tracks as its rendered height needs,
 *  so tiles flow left to right like a normal grid while keeping their natural ratio. */
function TimelineRow({ masonry, children }: { masonry?: boolean; children: ReactNode }) {
	const grid = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const node = grid.current;
		if (!masonry || !node) return;
		const fit = (item: HTMLElement) => {
			const style = getComputedStyle(node);
			const unit = parseFloat(style.gridAutoRows) || 4;
			const gap = parseFloat(style.columnGap) || 12;
			item.style.gridRowEnd = `span ${Math.max(1, Math.ceil((item.getBoundingClientRect().height + gap) / unit))}`;
		};
		const sizes = new ResizeObserver((entries) => { for (const entry of entries) fit(entry.target as HTMLElement); });
		const watch = () => { sizes.disconnect(); for (const item of Array.from(node.children) as HTMLElement[]) sizes.observe(item); };
		watch();
		const items = new MutationObserver(watch);
		items.observe(node, { childList: true });
		return () => { sizes.disconnect(); items.disconnect(); };
	}, [masonry]);
	return <div ref={grid} className="asset-timeline-grid" data-masonry={masonry || undefined}>{children}</div>;
}

function TimelineGrid({ assets, onPick, onPreview, selectedId, emptyTitle, emptyText, masonry }: {
	/** Row-order masonry: works keep their own shape and still read left to right. */
	masonry?: boolean;
	assets: GenerationAsset[];
	onPick: (asset: GenerationAsset) => void;
	onPreview?: (asset: GenerationAsset) => void;
	selectedId?: string;
	emptyTitle: string;
	emptyText: string;
}) {
	if (!assets.length) return <div className="generation-empty"><Icon name="image" size={28} /><h2>{emptyTitle}</h2><p>{emptyText}</p></div>;
	const groups = groupByDay(assets);
	return <div className="asset-timeline">
		{groups.map(([label, items]) => <section className="asset-timeline-group" key={label}>
			<h3 className="asset-timeline-date">{label}<span>{items.length}</span></h3>
			<TimelineRow masonry={masonry}>
				{items.map((asset) => <div className="asset-thumb" key={asset.id} data-kind={asset.kind} data-selected={selectedId === asset.id || undefined}>
					<button type="button" className="asset-thumb-main" aria-label={`预览作品：${asset.name}`} onClick={() => onPick(asset)}><MediaView asset={asset} />{asset.kind === "video" && <span className="asset-thumb-duration">{durationLabel(asset)}</span>}</button>
					{onPreview && <button type="button" className="asset-thumb-preview" aria-label={`查看详情：${asset.name}`} onClick={() => onPreview(asset)}><Icon name="eye" size={14} /></button>}
				</div>)}
			</TimelineRow>
		</section>)}
	</div>;
}

/** The full-width asset library: a header, a light filter, then the timeline. */
function AssetBoard({ title, ariaLabel, emptyTitle, emptyText, assets, studio, onImageToImage, onImageToVideo }: {
	title: string;
	ariaLabel: string;
	emptyTitle: string;
	emptyText: string;
	assets: GenerationAsset[];
	studio: GenerationStudio;
	onImageToImage: (asset: GenerationAsset) => void;
	onImageToVideo: (asset: GenerationAsset) => void;
}) {
	const [filter, setFilter] = useState<BoardFilter>("all");
	const [selected, setSelected] = useState<GenerationAsset>();
	const live = assets.filter((asset) => !isRemoved(asset));
	const removed = assets.filter(isRemoved);
	const images = live.filter((asset) => asset.kind === "image").length;
	const videos = live.length - images;
	const scoped = filter === "removed" ? removed : live.filter((asset) => filter === "all" || asset.kind === filter);
	const sorted = [...scoped].sort((before, after) => after.createdAt - before.createdAt);
	const filters: Array<{ value: BoardFilter; label: string }> = [
		{ value: "all", label: `全部 ${live.length}` },
		{ value: "image", label: `图片 ${images}` },
		{ value: "video", label: `视频 ${videos}` },
	];
	return <section className="asset-library design-canvas" aria-label={ariaLabel}>
		<div className="asset-library-scroll">
			{/* One quiet row: the title, the kind filter, and the bin set apart at the end. */}
			<div className="generation-gallery-heading asset-library-heading">
				<h2>{title}</h2>
				<SegmentedControl label="作品筛选" value={filter} onChange={setFilter} options={filters} />
				{removed.length > 0 && <Button size="compact" variant="ghost" className="asset-library-removed" aria-pressed={filter === "removed"} onClick={() => setFilter(filter === "removed" ? "all" : "removed")}><Icon name="archive" size={14} />已移除 {removed.length}</Button>}
			</div>
			<TimelineGrid
				masonry
				assets={sorted}
				onPick={setSelected}
				selectedId={selected?.id}
				emptyTitle={filter === "removed" ? "没有已移除的作品" : filter === "video" ? "还没有视频" : filter === "image" ? "还没有图片" : emptyTitle}
				emptyText={filter === "removed" ? "从作品流移除的图片会收在这里，可随时恢复。" : emptyText}
			/>
		</div>
		{selected && <AssetPreview asset={selected} studio={studio} onClose={() => setSelected(undefined)} onUseImage={onImageToImage} onUseVideo={onImageToVideo} />}
	</section>;
}

/** Every generated or imported work, across canvases. */
export function DesignAssetLibrary({ studio, assets, onImageToImage, onImageToVideo }: {
	studio: GenerationStudio;
	assets: GenerationAsset[];
	onImageToImage: (asset: GenerationAsset) => void;
	onImageToVideo: (asset: GenerationAsset) => void;
}) {
	return <AssetBoard
		ariaLabel="资产库"
		title="资产库"
		emptyTitle="还没有素材"
		emptyText="生成或导入作品后，会在这里按日期集中展示。"
		assets={assets}
		studio={studio}
		onImageToImage={onImageToImage}
		onImageToVideo={onImageToVideo}
	/>;
}

/** The right-side history drawer: browse images by date and fill one straight
 *  into the composer's reference slot without leaving the current canvas. */
export function HistoryDrawer({ studio, assets, kind, onFillImage, onFillVideo, onClose }: {
	studio: GenerationStudio;
	assets: GenerationAsset[];
	kind: GenerationKind;
	onFillImage: (asset: GenerationAsset) => void;
	onFillVideo: (asset: GenerationAsset) => void;
	onClose: () => void;
}) {
	const [selected, setSelected] = useState<GenerationAsset>();
	const [filledId, setFilledId] = useState<string>();
	const images = assets.filter((asset) => asset.kind === "image" && !isRemoved(asset)).sort((before, after) => after.createdAt - before.createdAt);
	const pick = (asset: GenerationAsset) => {
		if (kind === "video") onFillVideo(asset); else onFillImage(asset);
		setFilledId(asset.id);
	};
	return <aside className="design-history-drawer" aria-label="历史垫图">
		<header>
			<div>
				<span className="generation-eyebrow">HISTORY</span>
				<h2>历史垫图</h2>
				<p>点击图片填入当前{kind === "video" ? "首帧" : "参考图"}位</p>
			</div>
			<IconButton size="compact" variant="ghost" aria-label="关闭历史垫图" onClick={onClose}><Icon name="close" /></IconButton>
		</header>
		<div className="design-history-body">
			<TimelineGrid
				assets={images}
				onPick={pick}
				onPreview={setSelected}
				selectedId={filledId}
				emptyTitle="还没有可垫图的历史图片"
				emptyText="生成图片后，会按日期出现在这里，可随时垫入输入框。"
			/>
		</div>
		{selected && <AssetPreview asset={selected} studio={studio} onClose={() => setSelected(undefined)} onUseImage={onFillImage} onUseVideo={onFillVideo} />}
	</aside>;
}
