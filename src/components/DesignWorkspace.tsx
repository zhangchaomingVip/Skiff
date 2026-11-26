import { memo, useEffect, useRef, useState, type ReactNode } from "react";

const narrowQuery = "(max-width: 760px)";
/** Tracks the drawer breakpoint live, so resizing the window re-decides how the sidebar presents. */
function useNarrowViewport() {
	const [narrow, setNarrow] = useState(() => window.matchMedia(narrowQuery).matches);
	useEffect(() => {
		const query = window.matchMedia(narrowQuery);
		const update = () => setNarrow(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return narrow;
}
import type { Project } from "../chat/workspace";
import type { GenerationAsset, GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { DesignAssetLibrary, HistoryDrawer } from "./DesignAssetLibrary";
import { DesignSidebar } from "./DesignSidebar";
import { maxDesignCanvases } from "../workbench/designCanvases";
import { DesignArchives } from "./DesignArchives";
import { GenerationThread } from "./GenerationWorkspace";
import { SidebarPresentation } from "./SidebarPresentation";
import { StudioPromptHero } from "./StudioPromptHero";
import { Icon } from "./Icon";
import { Button, IconButton } from "./ui";
import "./generation-workspace.css";

export const DesignWorkspace = memo(function DesignWorkspace({ active, kind, studio, onKind, onConfigure, sidebarOpen, onCloseSidebar, sidebarResize, activityBar, project, onOpenCodeFile }: {
	active: boolean; kind: GenerationKind; studio: GenerationStudio; onKind: (kind: GenerationKind) => void; onConfigure: (kind: GenerationKind) => void;
	sidebarOpen: boolean; onCloseSidebar: () => void; sidebarResize: ReactNode; activityBar: ReactNode;
	project?: Project;
	onOpenCodeFile: (project: Project, path: string) => void;
}) {
	const [saved, setSaved] = useState<{ project: Project; path: string }>();
	const [saveError, setSaveError] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);
	const host = useRef<HTMLDivElement>(null);
	const saveLock = useRef(false);
	const narrow = useNarrowViewport();
	// A success note clears itself; an error stays until it is dismissed or replaced.
	useEffect(() => {
		if (!saved) return;
		const timer = window.setTimeout(() => setSaved(undefined), 5000);
		return () => window.clearTimeout(timer);
	}, [saved]);
	const dismissNotice = () => { setSaved(undefined); setSaveError(undefined); };
	const home = studio.view === "home";
	const inConversation = studio.view === "canvas";
	const showComposer = home || inConversation;
	const closeSidebar = () => { if (narrow) onCloseSidebar(); };
	const openCanvas = (id: string) => { studio.openCanvas(id); closeSidebar(); };
	const openArchives = () => { setHistoryOpen(false); studio.openArchives(); closeSidebar(); };
	const archiveCanvas = (id: string) => {
		if (!studio.archiveCanvas(id)) return false;
		if (inConversation && studio.canvasId === id) { setHistoryOpen(false); closeSidebar(); }
		return true;
	};
	/** The composer owns focus across the whole studio: reusing a work never
	 *  scrolls away, it fills the dock that waits at the foot of the flow. */
	const focusPrompt = () => requestAnimationFrame(() => {
		const textarea = host.current?.querySelector<HTMLTextAreaElement>(".design-dock textarea");
		textarea?.focus();
		if (textarea) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
	});
	/** Filling a reference from the history drawer never leaves the flow: the
	 *  media lands in the composer slot and the mode follows the chosen slot. */
	const fillImage = (asset: GenerationAsset) => { studio.useImageForImage(asset); onKind("image"); focusPrompt(); };
	const fillVideo = (asset: GenerationAsset) => { studio.useImageForVideo(asset); onKind("video"); focusPrompt(); };
	const saveToProject = async (asset: Parameters<typeof studio.saveToProject>[0]) => {
		if (!project || saveLock.current) return;
		saveLock.current = true; setSaving(true); setSaveError(undefined); setSaved(undefined);
		try { const path = await studio.saveToProject(asset, project); setSaved({ project, path }); }
		catch (error) { setSaveError(String(error)); }
		finally { saveLock.current = false; setSaving(false); }
	};
	/** Reusing a work as a reference keeps the current route: the dock receives
	 *  the image, and the draft never travels between pages. */
	const imageToImage = (asset: GenerationAsset) => { studio.useImageForImage(asset); onKind("image"); if (studio.view === "assets") studio.openGallery(); focusPrompt(); closeSidebar(); };
	const imageToVideo = (asset: GenerationAsset) => { studio.useImageForVideo(asset); onKind("video"); if (studio.view === "assets") studio.openGallery(); focusPrompt(); closeSidebar(); };
	return <div className="workbench-shell design-workspace" hidden={!active} aria-label="Design 工作区">
		{sidebarOpen && (active || !narrow) && <SidebarPresentation active={active} label="Design 导航" activityBar={activityBar} onClose={onCloseSidebar}><DesignSidebar studio={studio} onOpenCanvas={openCanvas} onOpenArchives={openArchives} onArchive={archiveCanvas} /></SidebarPresentation>}
		{sidebarResize}
		<main className="design-main" ref={host}>
			<div className="design-results">
				{studio.canvasError && <p className="design-thread-error" role="alert"><Icon name="alert" size={14} />{studio.canvasError}</p>}
				{(saved || saveError) && <div className="design-asset-notice" role={saveError ? "alert" : "status"}>{saveError ?? `已保存到 ${saved?.project.name}：${saved?.path}`}{saved && <Button size="compact" variant="ghost" onClick={() => onOpenCodeFile(saved.project, saved.path)}>在 Code 中查看</Button>}<IconButton size="compact" variant="ghost" aria-label="关闭提示" onClick={dismissNotice}><Icon name="close" size={14} /></IconButton></div>}
				{studio.view === "assets" && <DesignAssetLibrary studio={studio} assets={studio.assets} onImageToImage={imageToImage} onImageToVideo={imageToVideo} />}
				{studio.view === "archives" && <DesignArchives studio={studio} active={active} kind={kind} onRestore={(id) => { studio.restoreCanvas(id); focusPrompt(); }} />}
				{showComposer && <section className={`design-stage${home ? " design-home" : " design-canvas-scene"}`} aria-label={home ? "新对话" : "对话"}>
						{home ? <h1 className="design-home-title">今天想创作什么？</h1> : <GenerationThread
							studio={studio}
							kind={kind}
							canvasId={studio.canvasId}
							active={active}
							actions={{ onImageToImage: imageToImage, onImageToVideo: imageToVideo, onSaveToProject: (asset) => void saveToProject(asset), saving }}
						/>}
						<div className="design-dock">
							{studio.canvasLimitReached && <p className="design-canvas-limit" role="status">对话已达 {maxDesignCanvases} 条上限（含归档）。可以在已有对话中继续创作。</p>}
							<StudioPromptHero kind={kind} studio={studio} onConfigure={() => onConfigure(kind)} onOpenHistory={() => setHistoryOpen(true)} />
						</div>
					</section>}
			</div>
			{historyOpen && showComposer && <HistoryDrawer studio={studio} assets={studio.assets} kind={kind} onFillImage={fillImage} onFillVideo={fillVideo} onClose={() => setHistoryOpen(false)} />}
		</main>
	</div>;
}, (before, after) => !before.active && !after.active);
