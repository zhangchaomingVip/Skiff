import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import type { Project } from "../chat/workspace";
import type { GenerationKind, GenerationStudio } from "../workbench/useGenerationStudio";
import { designCollections, type DesignCollection } from "../workbench/designWorkspace";
import { DesignHero } from "./DesignHero";
import { DesignSidebar } from "./DesignSidebar";
import { GenerationControls, GenerationGallery } from "./GenerationWorkspace";
import { SidebarPresentation } from "./SidebarPresentation";
import { Button, Dialog } from "./ui";

function readCollections(): Record<GenerationKind, DesignCollection> {
	try { const saved = JSON.parse(localStorage.getItem("skiff.design.collections.v1") ?? "null"); return { image: designCollections.includes(saved?.image) ? saved.image : "all", video: designCollections.includes(saved?.video) ? saved.video : "all" }; }
	catch { return { image: "all", video: "all" }; }
}

export const DesignWorkspace = memo(function DesignWorkspace({ active, kind, studio, onKind, onConfigure, settingsOpen, sidebarOpen, onCloseSidebar, sidebarResize, activityBar, project, onOpenCodeFile }: {
	active: boolean; kind: GenerationKind; studio: GenerationStudio; onKind: (kind: GenerationKind) => void; onConfigure: (kind: GenerationKind) => void;
	settingsOpen: boolean;
	sidebarOpen: boolean; onCloseSidebar: () => void; sidebarResize: ReactNode; activityBar: ReactNode;
	project?: Project;
	onOpenCodeFile: (project: Project, path: string) => void;
}) {
	const [collections, setCollections] = useState(readCollections);
	const [parametersOpen, setParametersOpen] = useState(() => { try { return localStorage.getItem("skiff.design.parameters.open") !== "false"; } catch { return true; } });
	const [drawer, setDrawer] = useState(false);
	const [restoreDrawer, setRestoreDrawer] = useState(false);
	const [compact, setCompact] = useState(() => window.innerWidth <= 1100);
	const host = useRef<HTMLDivElement>(null);
	const [visited, setVisited] = useState<Set<GenerationKind>>(() => new Set([kind]));
	const [saved, setSaved] = useState<{ project: Project; path: string }>();
	const [saveError, setSaveError] = useState<string>();
	const [saving, setSaving] = useState(false);
	const saveLock = useRef(false);
	useEffect(() => { setVisited((current) => current.has(kind) ? current : new Set([...current, kind])); }, [kind]);
	useEffect(() => { try { localStorage.setItem("skiff.design.collections.v1", JSON.stringify(collections)); localStorage.setItem("skiff.design.parameters.open", String(parametersOpen)); } catch { /* View remains usable without storage. */ } }, [collections, parametersOpen]);
	useEffect(() => {
		const node = host.current; if (!node) return;
		const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width) setCompact(entry.contentRect.width < 900); });
		observer.observe(node); return () => observer.disconnect();
	}, []);
	useEffect(() => { if (!active) setDrawer(false); }, [active]);
	useEffect(() => { if (!compact) setDrawer(false); }, [compact]);
	useEffect(() => { if (restoreDrawer && !settingsOpen) { setRestoreDrawer(false); if (active && compact) setDrawer(true); } }, [restoreDrawer, settingsOpen, active, compact]);
	// The composer opens at the top of the works, so bring it back into view when
	// the user reveals it from deep inside the gallery.
	useEffect(() => { if (parametersOpen && !compact) host.current?.querySelector(".design-gallery-route:not([hidden]) .generation-gallery-scroll")?.scrollTo({ top: 0 }); }, [parametersOpen, compact]);
	const changeCollection = (collection: DesignCollection) => { setCollections((current) => ({ ...current, [kind]: collection })); if (window.innerWidth <= 760) onCloseSidebar(); };
	const create = (next: GenerationKind, reference = false) => {
		onKind(next); setCollections((current) => ({ ...current, [next]: "all" }));
		if (next === "image" && !reference) studio.removeImageReference();
		setParametersOpen(true); if (compact) { onCloseSidebar(); setDrawer(true); }
		requestAnimationFrame(() => {
			const route = host.current?.querySelector(".design-gallery-route:not([hidden])");
			if (reference) route?.querySelector<HTMLButtonElement>(".generation-reference-upload")?.focus();
			else route?.querySelector<HTMLTextAreaElement>(".generation-controls textarea")?.focus();
		});
	};
	const saveToProject = async (asset: Parameters<typeof studio.saveToProject>[0]) => {
		if (!project || saveLock.current) return;
		saveLock.current = true; setSaving(true); setSaveError(undefined); setSaved(undefined);
		try { const path = await studio.saveToProject(asset, project); setSaved({ project, path }); }
		catch (error) { setSaveError(String(error)); }
		finally { saveLock.current = false; setSaving(false); }
	};
	// Switching the kind keeps an existing reference; the quick starts clear it on
	// purpose when they begin a fresh text-to-image draft.
	const switchKind = (next: GenerationKind) => { onKind(next); setParametersOpen(true); if (compact) setDrawer(true); };
	const parameters = <GenerationControls key={kind} kind={kind} studio={studio} onConfigure={() => { setRestoreDrawer(drawer); setDrawer(false); onConfigure(kind); }} />;
	const toggleParameters = () => { if (compact) setDrawer((value) => !value); else setParametersOpen((value) => !value); };
	const heroFor = (item: GenerationKind) => <DesignHero
		kind={item}
		parametersOpen={parametersOpen && !compact && item === kind}
		composer={item === kind && parametersOpen && !compact ? parameters : undefined}
		onKind={switchKind}
		onOpenParameters={toggleParameters}
	/>;
	return <div className="workbench-shell design-workspace" hidden={!active} aria-label="Design 工作区">
		{sidebarOpen && (active || window.innerWidth > 760) && <SidebarPresentation active={active} label="Design 导航" activityBar={activityBar} onClose={onCloseSidebar}><DesignSidebar studio={studio} kind={kind} collection={collections[kind]} onCollection={changeCollection} onCreate={create} /></SidebarPresentation>}
		{sidebarResize}
		<main className="design-main" ref={host}>
			<div className="design-results">
				{(saved || saveError) && <div className="design-asset-notice" role={saveError ? "alert" : "status"}>{saveError ?? `已保存到 ${saved?.project.name}：${saved?.path}`}{saved && <Button size="compact" variant="ghost" onClick={() => onOpenCodeFile(saved.project, saved.path)}>在 Code 中查看</Button>}</div>}
				{(["image", "video"] as const).filter((item) => visited.has(item) || item === kind).map((item) => <div key={item} className="design-gallery-route" hidden={item !== kind}><GenerationGallery kind={item} studio={studio} collection={collections[item]} hero={heroFor(item)} onCollectionChange={(collection) => setCollections((current) => ({ ...current, [item]: collection }))} active={active && item === kind} onParameters={toggleParameters} onImageToImage={(asset) => { studio.useImageForImage(asset); onKind("image"); setParametersOpen(true); if (compact) setDrawer(true); }} onImageToVideo={(asset) => { studio.useImageForVideo(asset); onKind("video"); setParametersOpen(true); if (compact) setDrawer(true); }} onSaveToProject={(asset) => void saveToProject(asset)} saving={saving} /></div>)}
			</div>
		</main>
		{active && drawer && compact && <Dialog variant="drawer" aria-label="创作参数" returnFocusSelector=".design-gallery-route:not([hidden]) .design-hero-parameters" onClose={() => setDrawer(false)}>{parameters}</Dialog>}
	</div>;
}, (before, after) => !before.active && !after.active);
