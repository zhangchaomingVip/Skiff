import { memo, useRef, useState, type ReactNode } from "react";
import type { Project } from "../chat/workspace";
import type { GenerationAsset, GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { DesignAssetLibrary } from "./DesignAssetLibrary";
import { DesignSidebar } from "./DesignSidebar";
import { assetCanvasId } from "../workbench/designCanvases";
import { GenerationThread } from "./GenerationWorkspace";
import { SidebarPresentation } from "./SidebarPresentation";
import { StudioPromptHero } from "./StudioPromptHero";
import { Icon } from "./Icon";
import { Button, IconButton, Tooltip } from "./ui";
import "./generation-workspace.css";

export const DesignWorkspace = memo(function DesignWorkspace({ active, kind, studio, onKind, onConfigure, sidebarOpen, onCloseSidebar, onOpenSidebar, sidebarResize, activityBar, project, onOpenCodeFile }: {
	active: boolean; kind: GenerationKind; studio: GenerationStudio; onKind: (kind: GenerationKind) => void; onConfigure: (kind: GenerationKind) => void;
	sidebarOpen: boolean; onCloseSidebar: () => void; onOpenSidebar: () => void; sidebarResize: ReactNode; activityBar: ReactNode;
	project?: Project;
	onOpenCodeFile: (project: Project, path: string) => void;
}) {
	const [saved, setSaved] = useState<{ project: Project; path: string }>();
	const [saveError, setSaveError] = useState<string>();
	const [saving, setSaving] = useState(false);
	const host = useRef<HTMLDivElement>(null);
	const saveLock = useRef(false);
	const home = !studio.canvasView && !studio.assetView;
	const closeSidebar = () => { if (window.innerWidth <= 760) onCloseSidebar(); };
	/** Selecting a canvas should never land on an empty view when that canvas
	 *  already holds works: adopt the other creation mode if it is the only one. */
	const openCanvas = (id: string) => {
		const canvasAssets = studio.assets.filter((asset) => assetCanvasId(asset, studio.canvases) === id);
		if (canvasAssets.length && !canvasAssets.some((asset) => asset.kind === kind)) onKind(canvasAssets[0].kind);
		studio.openCanvas(id);
		closeSidebar();
	};
	/** The composer owns focus across the whole studio: reusing a work never
	 *  scrolls away, it fills the dock that waits at the foot of the flow. */
	const focusPrompt = () => requestAnimationFrame(() => {
		const textarea = host.current?.querySelector<HTMLTextAreaElement>(".design-dock textarea");
		textarea?.focus();
		if (textarea) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
	});
	/** Every "去创作" entry point lands on the launcher with a clean reference,
	 *  so the dock stays the single place where a draft begins. */
	const create = (next: GenerationKind) => {
		onKind(next); studio.openGallery(); studio.removeImageReference();
		closeSidebar(); focusPrompt();
	};
	const saveToProject = async (asset: Parameters<typeof studio.saveToProject>[0]) => {
		if (!project || saveLock.current) return;
		saveLock.current = true; setSaving(true); setSaveError(undefined); setSaved(undefined);
		try { const path = await studio.saveToProject(asset, project); setSaved({ project, path }); }
		catch (error) { setSaveError(String(error)); }
		finally { saveLock.current = false; setSaving(false); }
	};
	/** Reusing a work as a reference keeps the current route: the dock receives
	 *  the image, and the draft never travels between pages. */
	const imageToImage = (asset: GenerationAsset) => { studio.useImageForImage(asset); onKind("image"); if (studio.assetView) studio.openCanvas(studio.canvasId); focusPrompt(); closeSidebar(); };
	const imageToVideo = (asset: GenerationAsset) => { studio.useImageForVideo(asset); onKind("video"); if (studio.assetView) studio.openCanvas(studio.canvasId); focusPrompt(); closeSidebar(); };
	return <div className="workbench-shell design-workspace" hidden={!active} aria-label="Design 工作区">
		{sidebarOpen && (active || window.innerWidth > 760) && <SidebarPresentation active={active} label="Design 导航" activityBar={activityBar} onClose={onCloseSidebar}><DesignSidebar studio={studio} onOpenCanvas={openCanvas} onCollapse={onCloseSidebar} /></SidebarPresentation>}
		{sidebarResize}
		<main className="design-main" ref={host}>
			<div className="design-results">
				{(saved || saveError) && <div className="design-asset-notice" role={saveError ? "alert" : "status"}>{saveError ?? `已保存到 ${saved?.project.name}：${saved?.path}`}{saved && <Button size="compact" variant="ghost" onClick={() => onOpenCodeFile(saved.project, saved.path)}>在 Code 中查看</Button>}</div>}
				{studio.assetView
					? <DesignAssetLibrary studio={studio} assets={studio.assets} onCreate={() => create(kind)} onImageToImage={imageToImage} onImageToVideo={imageToVideo} />
					: <section className={`design-stage${studio.canvasView ? " design-canvas-scene" : ""}`} aria-label="生图工作台">
						{!sidebarOpen && <div className="design-stage-expand"><Tooltip text="展开导航"><IconButton size="compact" variant="ghost" aria-label="展开导航" onClick={onOpenSidebar}><Icon name="panel" size={16} /></IconButton></Tooltip></div>}
						<GenerationThread
							studio={studio}
							kind={kind}
							canvasId={home ? undefined : studio.canvasId}
							active={active}
							onKind={onKind}
							onImageToImage={imageToImage}
							onImageToVideo={imageToVideo}
							onSaveToProject={(asset) => void saveToProject(asset)}
							saving={saving}
						/>
						<div className="design-dock"><StudioPromptHero kind={kind} studio={studio} onKind={onKind} onConfigure={() => onConfigure(kind)} /></div>
					</section>}
			</div>
		</main>
	</div>;
}, (before, after) => !before.active && !after.active);
