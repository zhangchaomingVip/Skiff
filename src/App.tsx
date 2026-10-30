import type { Delivery } from "./chat/interactions";
import { drafts, hasDraft } from "./chat/drafts";
import { useConversationSearch } from "./chat/useConversationSearch";
import { conversationLabel, conversationTooltip } from "./chat/conversationDisplay";
import { HistorySearchDialog } from "./components/HistorySearchDialog";
import { SidebarPresentation } from "./components/SidebarPresentation";
import { dismissPopovers, Button, Tooltip } from "./components/ui";
import { Icon } from "./components/Icon";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePiSessions } from "./chat/usePiSessions";
import { useSessionRef } from "./chat/useSessionValue";
import { showVoyageIcon } from "./taskbarIcon";
import { MAX_PROJECTS, isArchived, useWorkspace, visibleConversations, visibleProjects } from "./chat/workspace";
import { useModelFamilies } from "./chat/useModelFamilies";
import { ModelFamilyContext } from "./chat/familyContext";
import { familyFromProvider } from "./chat/modelDisplay";
import { reconcile, type RuntimeOffer } from "./chat/modelFamilies";
import type { ModelInfo } from "./chat/types";
import { VoyageWorkspace, useVoyagePanel } from "./components/VoyageWorkspace";
import { Sidebar } from "./components/Sidebar";
import { LauncherView } from "./components/LauncherView";
import { TitleBar } from "./components/TitleBar";
import { ProjectDialog } from "./components/ProjectDialog";
import { ProjectListLimit } from "./components/ProjectListLimit";
import { useProjectGitActivity, useProjectGitPolling, useProjectGitStatus } from "./workbench/useProjectGitStatus";
import type { ImageAttachment } from "./chat/types";
import { SettingsDialog } from "./components/SettingsDialog";
import { SettingsMenu } from "./components/SettingsMenu";
import { TitleBarNav } from "./components/TitleBarNav";
import { isMacPlatform, type SettingsCategory, type SettingsRestrictions } from "./components/settingsNavigation";
import { ResizeSeparator } from "./components/ResizeSeparator";
import { useWebSearch } from "./chat/webSearch";
import { loadRecentOffers, normalizeRecentOfferIds, rememberOffer, saveRecentOffers } from "./chat/recentOffers";
import { ActivityBar } from "./components/ActivityBar";
import { ProjectWorkbenchPanel } from "./components/ProjectWorkbenchPanel";
import { invalidateProjectFiles } from "./workbench/projectFiles";
import { GitBranches, GitTreeWorkspace } from "./components/GitTree";
import { useGitHistory } from "./workbench/useGitHistory";
import { ProjectPreview } from "./components/ProjectPreview";
import { FileWorkspaceEmpty } from "./components/FileWorkspaceEmpty";
import { ProjectChangesNavigationContext } from "./workbench/projectChangesNavigation";
import { openPreviewTab, previewId, resolveBrowseProject, type PreviewMode, type PreviewTab, type WorkbenchTool } from "./workbench/projectWorkbench";
import type { Project } from "./chat/workspace";

type AppView = "launcher" | "chat";

const readPreferredWidth = (key: string, fallback: number, min: number, max: number) => {
	try {
		const value = Number(localStorage.getItem(key));
		return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
	} catch { return fallback; }
};

