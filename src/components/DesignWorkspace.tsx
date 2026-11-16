import { memo, useRef, useState, type ReactNode } from "react";
import type { Project } from "../chat/workspace";
import type { GenerationAsset, GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import type { DesignCollection } from "../workbench/designWorkspace";
import { DesignAssetLibrary } from "./DesignAssetLibrary";
import { DesignSidebar } from "./DesignSidebar";
import { assetCanvasId, canvasLabel } from "../workbench/designCanvases";
import { GenerationControls, GenerationGallery } from "./GenerationWorkspace";
import { SidebarPresentation } from "./SidebarPresentation";
import { StudioInspiration, StudioPromptHero } from "./StudioPromptHero";
import { CanvasNameDialog } from "./CanvasNameDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, IconButton, SegmentedControl, Tooltip } from "./ui";

function readCollections(): Record<GenerationKind, DesignCollection> {
	// "tasks" was a sidebar filter; the canvas keeps pending works inline, so an
	// old preference falls back to the works view instead of an empty filter.
	const pick = (value: unknown): DesignCollection => value === "failures" || value === "removed" ? value : "all";
	try { const saved = JSON.parse(localStorage.getItem("skiff.design.collections.v1") ?? "null"); return { image: pick(saved?.image), video: pick(saved?.video) }; }
	catch { return { image: "all", video: "all" }; }
}

export const DesignWorkspace = memo(function DesignWorkspace({ active, kind, studio, onKind, onConfigure, sidebarOpen, onCloseSidebar, sidebarResize, activityBar, project, onOpenCodeFile }: {
	active: boolean; kind: GenerationKind; studio: GenerationStudio; onKind: (kind: GenerationKind) => void; onConfigure: (kind: GenerationKind) => void;
	sidebarOpen: boolean; onCloseSidebar: () => void; sidebarResize: ReactNode; activityBar: ReactNode;
	project?: Project;
	onOpenCodeFile: (project: Project, path: string) => void;
}) {
	const [collections, setCollections] = useState(readCollections);
	const [renaming, setRenaming] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [saved, setSaved] = useState<{ project: Project; path: string }>();
	const [saveError, setSaveError] = useState<string>();
	const [saving, setSaving] = useState(false);
	const host = useRef<HTMLDivElement>(null);
	const saveLock = useRef(false);
	const home = !studio.canvasView && !studio.assetView;
	const activeCanvas = studio.canvases.find((canvas) => canvas.id === studio.canvasId);
	const canvasName = canvasLabel(studio.canvases, studio.canvasId);
	const canvasAssets = studio.assets.filter((asset) => assetCanvasId(asset, studio.canvases) === studio.canvasId);
	const focusPrompt = () => requestAnimationFrame(() => host.current?.querySelector<HTMLTextAreaElement>(".studio-home textarea")?.focus());
	const focusComposer = () => requestAnimationFrame(() => host.current?.querySelector<HTMLTextAreaElement>(".design-composer[data-variant=canvas] textarea")?.focus());
	const closeSidebar = () => { if (window.innerWidth <= 760) onCloseSidebar(); };
	/** Every "去创作" entry point lands on the launcher with a clean reference,
	 *  so the big card stays the single place where a draft begins. */
	const create = (next: GenerationKind) => {
		onKind(next); studio.openGallery(); studio.removeImageReference();
		setCollections((current) => ({ ...current, [next]: "all" }));
		closeSidebar(); focusPrompt();
	};
	const saveToProject = async (asset: Parameters<typeof studio.saveToProject>[0]) => {
		if (!project || saveLock.current) return;
		saveLock.current = true; setSaving(true); setSaveError(undefined); setSaved(undefined);
		try { const path = await studio.saveToProject(asset, project); setSaved({ project, path }); }
		catch (error) { setSaveError(String(error)); }
		finally { saveLock.current = false; setSaving(false); }
	};
	const imageToImage = (asset: GenerationAsset) => { studio.useImageForImage(asset); onKind("image"); studio.openGallery(); closeSidebar(); focusPrompt(); };
	const imageToVideo = (asset: GenerationAsset) => { studio.useImageForVideo(asset); onKind("video"); studio.openGallery(); closeSidebar(); focusPrompt(); };
	const sceneHeader = <header className="generation-workspace-header canvas-header">
		<Button className="canvas-home" size="compact" variant="ghost" onClick={studio.openGallery}><Icon name="arrowLeft" size={14} />首页</Button>
		<span className="canvas-crumb"><Icon name={activeCanvas ? "layers" : "archive"} size={14} /><strong title={canvasName}>{canvasName}</strong><small>{canvasAssets.length}</small></span>
		<div className="generation-workspace-tools">
			<SegmentedControl label="创作类型" value={kind} onChange={onKind} options={[{ value: "image", label: "图片" }, { value: "video", label: "视频" }]} />
			{activeCanvas && <>
				<Tooltip text="重命名画布"><IconButton size="compact" variant="ghost" aria-label="重命名画布" onClick={() => setRenaming(true)}><Icon name="edit" size={15} /></IconButton></Tooltip>
				<Tooltip text="删除画布"><IconButton size="compact" variant="ghost" aria-label="删除画布" onClick={() => setConfirming(true)}><Icon name="close" size={15} /></IconButton></Tooltip>
			</>}
		</div>
	</header>;
	const sceneEmpty = <div className="generation-empty canvas-empty">
		<div className="generation-empty-art" aria-hidden="true"><span className="generation-empty-back" /><span className="generation-empty-frame"><Icon name="layers" size={24} /></span><span className="generation-empty-spark"><Icon name="spark" size={16} /></span></div>
		<h2>这个画布还没有作品</h2>
		<p>在上方写一句描述，新作品会自动收进「{canvasName}」。</p>
		<Button variant="ghost" size="compact" onClick={focusComposer}><Icon name="spark" size={14} />开始创作</Button>
	</div>;
	return <div className="workbench-shell design-workspace" hidden={!active} aria-label="Design 工作区">
		{sidebarOpen && (active || window.innerWidth > 760) && <SidebarPresentation active={active} label="Design 导航" activityBar={activityBar} onClose={onCloseSidebar}><DesignSidebar studio={studio} onOpenCanvas={(id) => { studio.openCanvas(id); closeSidebar(); }} /></SidebarPresentation>}
		{sidebarResize}
		<main className="design-main" ref={host}>
			<div className="design-results">
				{(saved || saveError) && <div className="design-asset-notice" role={saveError ? "alert" : "status"}>{saveError ?? `已保存到 ${saved?.project.name}：${saved?.path}`}{saved && <Button size="compact" variant="ghost" onClick={() => onOpenCodeFile(saved.project, saved.path)}>在 Code 中查看</Button>}</div>}
				{home && <div className="design-home"><div className="design-home-inner">
					<StudioPromptHero kind={kind} studio={studio} onKind={onKind} onConfigure={() => onConfigure(kind)} onSubmitted={() => studio.openCanvas(studio.canvasId)} />
					<StudioInspiration onApply={(prompt) => { studio.updateDraft(kind, { prompt }); focusPrompt(); }} />
				</div></div>}
				{studio.canvasView && <div className="design-gallery-route design-canvas-scene">
					<GenerationGallery
						kind={kind}
						studio={studio}
						collection={collections[kind]}
						onCollectionChange={(collection) => setCollections((current) => ({ ...current, [kind]: collection }))}
						onKind={onKind}
						active={active && studio.canvasView}
						header={sceneHeader}
						showHeadingTitle={false}
						empty={sceneEmpty}
						hero={<div className="design-composer" data-variant="canvas"><GenerationControls key={kind} kind={kind} studio={studio} onConfigure={() => onConfigure(kind)} variant="canvas" /></div>}
						onImageToImage={imageToImage}
						onImageToVideo={imageToVideo}
						onSaveToProject={(asset) => void saveToProject(asset)}
						saving={saving}
					/>
				</div>}
				{studio.assetView && <DesignAssetLibrary studio={studio} assets={studio.assets.filter((asset) => !(asset.job?.removed ?? asset.removed))} onCreate={() => create(kind)} onImageToImage={imageToImage} onImageToVideo={imageToVideo} />}
			</div>
		</main>
		{renaming && activeCanvas && <CanvasNameDialog title="重命名画布" initial={activeCanvas.name} confirmText="保存名称" onConfirm={(next) => studio.renameCanvas(activeCanvas.id, next)} onClose={() => setRenaming(false)} />}
		{confirming && activeCanvas && <ConfirmDialog title="删除画布" description={`“${activeCanvas.name}”只会被删除分组，里面的 ${canvasAssets.length} 件作品会回到未分组，原文件不受影响。`} confirmText="删除画布" onConfirm={() => { studio.deleteCanvas(activeCanvas.id); studio.openGallery(); }} onClose={() => setConfirming(false)} />}
	</div>;
}, (before, after) => !before.active && !after.active);
