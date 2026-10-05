import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePiSession } from "./chat/usePiSession";
import { useWorkspace } from "./chat/workspace";
import { useModelFamilies } from "./chat/useModelFamilies";
import { ModelFamilyContext } from "./chat/familyContext";
import { familyFromProvider, modelBrand } from "./chat/modelDisplay";
import { isProviderFailure, nextRoute, reconcile, resolveSelection } from "./chat/modelFamilies";
import type { ModelInfo } from "./chat/types";
import { VoyageWorkspace } from "./components/VoyageWorkspace";
import { RawDrawer } from "./components/RawDrawer";
import { Sidebar } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { ProjectDialog } from "./components/ProjectDialog";
import { Icon } from "./components/Icon";
import { ThemeToggle } from "./components/ThemeToggle";
import type { ImageAttachment } from "./chat/types";
import { FamiliesSettings } from "./components/FamiliesSettings";
import { PromptDialog } from "./components/PromptDialog";
import { SearchDialog } from "./components/SearchDialog";
import { useWebSearch } from "./chat/webSearch";

export default function App() {
	const library = useWorkspace();
	const { activeChat, activeProject } = library;
	const session = usePiSession(activeChat && activeProject ? { id: activeChat.id, cwd: activeProject.path, sessionFile: activeChat.hasMessages ? activeChat.sessionFile : undefined, elapsedMs: activeChat.elapsedMs, model: activeChat.selectedModel } : undefined);
	const { state, connected, rawLines, actions } = session;
	const modelFamilies = useModelFamilies();
	const [modelNotice, setModelNotice] = useState<string>();
	useEffect(() => {
		if (!modelNotice) return;
		const timer = window.setTimeout(() => setModelNotice(undefined), 8000);
		return () => window.clearTimeout(timer);
	}, [modelNotice]);
	const [rawOpen, setRawOpen] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(() => { try { return localStorage.getItem("skiff.sidebar.open") !== "false"; } catch { return true; } });
	useEffect(() => { try { localStorage.setItem("skiff.sidebar.open", String(sidebarOpen)); } catch { /* Layout can still be used without storage. */ } }, [sidebarOpen]);
	const [projectDialogOpen, setProjectDialogOpen] = useState(false);
	const [providerDialogOpen, setProviderDialogOpen] = useState(false);
	const [promptDialogOpen, setPromptDialogOpen] = useState(false);
	const [searchDialogOpen, setSearchDialogOpen] = useState(false);
	const search = useWebSearch(actions, connected, session.reconnect);
	const busy = state.isStreaming || session.pending;
	const locked = busy || (!!activeChat && !connected && !state.lastError);

	useEffect(() => {
		if (!activeChat || session.loadedId !== activeChat.id) return;
		const firstUser = state.messages.find((m) => m.role === "user");
		const title = firstUser?.blocks.filter((b) => b.kind === "text").map((b) => b.kind === "text" ? b.text : "").join(" ").replace(/\s+/g, " ").trim() || (firstUser ? "图片聊天" : "");
		library.updateChat(activeChat.id, {
			...(session.sessionFile ? { sessionFile: session.sessionFile } : {}),
			hasMessages: !!firstUser,
			...(!activeChat.customTitle ? { title: title ? title.slice(0, 48) : "新聊天" } : {}),
			elapsedMs: session.elapsedMs,
			...(state.model && (activeChat.selectedModel?.provider !== state.model.provider || activeChat.selectedModel?.id !== state.model.id) ? { selectedModel: { provider: state.model.provider, id: state.model.id } } : {}),
		});
	}, [activeChat?.id, session.loadedId, session.sessionFile, state.messages, state.model, session.elapsedMs]);

	// pi reads channel configuration at startup. Refresh idle sessions after
	// migration or edits, preserving the current transcript and selected channel.
	const appliedConfig = useRef<{ config: typeof modelFamilies.config; chatId?: string }>();
	useEffect(() => {
		if (!connected || busy || modelFamilies.loading || !modelFamilies.config || (appliedConfig.current?.config === modelFamilies.config && appliedConfig.current?.chatId === activeChat?.id)) return;
		appliedConfig.current = { config: modelFamilies.config, chatId: activeChat?.id };
		const offers = modelFamilies.offers;
		const currentFamily = familyFromProvider(state.model?.provider)?.id ?? modelBrand(state.model?.id, state.model?.provider);
		const resolved = resolveSelection(state.model, offers, currentFamily, modelFamilies.families);
		const selected = resolved.offer;
		if (resolved.invalidated) setModelNotice(selected ? `当前模型已失效，已切换到 ${selected.familyName} · ${selected.relayName} · ${selected.modelId}` : "当前模型已失效，请先在中转上配置线路");
		session.reconnect(selected ? { provider: selected.providerKey, id: selected.modelId } : state.model && !familyFromProvider(state.model.provider) ? state.model : undefined);
	}, [activeChat?.id, connected, busy, modelFamilies.loading, modelFamilies.config, modelFamilies.offers, modelFamilies.families, state.model, session.reconnect]);

	const displayModels = useMemo(() => modelFamilies.fallback ? state.availableModels : modelFamilies.offers.length ? reconcile(state.model, modelFamilies.offers, state.availableModels, modelFamilies.families) : [], [state.model, state.availableModels, modelFamilies.offers, modelFamilies.families, modelFamilies.fallback]);
	const displayModel = displayModels.find((model) => model.provider === state.model?.provider && model.id === state.model?.id) ?? (modelFamilies.fallback ? state.model : undefined);
	const pricingModels = useMemo(() => {
		if (modelFamilies.fallback) return state.availableModels;
		return modelFamilies.offers.map((offer): ModelInfo => ({
			provider: offer.providerKey, id: offer.modelId, name: offer.modelId, providerName: offer.relayName,
			cost: { input: offer.inputCost, output: offer.outputCost }, currency: offer.currency,
		}));
	}, [modelFamilies.offers, modelFamilies.fallback, state.availableModels]);
	const selectModel = useCallback((model: ModelInfo) => void actions.setModel(model), [actions]);
	const displayState = { ...state, model: displayModel, availableModels: displayModels };

	const createChat = () => { if (!locked) library.createChat(); };
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
				event.preventDefault();
				createChat();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [locked, activeProject?.id, library.workspace]);

	const send = async (text: string, images?: ImageAttachment[]) => {
		if (!activeChat) return false;
		if (!modelFamilies.fallback && !displayModel) { setModelNotice("请先在中转上配置线路并启用后再发送消息"); return false; }
		const accepted = await actions.prompt(text, images);
		if (accepted) library.updateChat(activeChat.id, { updatedAt: Date.now() });
		return accepted;
	};

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
			const offer = modelFamilies.offers.find((offer) => offer.providerKey === model.provider && offer.modelId === model.id);
			if (offer) return { id: offer.familyId, name: offer.familyName };
			const owner = familyFromProvider(model.provider);
			if (!owner) return undefined;
			const family = modelFamilies.families.find((item) => item.id === owner.id);
			return { id: owner.id, name: family?.displayName ?? owner.label };
		},
		manage: () => setProviderDialogOpen(true),
	}), [modelFamilies.offers, modelFamilies.families, displayModels, displayModel, selectModel, pricingModels]);

	// A provider error offers the next route of the same family that serves the
	// same model; the setting decides whether that switch happens on its own.
	const failover = useMemo(() => {
		if (!state.lastError || !state.model || !isProviderFailure(state.lastError)) return undefined;
		const next = nextRoute(state.model, modelFamilies.offers);
		if (!next) return undefined;
		return { label: `${next.relayName} · ${next.modelId}`, switch: () => void actions.setModel({ provider: next.providerKey, id: next.modelId }) };
	}, [state.lastError, state.model, modelFamilies.offers, actions]);
	const autoSwitchRef = useRef("");
	useEffect(() => {
		if (!state.lastError) { autoSwitchRef.current = ""; return; }
		if (!modelFamilies.config?.autoFailover || !failover || busy || !connected) return;
		if (autoSwitchRef.current === state.lastError) return;
		autoSwitchRef.current = state.lastError;
		failover.switch();
	}, [failover, modelFamilies.config?.autoFailover, state.lastError, busy, connected]);

	return (
		<ModelFamilyContext.Provider value={familyContext}>
		<div className={`app ${sidebarOpen ? "with-sidebar" : ""}`}>
			<TitleBar />
			<div className="app-body">
			{sidebarOpen && <Sidebar projects={library.workspace?.projects ?? []} chats={library.workspace?.chats ?? []} activeId={activeChat?.id} activeProjectId={activeProject?.id} disabled={locked || !library.workspace} connected={connected} onNewChat={createChat} onSelectChat={library.selectChat} onSelectProject={library.selectProject} onAddProject={() => setProjectDialogOpen(true)} onClose={() => setSidebarOpen(false)} onRenameChat={library.renameChat} onRenameProject={library.renameProject} onDeleteChat={library.deleteChat} onDeleteProject={library.deleteProject} onTogglePinChat={(id, pinned) => library.updateChat(id, { pinned })} />}
			<main className="workspace">
				<header className="chat-header">
					{!sidebarOpen && <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="展开侧栏" aria-label="展开侧栏"><Icon name="panel" /></button>}
					<div className="header-title">
						<div className="header-title-row"><span>{activeChat?.title ?? "新聊天"}</span>{activeProject && <span className="header-project" title={activeProject.path}><Icon name="folder" size={14} />{activeProject.name}</span>}</div>
						{displayModel && <span className="header-model" title={`${familyContext.familyOf(displayModel)?.name ?? displayModel.provider} · ${displayModel.providerName ?? displayModel.provider} · ${displayModel.id}`}><span>{familyContext.familyOf(displayModel)?.name ?? displayModel.provider}</span><span className="header-model-sep">·</span><span>{displayModel.id}</span></span>}
					</div>
					<div className="header-actions">{busy && <span className="working"><span className="dot busy" />正在处理</span>}<ThemeToggle /><button className="icon-btn" onClick={() => setPromptDialogOpen(true)} disabled={busy} title="系统提示词" aria-label="系统提示词"><Icon name="message" /></button><button className="icon-btn" onClick={() => setProviderDialogOpen(true)} disabled={busy} title="配置提供商" aria-label="配置提供商"><Icon name="settings" /></button><button className={`icon-btn ${rawOpen ? "active" : ""}`} onClick={() => setRawOpen((open) => !open)} title="诊断日志" aria-label="诊断日志" aria-pressed={rawOpen}><Icon name="code" /></button></div>
				</header>
				{library.error && <div className="workspace-alert" role="alert"><span>{library.error}</span><button className="btn ghost" onClick={library.workspace ? library.clearError : () => void library.initialize()} disabled={library.loading}>{library.workspace ? "关闭" : "重试"}</button></div>}
				<div className="body">
					<VoyageWorkspace modelNotice={modelNotice} key={activeChat?.id ?? "loading"} state={displayState} connected={connected} pending={session.pending} actions={actions} onSend={send} onReconnect={session.reconnect} projectName={activeProject?.name} search={search} onConfigureSearch={() => setSearchDialogOpen(true)} failover={failover} />
					{rawOpen && <div className="raw-panel"><button className="icon-btn raw-close" onClick={() => setRawOpen(false)} aria-label="关闭诊断日志"><Icon name="close" /></button><RawDrawer lines={rawLines} /></div>}
				</div>
			</main>
			</div>
			{projectDialogOpen && <ProjectDialog onAdd={library.addProject} onClose={() => setProjectDialogOpen(false)} />}
			{providerDialogOpen && <FamiliesSettings configError={modelFamilies.error} families={modelFamilies.families} relays={modelFamilies.relays} autoFailover={modelFamilies.config?.autoFailover ?? false} usdCnyRate={modelFamilies.usdCnyRate} onSaveRate={modelFamilies.setUsdCnyRate} onSaveRelay={modelFamilies.saveRelay} onDeleteRelay={modelFamilies.deleteRelay} onSetRelayEnabled={modelFamilies.setRelayEnabled} onSaveRoute={modelFamilies.saveRoute} onDeleteRoute={modelFamilies.deleteRoute} onReorderRoutes={modelFamilies.reorderRoutes} onSetDefaultRoute={modelFamilies.setDefaultRoute} onAutoFailover={modelFamilies.setAutoFailover} onTest={modelFamilies.test} onDiscover={modelFamilies.discover} onClose={() => setProviderDialogOpen(false)} />}
			{promptDialogOpen && <PromptDialog sessionPath={session.sessionFile} onSaved={() => { setPromptDialogOpen(false); session.reconnect(); }} onClose={() => setPromptDialogOpen(false)} />}
			{searchDialogOpen && <SearchDialog savedKeyHint={search.keyHint} search={search} onSaved={() => { search.refresh(); }} onClose={() => setSearchDialogOpen(false)} />}
		</div>
		</ModelFamilyContext.Provider>
	);
}