export default function App() {
	const library = useWorkspace();
	const { activeChat, activeProject } = library;
	const allChats = library.workspace?.chats ?? [];
	const shownProjects = useMemo(() => visibleProjects(library.workspace?.projects ?? []), [library.workspace?.projects]);
	useProjectGitPolling(shownProjects);
	const activeProjectGit = useProjectGitStatus(activeProject);
	const projectHasGit = !!activeProjectGit.status;
	const visibleChats = useMemo(() => {
		const projectIds = new Set(shownProjects.map((project) => project.id));
		return visibleConversations(allChats).filter((chat) => projectIds.has(chat.projectId));
	}, [allChats, shownProjects]);
	const archivedChats = useMemo(() => allChats.filter((chat) => isArchived(chat) && shownProjects.some((project) => project.id === chat.projectId)), [allChats, shownProjects]);
	const [view, setView] = useState<AppView>();
	// Sidebar highlight: set by a project click, cleared as soon as a chat (or
	// home) is opened, so an open chat never keeps its project looking selected.
	const [selectedProjectId, setSelectedProjectId] = useState<string>();
	useEffect(() => {
		if (view === undefined && library.workspace && library.draftsReady) setView((activeChat?.hasMessages || activeChat?.hasDraft) ? "chat" : "launcher");
	}, [activeChat?.hasMessages, activeChat?.hasDraft, library.workspace, library.draftsReady, view]);
	const currentView = view ?? (library.workspace ? "launcher" : "chat");
	const modelFamilies = useModelFamilies();
	const pool = usePiSessions(activeChat?.id, visibleChats, shownProjects, modelFamilies.offers, { config: modelFamilies.config, ready: !modelFamilies.loading }, library.updateChat);
	useProjectGitActivity(pool.messages, pool.agentRunningIds, allChats, shownProjects);
	const { session } = pool;
	const { state, connected, actions } = session;
	const { modelNotice, setModelNotice, failover, routeAuthorization: routeAuthorizationPrompt } = session;
	const [activeTool, setActiveTool] = useState<WorkbenchTool>(() => { try { const value = JSON.parse(localStorage.getItem("skiff.workbench.v1") ?? "null")?.tool; return value === "files" || value === "git" || value === "git-tree" ? value : "chats"; } catch { return "chats"; } });
	const lastFileTab = useRef<"files" | "git">(activeTool === "git" ? "git" : "files");
	useEffect(() => { if (activeTool === "files" || activeTool === "git") lastFileTab.current = activeTool; }, [activeTool]);
	const [sidebarOpen, setSidebarOpen] = useState(() => { if (window.innerWidth <= 760) return false; try { return localStorage.getItem("skiff.sidebar.open") !== "false"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.open", String(sidebarOpen)); } catch { /* Layout can still be used without storage. */ } }, [sidebarOpen]);
	useEffect(() => { try { localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: activeTool })); } catch { /* Tool selection remains available for this run. */ } }, [activeTool]);
	const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
	const [sidebarWidth, setSidebarWidth] = useState(() => readPreferredWidth("skiff.sidebar.width", 232, 200, 420));
	const [voyageWidth, setVoyageWidth] = useState(() => readPreferredWidth("skiff.voyage.width", 260, 240, 480));
	const [voyageExpanded, toggleVoyagePanel] = useVoyagePanel();
	useEffect(() => {
		const resize = () => setViewportWidth(window.innerWidth);
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, []);
	const [projectDialogOpen, setProjectDialogOpen] = useState(false);
	const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>();
	const [purgeError, setPurgeError] = useState<string>();
	const [manualBrowseProjectId, setManualBrowseProjectId] = useState<string>();
	const browse = useMemo(() => resolveBrowseProject(shownProjects, activeProject?.id, manualBrowseProjectId), [shownProjects, activeProject?.id, manualBrowseProjectId]);
	useEffect(() => { if (manualBrowseProjectId && !browse.manualProjectId) setManualBrowseProjectId(undefined); }, [browse.manualProjectId, manualBrowseProjectId]);
	const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
	const [activePreviewId, setActivePreviewId] = useState<string>();
	const [workbenchRevision, setWorkbenchRevision] = useState(0);
	const gitHistory = useGitHistory(browse.project, activeTool === "git-tree", workbenchRevision, (project) => { invalidateProjectFiles(project.id); setWorkbenchRevision((value) => value + 1); });
	const search = useWebSearch(actions, connected, session.reconnect, session.owner, session.isCurrent);
	const busy = state.isStreaming || session.pending;
	const [recentOfferIds, setRecentOfferIds] = useState<string[]>(loadRecentOffers);
	const validOfferIds = useMemo(() => new Set(modelFamilies.offers.map((offer) => offer.offerId).filter((id): id is string => !!id)), [modelFamilies.offers]);
	useEffect(() => {
		const pruned = normalizeRecentOfferIds(recentOfferIds, validOfferIds);
		if (pruned.length !== recentOfferIds.length || pruned.some((id, index) => id !== recentOfferIds[index])) setRecentOfferIds(pruned);
		saveRecentOffers(pruned);
	}, [recentOfferIds, validOfferIds]);
	const orderedOffers = useMemo(() => {
		const rank = new Map(recentOfferIds.map((id, index) => [id, index]));
		return modelFamilies.offers.map((offer, index) => ({ offer, index })).sort((a, b) => (rank.get(a.offer.offerId ?? "") ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.offer.offerId ?? "") ?? Number.MAX_SAFE_INTEGER) || a.index - b.index).map(({ offer }) => offer);
	}, [modelFamilies.offers, recentOfferIds]);
	const pendingRecentOffer = useSessionRef<{ id: string; assistantCount: number }>(session.owner, () => undefined);
	useEffect(() => {
		const assistantCount = state.messages.filter((message) => message.role === "assistant").length;
		if (pendingRecentOffer.current && assistantCount > pendingRecentOffer.current.assistantCount && !state.isStreaming && !state.lastError) {
			setRecentOfferIds((ids) => rememberOffer(ids, pendingRecentOffer.current?.id ?? "", validOfferIds));
			pendingRecentOffer.current = undefined;
		}
		if (pendingRecentOffer.current && state.lastError && !busy) pendingRecentOffer.current = undefined;
	}, [state.isStreaming, state.lastError, state.messages.length, busy, validOfferIds]);
	// Mirror the voyage state on the taskbar: the sailing mark while pi answers,
	// the docked speedboat once the turn ends.
	useEffect(() => { void showVoyageIcon(pool.runningIds.size > 0).catch(() => undefined); }, [pool.runningIds.size > 0]);
	const navigationDisabled = search.busy || !library.workspace;
	const locked = navigationDisabled || session.loading;
	const settingsRestrictions = useMemo<SettingsRestrictions>(() => ({
		prompt: busy ? "当前会话运行中，请等待完成后修改系统提示词" : locked ? "正在加载会话，请稍后再试" : undefined,
		providers: busy ? "当前会话运行中，请等待完成后修改供应商配置" : locked || modelFamilies.loading ? "正在加载会话或更新配置，请稍后再试" : undefined,
		models: busy ? "当前会话运行中，请等待完成后修改模型配置" : locked || modelFamilies.loading ? "正在加载会话或更新配置，请稍后再试" : undefined,
		routes: busy ? "当前会话运行中，请等待完成后修改路线配置" : locked || modelFamilies.loading ? "正在加载会话或更新配置，请稍后再试" : undefined,
		archives: locked ? "正在加载会话或切换工作区，请稍后再试" : undefined,
	}), [busy, locked, modelFamilies.loading]);
	const openSettings = useCallback((category: SettingsCategory = "appearance") => {
		if (settingsCategory) return;
		// Only the navigation drawer may yield to settings; business dialogs
		// keep their ownership of keyboard and focus.
		if (document.querySelector("dialog[open]:not([data-variant='drawer'])")) return;
		dismissPopovers();
		if (window.innerWidth <= 760) setSidebarOpen(false);
		setSettingsCategory(settingsRestrictions[category] ? "appearance" : category);
	}, [settingsCategory, settingsRestrictions]);
	const narrowViewport = viewportWidth <= 760;
	useEffect(() => { if (narrowViewport && settingsCategory) setSidebarOpen(false); }, [narrowViewport, settingsCategory]);
	const desktopSidebarOpen = sidebarOpen && !narrowViewport;
	const sidebarBounds = { min: 200, max: Math.max(200, Math.min(420, viewportWidth - 416)) };
	const shownSidebarWidth = Math.max(sidebarBounds.min, Math.min(sidebarWidth, sidebarBounds.max));
	const workspaceWidth = viewportWidth - 50 - (desktopSidebarOpen ? shownSidebarWidth + 8 : 0);
	const voyageBounds = { min: 240, max: Math.max(240, Math.min(480, workspaceWidth - 368)) };
	const shownVoyageWidth = Math.max(voyageBounds.min, Math.min(voyageWidth, voyageBounds.max));
	const setSidebarWidthFromDrag = useCallback((value: number) => setSidebarWidth(value), []);
	const commitSidebarWidth = useCallback((value: number) => { setSidebarWidth(value); try { localStorage.setItem("skiff.sidebar.width", String(value)); } catch { /* Width still applies for this session. */ } }, []);
	const setVoyageWidthFromDrag = useCallback((value: number) => setVoyageWidth(value), []);
	const commitVoyageWidth = useCallback((value: number) => { setVoyageWidth(value); try { localStorage.setItem("skiff.voyage.width", String(value)); } catch { /* Width still applies for this session. */ } }, []);
	const archiveChat = useCallback((id: string) => {
		if (navigationDisabled || !pool.canClose(id)) return;
		const wasActive = activeChat?.id === id;
		library.archiveChat(id);
		if (wasActive) {
			setView("launcher");
			if (narrowViewport) setSidebarOpen(false);
		}
	}, [activeChat?.id, library, navigationDisabled, narrowViewport, pool.canClose]);
	const restoreArchivedChat = useCallback((id: string) => {
		if (locked || !pool.canClose(id)) return;
		library.restoreChat(id);
		setSettingsCategory(undefined);
		setView("chat");
		if (narrowViewport) setSidebarOpen(false);
	}, [library, locked, narrowViewport, pool.canClose]);
	const deleteArchivedChat = useCallback((id: string) => {
		if (navigationDisabled || !pool.canClose(id)) return;
		library.deleteChat(id);
	}, [library, navigationDisabled, pool.canClose]);
	// Permanent deletion removes the pi session file first: if the file cannot
	// be removed the chat stays visible instead of silently losing its history
	// while the transcript survives on disk.
	const purgeChat = useCallback(async (id: string) => {
		if (navigationDisabled || !pool.canClose(id)) return;
		const chat = allChats.find((item) => item.id === id);
		if (!chat) return;
		setPurgeError(undefined);
		if (chat.hasMessages && chat.sessionFile) {
			try { await invoke("delete_session_file", { sessionFile: chat.sessionFile }); }
			catch (error) { setPurgeError(`永久删除失败：${String(error)}`); return; }
		}
		if (activeChat?.id === id) setView("launcher");
		library.deleteChat(id);
	}, [activeChat?.id, allChats, library, navigationDisabled, pool.canClose]);
	// Hiding keeps every chat, session reference and draft so re-adding the same
	// folder later brings the whole group back.
	const hideProject = useCallback((id: string) => {
		if (navigationDisabled) return;
		const wasActive = activeChat?.projectId === id;
		library.hideProject(id);
		if (wasActive) {
			setView("launcher");
			if (narrowViewport) setSidebarOpen(false);
		}
	}, [activeChat?.projectId, library, navigationDisabled, narrowViewport]);
	const purgeProject = useCallback(async (id: string) => {
		if (navigationDisabled) return;
		const chats = allChats.filter((chat) => chat.projectId === id);
		if (!chats.every((chat) => pool.canClose(chat.id))) return;
		setPurgeError(undefined);
		const failures: string[] = [];
		for (const chat of chats) {
			if (!chat.hasMessages || !chat.sessionFile) continue;
			try { await invoke("delete_session_file", { sessionFile: chat.sessionFile }); }
			catch (error) { failures.push(`${chat.title}：${String(error)}`); }
		}
		// Partial deletion would leave a project pointing at half-removed files,
		// so the index survives and the user can retry.
		if (failures.length) { setPurgeError(`永久删除项目未完成，已保留项目与聊天索引。${failures.join("；")}`); return; }
		const wasActive = activeChat?.projectId === id;
		library.deleteProject(id);
		if (wasActive) setView("launcher");
	}, [activeChat?.projectId, allChats, library, navigationDisabled, pool.canClose]);
	const displayModels = useMemo(() => modelFamilies.fallback ? state.availableModels : orderedOffers.length ? reconcile(state.model, orderedOffers, state.availableModels) : [], [state.model, state.availableModels, orderedOffers, modelFamilies.fallback]);
	const displayModel = displayModels.find((model) => model.provider === state.model?.provider && model.id === state.model?.id) ?? (modelFamilies.fallback ? state.model : undefined);
	const pricingModels = useMemo(() => {
		if (modelFamilies.fallback) return state.availableModels;
		return orderedOffers.map((offer): ModelInfo => ({
			provider: offer.providerKey, id: offer.modelId, modelId: offer.modelId, name: offer.alias || offer.modelId, offerId: offer.offerId, routeId: offer.routeId, familyId: offer.familyId, familyName: offer.familyName, relayId: offer.relayId, providerName: offer.relayName,
			cost: { input: offer.inputCost, output: offer.outputCost, cacheRead: offer.cacheReadCost, cacheWrite: offer.cacheWriteCost }, currency: offer.currency,
		}));
	}, [orderedOffers, modelFamilies.fallback, state.availableModels]);
	const selectModel = useCallback(async (model: ModelInfo) => {
		const selected = await actions.setModel(model);
		if (selected && session.isCurrent() && model.offerId) setRecentOfferIds((ids) => rememberOffer(ids, model.offerId!, validOfferIds));
	}, [actions, session.isCurrent, validOfferIds]);
	const displayState = { ...state, model: displayModel, availableModels: displayModels };

	const openLauncher = useCallback(() => { void drafts.flush(); setSelectedProjectId(undefined); if (library.workspace) { setActiveTool("chats"); setActivePreviewId(undefined); setView("launcher"); if (window.innerWidth <= 760) setSidebarOpen(false); } }, [library.workspace]);
	const resumeChat = useCallback(() => { if (activeChat) setView("chat"); }, [activeChat]);
	const selectChat = useCallback((id: string) => {
		if (navigationDisabled) return;
		setSelectedProjectId(undefined);
		library.selectChat(id); setView("chat"); if (window.innerWidth <= 760) setSidebarOpen(false);
	}, [library, navigationDisabled]);
	const selectProject = useCallback((id: string) => {
		if (navigationDisabled) return;
		setSelectedProjectId(id);
		library.selectProject(id);
	}, [library, navigationDisabled]);
	const retrieval = useConversationSearch(visibleChats, library.workspace?.projects ?? [], pool.messages, activeChat?.id, session.loading ? undefined : session.owner.id, selectChat);
	const newDraft = useCallback(() => {
		if (navigationDisabled || !activeProject) return;
		setActiveTool("chats"); setActivePreviewId(undefined);
		void drafts.flush();
		setSelectedProjectId(undefined);
		// A saved chat can refer to a route that was removed or renamed since it
		// was last opened. New chats should inherit the model that is actually
		// active in the current session, rather than replaying that stale ID and
		// making pi reject the new session during startup.
		const inherited = activeChat?.selectedModel;
		const selectedModel = displayModel ? {
			provider: displayModel.provider,
			id: displayModel.id,
			modelId: displayModel.modelId ?? displayModel.id,
			...(displayModel.routeId ? { routeId: displayModel.routeId } : {}),
			...(displayModel.offerId ? { offerId: displayModel.offerId } : {}),
		} : inherited && (!inherited.provider.startsWith("skiff-") || modelFamilies.offers.some((offer) => offer.providerKey === inherited.provider && offer.modelId === (inherited.modelId ?? inherited.id))) ? inherited : undefined;
		// Reusing today's empty draft keeps its pi process alive. That process can
		// predate a relay/route change, so rebuild it around the chosen model like
		// the launcher path does instead of replaying a provider that pi rejects
		// with a fatal "Model not found".
		const reuseEmptyDraft = !!activeChat && activeChat.projectId === activeProject.id && !activeChat.hasMessages && !activeChat.hasDraft && !hasDraft(drafts.get(activeChat.id)) && pool.canClose(activeChat.id);
		library.createChat(activeProject.id, selectedModel, new Set(allChats.filter((chat) => !pool.canClose(chat.id) || hasDraft(drafts.get(chat.id))).map((chat) => chat.id)));
		if (reuseEmptyDraft) session.reconnect(selectedModel ? { provider: selectedModel.provider, id: selectedModel.id, modelId: selectedModel.modelId ?? selectedModel.id, ...(selectedModel.routeId ? { routeId: selectedModel.routeId } : {}), ...(selectedModel.offerId ? { offerId: selectedModel.offerId } : {}) } : undefined);
		setView("chat"); if (window.innerWidth <= 760) setSidebarOpen(false);
	}, [library, navigationDisabled, activeProject, activeChat, displayModel, modelFamilies.offers, allChats, pool.canClose, session.reconnect]);
	const startLauncherChat = useCallback(async (offer: RuntimeOffer) => {
		if (navigationDisabled || modelFamilies.loading) return;
		if (!activeProject) { setModelNotice("请先选择一个项目后再开始聊天"); return; }
		setSelectedProjectId(undefined);
		const selected = { provider: offer.providerKey, id: offer.modelId, modelId: offer.modelId, ...(offer.routeId ? { routeId: offer.routeId } : {}), ...(offer.offerId ? { offerId: offer.offerId } : {}) };
		// Reusing the active empty draft keeps its pi process alive. Apply the
		// explicitly chosen offer there before entering chat, just as the picker does.
		if (activeChat && !activeChat.hasMessages && !activeChat.hasDraft && !hasDraft(drafts.get(activeChat.id)) && activeChat.projectId === activeProject.id && !busy && !session.loading) {
			const model = displayModels.find((item) => item.provider === offer.providerKey && item.id === offer.modelId);
			if (!model) return;
			if (!await actions.setModel(model)) {
				// The recycled empty-draft pi process can predate this managed
				// provider (or be a spawn race that left it without credentials),
				// so it rejects set_model with "Model not found". Rebuild the
				// process around the chosen model instead of stranding the chat.
				library.createChat(activeProject.id, selected, new Set(allChats.filter((chat) => !pool.canClose(chat.id)).map((chat) => chat.id)));
				session.reconnect(model);
				setView("chat");
				return;
			}
		}
		if (!session.isCurrent()) return;
		library.createChat(activeProject.id, selected, new Set(allChats.filter((chat) => !pool.canClose(chat.id)).map((chat) => chat.id)));
		setView("chat");
	}, [activeChat, activeProject, actions, displayModels, library, navigationDisabled, modelFamilies.loading, busy, session.loading, session.isCurrent, allChats, pool.canClose, session.reconnect]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
			if ((isMacPlatform() ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === ",") {
				event.preventDefault(); openSettings(); return;
			}
			if (settingsCategory || document.querySelector("dialog[open]")) return;
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
				event.preventDefault();
				newDraft();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [newDraft, openSettings, settingsCategory]);

	const send = async (text: string, images?: ImageAttachment[], delivery?: Delivery) => {
		if (!activeChat) return false;
		if (!modelFamilies.fallback && !displayModel) { setModelNotice("请先在中转上配置路线并启用后再发送消息"); return false; }
		const accepted = await actions.prompt(text, images, delivery);
		if (accepted && displayModel?.offerId) pendingRecentOffer.current = { id: displayModel.offerId, assistantCount: state.messages.filter((message) => message.role === "assistant").length };
		if (accepted) library.updateChat(activeChat.id, { updatedAt: Date.now() });
		return accepted;
	};
	const selectTool = useCallback((tool: WorkbenchTool) => {
		if (tool === "files") tool = lastFileTab.current;
		if (activeTool === tool && sidebarOpen) { setSidebarOpen(false); return; }
		setActiveTool(tool); setSidebarOpen(true);
	}, [activeTool, sidebarOpen]);
	const openProjectChanges = useCallback(() => {
		setManualBrowseProjectId(undefined);
		setActiveTool(projectHasGit ? "git" : "files");
		setSidebarOpen(true);
	}, [projectHasGit]);
	const openProjectPreview = useCallback((project: Project, path: string, mode: PreviewMode) => {
		const name = path.replaceAll("\\", "/").split("/").pop() ?? path;
		setPreviewTabs((current) => openPreviewTab(current, { projectId: project.id, projectName: project.name, root: project.path, path, name, mode }).tabs);
		setActivePreviewId(previewId(project.id, path));
		if (narrowViewport) setSidebarOpen(false);
	}, [narrowViewport]);
	const openResultFile = useCallback((path: string) => {
		if (!activeProject) return;
		setManualBrowseProjectId(undefined);
		setActiveTool("files");
		if (!narrowViewport) setSidebarOpen(true);
		openProjectPreview(activeProject, path, "file");
	}, [activeProject, narrowViewport, openProjectPreview]);
	const resultNavigation = useMemo(() => activeProject ? { root: activeProject.path, label: projectHasGit ? "查看变更" : "查看文件", onOpen: openProjectChanges, onOpenFile: openResultFile } : undefined, [activeProject, projectHasGit, openProjectChanges, openResultFile]);
	const closeProjectPreview = useCallback((id: string) => {
		const index = previewTabs.findIndex((tab) => tab.id === id);
		const next = previewTabs.filter((tab) => tab.id !== id);
		setPreviewTabs(next);
		setActivePreviewId((active) => active === id ? next[Math.min(index, next.length - 1)]?.id : active);
	}, [previewTabs]);

	// Selecting a channel updates the current session immediately; the dialog
	// only needs to close, because changing the configuration must never restart
	// a running conversation.
	const familyContext = useMemo(() => ({
		configurationHint: undefined,
		models: displayModels,
		pricingModels,
		current: displayModel,
		select: selectModel,
		familyOf: (model: ModelInfo) => {
			// Route keys are opaque: resolve the family through the offers first.
			const offer = modelFamilies.offers.find((offer) => (model.offerId && offer.offerId === model.offerId) || (model.routeId && offer.routeId === model.routeId && offer.modelId === model.id) || (offer.providerKey === model.provider && offer.modelId === model.id));
			if (offer) return { id: offer.familyId, name: offer.familyName };
			const owner = familyFromProvider(model.provider);
			if (!owner) return undefined;
			const family = modelFamilies.families.find((item) => item.id === owner.id);
			return { id: owner.id, name: family?.displayName ?? owner.label };
		},
		manage: () => openSettings("providers"),
	}), [modelFamilies.offers, modelFamilies.families, displayModels, displayModel, selectModel, pricingModels, openSettings]);

	// The header belongs to the chat column so the rail divider can run from the
	// title bar to the bottom edge, the way Codex splits its panes. The folder mark
	// names the owning project only on hover, so the title line stays short.
	const headerProject = currentView === "launcher" ? undefined : activeProject;
	const chatHeader = (
		<header className="chat-header">
			{headerProject && <Tooltip text={headerProject.name} align="start"><span className="header-project" role="img" aria-label={`所属项目：${headerProject.name}`}><Icon name="folder" size={16} /></span></Tooltip>}
			<div className="header-title">
				<div className="header-title-row"><span title={currentView !== "launcher" && activeChat ? conversationTooltip(activeChat) : undefined}>{currentView === "launcher" ? "主页" : activeChat ? conversationLabel(activeChat) : "新聊天"}</span></div>
				{currentView === "launcher" && <span className="header-subtitle">模型优先的任务入口</span>}
			</div>
			<div className="header-actions">{busy && <span className="working"><span className="dot busy" />{state.isStreaming ? "运行中" : "等待响应"}</span>}</div>
		</header>
	);
	const workspaceAlerts = <>
		{retrieval.notice && <div className="workspace-alert" role="status">{retrieval.notice}<Button variant="ghost" onClick={retrieval.closeNotice}>关闭</Button></div>}
		{library.error && <div className="workspace-alert" role="alert"><span>{library.error}</span><Button variant="ghost" onClick={library.workspace ? library.clearError : () => void library.initialize()} disabled={library.loading}>{library.workspace ? "关闭" : "重试"}</Button></div>}
		{purgeError && <div className="workspace-alert" role="alert"><span>{purgeError}</span><Button variant="ghost" onClick={() => setPurgeError(undefined)}>关闭</Button></div>}
		{currentView === "launcher" && (session.loading || (!connected && state.lastError)) && <div className="workspace-alert" role={session.loading ? "status" : "alert"} aria-label={session.loading ? "正在加载会话" : undefined}><span>{session.loading ? "正在加载会话…" : state.lastError}</span>{!session.loading && <Button variant="ghost" onClick={() => session.reconnect()}>重新连接</Button>}</div>}
	</>;

	return (
		<ModelFamilyContext.Provider value={familyContext}>
		{pool.runtimes}
		<div className={`app ${sidebarOpen ? "with-sidebar" : ""}`}>
			<TitleBar nav={<TitleBarNav sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((value) => !value)} onNewChat={newDraft} onHome={openLauncher} onAddProject={() => setProjectDialogOpen(true)} onOpenSettings={openSettings} messages={state.messages} />} voyageOpen={voyageExpanded} onToggleVoyage={currentView === "chat" ? toggleVoyagePanel : undefined}><SettingsMenu restrictions={settingsRestrictions} onOpen={openSettings} /></TitleBar>
			<div className="app-body" style={{ "--sidebar-width": `${shownSidebarWidth}px` } as CSSProperties}>
			{(!narrowViewport || !sidebarOpen) && <ActivityBar active={activeTool} panelOpen={sidebarOpen} onSelect={selectTool} />}
			<div className="workbench-shell">
			{sidebarOpen && !(narrowViewport && settingsCategory) && <SidebarPresentation activityBar={<ActivityBar active={activeTool} panelOpen={sidebarOpen} onSelect={selectTool} />} onClose={() => setSidebarOpen(false)}>{activeTool === "chats" ? <Sidebar projects={shownProjects} chats={visibleChats} activeId={activeChat?.id} selectedProjectId={selectedProjectId} disabled={navigationDisabled} runningIds={pool.runningIds} canCloseChat={pool.canClose} navigationDisabled={navigationDisabled} connected={connected} onNewChat={newDraft} statuses={pool.statuses} searchProgress={retrieval.progress} searchQuery={retrieval.query} onSearch={retrieval.setQuery} onSearchMatch={retrieval.openMatch} onSelectChat={selectChat} onSelectProject={selectProject} onAddProject={() => setProjectDialogOpen(true)} onRenameChat={library.renameChat} onRenameProject={library.renameProject} onDeleteChat={deleteArchivedChat} onHideProject={hideProject} onPurgeProject={purgeProject} onArchiveChat={archiveChat} onPurgeChat={purgeChat} onTogglePinChat={(id, pinned) => library.updateChat(id, { pinned })} /> : <ProjectWorkbenchPanel history={<GitBranches key={browse.project?.path} history={gitHistory} onSelect={(reference) => { gitHistory.selectRef(reference); if (narrowViewport) setSidebarOpen(false); }} />} tool={activeTool} onSelectTab={setActiveTool} projects={shownProjects} project={browse.project} following={!browse.manualProjectId} onSelectProject={setManualBrowseProjectId} onFollow={() => setManualBrowseProjectId(undefined)} onAddProject={() => setProjectDialogOpen(true)} onOpen={openProjectPreview} onMutated={() => setWorkbenchRevision((value) => value + 1)} />}</SidebarPresentation>}
			{desktopSidebarOpen && <ResizeSeparator label="调整左侧导航宽度" value={shownSidebarWidth} bounds={sidebarBounds} onResize={setSidebarWidthFromDrag} onCommit={commitSidebarWidth} />}
			<ProjectChangesNavigationContext.Provider value={resultNavigation}>
			<main className="workspace">
				<div className={`primary-view ${activeTool !== "chats" ? "preview-hidden" : ""}`}>{currentView === "launcher" ? <>{chatHeader}{workspaceAlerts}<div className="body"><LauncherView activeChat={activeChat} activeProject={activeProject} projects={shownProjects} chats={visibleChats} offers={modelFamilies.offers} recentOfferIds={recentOfferIds} disabled={navigationDisabled || modelFamilies.loading} navigationDisabled={navigationDisabled} loading={modelFamilies.loading} error={modelFamilies.error} onResume={resumeChat} onSelectProject={selectProject} onAddProject={() => setProjectDialogOpen(true)} onManageProviders={() => openSettings("providers")} onRetryModels={modelFamilies.refresh} onStartChat={startLauncherChat} onOpenChat={selectChat} /></div></> : <VoyageWorkspace topBar={<>{chatHeader}{workspaceAlerts}</>} draftTarget={activeChat && activeProject ? { chatId: activeChat.id, cwd: activeProject.path, sessionFile: activeChat.hasMessages ? activeChat.sessionFile : undefined } : undefined} revealMessage={retrieval.reveal} modelNotice={modelNotice} key={`${session.owner.id ?? "loading"}:${session.owner.cwd ?? ""}`} state={displayState} loading={session.loading} connected={connected} pending={session.pending} actions={actions} onSend={send} onReconnect={session.reconnect} projectName={activeProject?.name} failover={failover} routeAuthorization={routeAuthorizationPrompt} railWidth={shownVoyageWidth} availableWidth={workspaceWidth} onRailWidth={setVoyageWidthFromDrag} onRailWidthCommit={commitVoyageWidth} expanded={voyageExpanded} onToggle={toggleVoyagePanel} />}</div>
				{activeTool === "git-tree" && <GitTreeWorkspace key={browse.project?.path} project={browse.project} history={gitHistory} onBack={() => { setActiveTool("chats"); setActivePreviewId(undefined); }} onBranches={() => setSidebarOpen((value) => !value)} />}
				{(activeTool === "files" || activeTool === "git") && (activePreviewId ? <ProjectPreview tabs={previewTabs} activeId={activePreviewId} revision={workbenchRevision} onActivate={setActivePreviewId} onClose={closeProjectPreview} onMode={(id, mode) => setPreviewTabs((current) => current.map((tab) => tab.id === id ? { ...tab, mode } : tab))} onBack={() => setActiveTool("chats")} /> : <FileWorkspaceEmpty project={browse.project} />)}
			</main>
			</ProjectChangesNavigationContext.Provider>
			</div>
			</div>
			{retrieval.historyView && <HistorySearchDialog {...retrieval.historyView} onClose={retrieval.closeHistory} />}
			{shownProjects.length > MAX_PROJECTS ? <ProjectListLimit projects={shownProjects} onRemove={(ids) => { for (const id of ids) library.hideProject(id); }} /> : projectDialogOpen && <ProjectDialog projects={shownProjects} onAdd={library.addProject} onClose={() => setProjectDialogOpen(false)} />}
			{settingsCategory && <SettingsDialog onRetryModels={() => void modelFamilies.refresh()} initialCategory={settingsCategory} prompt={{ sessionPath: session.sessionFile, onSaved: () => { setSettingsCategory(undefined); session.reconnect(); } }} restrictions={settingsRestrictions} providers={{ configError: modelFamilies.error, relays: modelFamilies.relays, families: modelFamilies.families, usdCnyRate: modelFamilies.usdCnyRate, onPreviewBatch: modelFamilies.previewRelayBatch, onBatch: modelFamilies.batchRelays, onSaveRelay: modelFamilies.saveRelay, onDeleteRelay: modelFamilies.deleteRelay, onSetRelayEnabled: modelFamilies.setRelayEnabled, onTest: modelFamilies.test, onCancelTest: modelFamilies.cancelTest, onDiscover: modelFamilies.discover, onCreateFamily: modelFamilies.createFamily }} models={{ configError: modelFamilies.error, families: modelFamilies.families, relays: modelFamilies.relays, onTest: modelFamilies.test, onCancelTest: modelFamilies.cancelTest }} routes={{ configError: modelFamilies.error, families: modelFamilies.families, relays: modelFamilies.relays, autoFailover: modelFamilies.config?.autoFailover ?? false, usdCnyRate: modelFamilies.usdCnyRate, onSaveRate: modelFamilies.setUsdCnyRate, onSaveRoute: modelFamilies.saveRoute, onDeleteRoute: modelFamilies.deleteRoute, onReorderRoutes: modelFamilies.reorderRoutes, onAutoFailover: modelFamilies.setAutoFailover }} archives={{ chats: archivedChats, projects: library.workspace?.projects ?? [], busy: locked, canClose: pool.canClose, onRestore: restoreArchivedChat, onDelete: deleteArchivedChat }} search={search} onClose={() => setSettingsCategory(undefined)} />}
		</div>
		</ModelFamilyContext.Provider>
	);
}
