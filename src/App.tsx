import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePiSession } from "./chat/usePiSession";
import { showVoyageIcon } from "./taskbarIcon";
import { useWorkspace } from "./chat/workspace";
import { useModelFamilies } from "./chat/useModelFamilies";
import { ModelFamilyContext } from "./chat/familyContext";
import { familyFromProvider, modelBrand } from "./chat/modelDisplay";
import { classifyProviderFailure, nextRoute, reconcile, resolveSelection, type RouteRequirements, type RuntimeOffer } from "./chat/modelFamilies";
import type { ModelInfo } from "./chat/types";
import { billingAccountLabel, createRouteAuthorizationState, requestRouteSwitch, resolveRouteAuthorization, type AuthorizationRoute, type RouteAuthorizationChoice } from "./chat/routeAuthorization";
import { snapshotsForMessages } from "./chat/routeSnapshot";
import { createRouteEvent, type AuditRouteRef, type RouteEvent } from "./chat/routeAudit";
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
import { loadRecentOffers, normalizeRecentOfferIds, rememberOffer, saveRecentOffers } from "./chat/recentOffers";

export default function App() {
	const library = useWorkspace();
	const { activeChat, activeProject } = library;
	const modelFamilies = useModelFamilies();
	const session = usePiSession(activeChat && activeProject ? { id: activeChat.id, cwd: activeProject.path, sessionFile: activeChat.hasMessages ? activeChat.sessionFile : undefined, elapsedMs: activeChat.elapsedMs, model: activeChat.selectedModel, routeSnapshots: activeChat.routeSnapshots } : undefined, modelFamilies.offers);
	const { state, connected, rawLines, actions } = session;
	const [modelNotice, setModelNotice] = useState<string>();
	const [routeAuthorization, setRouteAuthorization] = useState(() => createRouteAuthorizationState("none"));
	const [routeEvents, setRouteEvents] = useState<RouteEvent[]>([]);
	const routeAuthorizationContext = useRef<{ requestId: string; automatic: boolean; failureKind: ReturnType<typeof classifyProviderFailure> }>();
	useEffect(() => { setRouteAuthorization(createRouteAuthorizationState(activeChat?.id ?? "none")); }, [activeChat?.id]);
	useEffect(() => { setRouteEvents(activeChat?.routeEvents ?? []); routeAuthorizationContext.current = undefined; }, [activeChat?.id]);
	const fallbackNoticeRef = useRef("");
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
	const pendingRecentOffer = useRef<{ id: string; assistantCount: number }>();
	const requestRequirements = useRef<RouteRequirements>({});
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
	useEffect(() => { void showVoyageIcon(busy).catch(() => undefined); }, [busy]);
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
			...(state.model ? (() => {
				const offer = modelFamilies.offers.find((item) => (state.model?.routeId && item.routeId === state.model.routeId && item.modelId === state.model.id) || (item.providerKey === state.model?.provider && item.modelId === state.model.id));
				const selectedModel = { provider: state.model.provider, id: state.model.id, modelId: state.model.modelId ?? state.model.id, ...(offer?.routeId ? { routeId: offer.routeId } : state.model.routeId ? { routeId: state.model.routeId } : {}), ...(offer?.offerId ? { offerId: offer.offerId } : state.model.offerId ? { offerId: state.model.offerId } : {}) };
				const current = activeChat.selectedModel;
				return current?.provider !== selectedModel.provider || current.id !== selectedModel.id || current.routeId !== selectedModel.routeId || current.offerId !== selectedModel.offerId ? { selectedModel } : {};
			})() : {}),
		});
	}, [activeChat?.id, activeChat?.selectedModel, session.loadedId, session.sessionFile, state.messages, state.model, session.elapsedMs, modelFamilies.offers]);
	const routeSnapshots = useMemo(() => snapshotsForMessages(state.messages), [state.messages]);
	const routeSnapshotsJson = useMemo(() => JSON.stringify(routeSnapshots), [routeSnapshots]);
	const savedRouteSnapshots = useRef("");
	useEffect(() => { savedRouteSnapshots.current = ""; }, [activeChat?.id]);
	useEffect(() => {
		if (!activeChat || session.loadedId !== activeChat.id || savedRouteSnapshots.current === routeSnapshotsJson) return;
		savedRouteSnapshots.current = routeSnapshotsJson;
		library.updateChat(activeChat.id, { routeSnapshots });
	}, [activeChat?.id, session.loadedId, routeSnapshots, routeSnapshotsJson, library]);
	const routeEventsJson = useMemo(() => JSON.stringify(routeEvents), [routeEvents]);
	const savedRouteEvents = useRef("");
	useEffect(() => { savedRouteEvents.current = ""; }, [activeChat?.id]);
	useEffect(() => {
		if (!activeChat || session.loadedId !== activeChat.id || savedRouteEvents.current === routeEventsJson) return;
		savedRouteEvents.current = routeEventsJson;
		library.updateChat(activeChat.id, { routeEvents });
	}, [activeChat?.id, session.loadedId, routeEvents, routeEventsJson, library]);

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
		if (resolved.invalidated) {
			const noticeKey = `${activeChat?.id ?? ""}:${state.model?.routeId ?? state.model?.provider ?? ""}:${selected?.routeId ?? "none"}`;
			if (fallbackNoticeRef.current !== noticeKey) {
				fallbackNoticeRef.current = noticeKey;
				setModelNotice(selected ? `当前模型已失效，已切换到 ${selected.familyName} · ${selected.relayName} · ${selected.modelId}` : "当前模型已失效，请先在中转上配置线路");
			}
		} else fallbackNoticeRef.current = "";
		session.reconnect(selected ? { provider: selected.providerKey, id: selected.modelId, modelId: selected.modelId, routeId: selected.routeId, offerId: selected.offerId, familyId: selected.familyId, familyName: selected.familyName, relayId: selected.relayId } : state.model && !familyFromProvider(state.model.provider) ? state.model : undefined);
	}, [activeChat?.id, connected, busy, modelFamilies.loading, modelFamilies.config, modelFamilies.offers, modelFamilies.families, state.model, session.reconnect]);

	const displayModels = useMemo(() => modelFamilies.fallback ? state.availableModels : orderedOffers.length ? reconcile(state.model, orderedOffers, state.availableModels, modelFamilies.families) : [], [state.model, state.availableModels, orderedOffers, modelFamilies.families, modelFamilies.fallback]);
	const displayModel = displayModels.find((model) => model.provider === state.model?.provider && model.id === state.model?.id) ?? (modelFamilies.fallback ? state.model : undefined);
	const pricingModels = useMemo(() => {
		if (modelFamilies.fallback) return state.availableModels;
		return orderedOffers.map((offer): ModelInfo => ({
			provider: offer.providerKey, id: offer.modelId, modelId: offer.modelId, name: offer.alias || offer.modelId, offerId: offer.offerId, routeId: offer.routeId, familyId: offer.familyId, familyName: offer.familyName, relayId: offer.relayId, providerName: offer.relayName,
			cost: { input: offer.inputCost, output: offer.outputCost, cacheRead: offer.cacheReadCost, cacheWrite: offer.cacheWriteCost }, currency: offer.currency,
		}));
	}, [orderedOffers, modelFamilies.fallback, state.availableModels]);
	const selectModel = useCallback(async (model: ModelInfo) => {
		setRouteAuthorization((current) => ({ ...current, pending: undefined }));
			const currentModel = state.model;
			const sourceOffer = currentModel && modelFamilies.offers.find((item) => (currentModel.routeId && item.routeId === currentModel.routeId && item.modelId === currentModel.id) || (item.providerKey === currentModel.provider && item.modelId === currentModel.id));
			const targetOffer = model.offerId ? modelFamilies.offers.find((item) => item.offerId === model.offerId) : modelFamilies.offers.find((item) => item.providerKey === model.provider && item.modelId === model.id);
		const selected = await actions.setModel(model);
			if (selected && model.offerId) setRecentOfferIds((ids) => rememberOffer(ids, model.offerId ?? "", validOfferIds));
			if (selected && sourceOffer && targetOffer && sourceOffer.offerId !== targetOffer.offerId) {
				const source = routeFromOffer(sourceOffer);
				const target = routeFromOffer(targetOffer);
				setRouteEvents((events) => [...events, createRouteEvent({ sessionId: activeChat?.id ?? "", requestId: `manual:${Date.now()}`, source: { offerId: source.offerId, routeId: source.routeId, familyId: source.familyId, modelId: source.modelId, relayName: source.relayName, billingAccountId: source.billingAccountId ?? undefined }, target: { offerId: target.offerId, routeId: target.routeId, familyId: target.familyId, modelId: target.modelId, relayName: target.relayName, billingAccountId: target.billingAccountId ?? undefined }, authorization: "none", automatic: false, retried: false, result: "switched" })].slice(-100));
			}
		}, [actions, activeChat?.id, modelFamilies.offers, state.model, validOfferIds]);
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
		requestRequirements.current = { streaming: true, tools: state.model?.tools === true, reasoning: state.model?.reasoning === true, vision: !!images?.length || state.model?.vision === true };
		const accepted = await actions.prompt(text, images);
		if (!accepted) requestRequirements.current = {};
		if (accepted && displayModel?.offerId) pendingRecentOffer.current = { id: displayModel.offerId, assistantCount: state.messages.filter((message) => message.role === "assistant").length };
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
			const offer = modelFamilies.offers.find((offer) => (model.offerId && offer.offerId === model.offerId) || (model.routeId && offer.routeId === model.routeId && offer.modelId === model.id) || (offer.providerKey === model.provider && offer.modelId === model.id));
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
	const routeFromOffer = (offer: RuntimeOffer): AuthorizationRoute => ({ familyId: offer.familyId, familyName: offer.familyName, modelId: offer.modelId, offerId: offer.offerId, routeId: offer.routeId, relayName: offer.relayName, billingAccountId: offer.billingAccountId });
	const sourceRoute = useMemo<AuthorizationRoute | undefined>(() => {
		if (!state.model) return undefined;
		const offer = modelFamilies.offers.find((item) => (state.model?.routeId && item.routeId === state.model.routeId && item.modelId === state.model.id) || (item.providerKey === state.model?.provider && item.modelId === state.model.id));
		return offer ? routeFromOffer(offer) : { familyId: state.model.familyId, familyName: state.model.familyName, modelId: state.model.modelId ?? state.model.id, offerId: state.model.offerId, routeId: state.model.routeId, relayName: state.model.providerName ?? state.model.provider, billingAccountId: undefined };
	}, [modelFamilies.offers, state.model]);
	const modelForOffer = (offer: RuntimeOffer): ModelInfo => ({ provider: offer.providerKey, id: offer.modelId, modelId: offer.modelId, routeId: offer.routeId, offerId: offer.offerId, familyId: offer.familyId, familyName: offer.familyName, relayId: offer.relayId });
	const auditRoute = (route: AuthorizationRoute): AuditRouteRef => ({ offerId: route.offerId, routeId: route.routeId, familyId: route.familyId, modelId: route.modelId, relayName: route.relayName, billingAccountId: route.billingAccountId ?? undefined });
	const recordRouteEvent = useCallback((source: AuthorizationRoute | undefined, target: AuthorizationRoute | undefined, requestId: string, failureKind: ReturnType<typeof classifyProviderFailure> | undefined, authorization: RouteEvent["authorization"], automatic: boolean, result: RouteEvent["result"]) => {
		setRouteEvents((events) => [...events, createRouteEvent({ sessionId: activeChat?.id ?? "", requestId, source: source ? auditRoute(source) : undefined, target: target ? auditRoute(target) : undefined, failureKind, authorization, automatic, retried: false, result })].slice(-100));
	}, [activeChat?.id]);
	const applyAuthorizedSwitch = useCallback(async (target: AuthorizationRoute, model: ModelInfo, authorization: "same_route" | "same_account" | "session" | "once") => {
		if (!await actions.setModel(model)) return false;
		setModelNotice(authorization === "same_account" ? `已静默切换到 ${target.relayName}（同一扣费账户：${billingAccountLabel(target)}）` : `已切换到 ${target.relayName} · ${target.modelId}（已获得线路授权）`);
		return true;
	}, [actions]);
	const authorizeFailover = useCallback((offer: RuntimeOffer, automatic = false) => {
		if (!sourceRoute) return;
		const model = modelForOffer(offer);
		const targetRoute = routeFromOffer(offer);
		const failureKind = classifyProviderFailure(state.lastError ?? "");
		const transition = requestRouteSwitch(routeAuthorization, sourceRoute, targetRoute);
		setRouteAuthorization(transition.state);
		if (transition.effect.kind === "allow") {
			const effect = transition.effect;
			const authorization = effect.authorization === "same_route" ? "none" : effect.authorization;
			void applyAuthorizedSwitch(effect.target, model, effect.authorization).then((switched) => recordRouteEvent(sourceRoute, targetRoute, `${activeChat?.id ?? ""}:${Date.now()}`, failureKind, authorization, automatic, switched ? "switched" : "failed"));
		}
		else if (transition.effect.kind === "prompt") routeAuthorizationContext.current = { requestId: transition.effect.prompt.request.requestId, automatic, failureKind };
		else if (transition.effect.kind === "deny" || transition.effect.kind === "stale") setModelNotice(transition.effect.systemMessage);
	}, [activeChat?.id, applyAuthorizedSwitch, recordRouteEvent, routeAuthorization, sourceRoute, state.lastError]);
	const resolveAuthorization = useCallback((requestId: string, choice: RouteAuthorizationChoice) => {
		const transition = resolveRouteAuthorization(routeAuthorization, requestId, choice);
		setRouteAuthorization(transition.state);
		const effect = transition.effect;
		if (effect.kind === "allow") {
			const offer = modelFamilies.offers.find((item) => item.offerId === effect.target.offerId);
			const context = routeAuthorizationContext.current?.requestId === requestId ? routeAuthorizationContext.current : undefined;
			if (offer) {
				const authorization = effect.authorization === "same_route" ? "none" : effect.authorization;
				void applyAuthorizedSwitch(effect.target, modelForOffer(offer), effect.authorization).then((switched) => recordRouteEvent(effect.source, effect.target, requestId, context?.failureKind, authorization, context?.automatic ?? false, switched ? "switched" : "failed"));
			}
			else setModelNotice("目标线路已失效，请重新选择可用线路。");
		}
		else if (effect.kind === "deny") {
			const context = routeAuthorizationContext.current?.requestId === requestId ? routeAuthorizationContext.current : undefined;
			recordRouteEvent(effect.source, effect.target, requestId, context?.failureKind, "keep_failed", context?.automatic ?? false, "denied");
			setModelNotice(effect.systemMessage);
		}
		else if (effect.kind === "stale") setModelNotice(effect.systemMessage);
		if (routeAuthorizationContext.current?.requestId === requestId) routeAuthorizationContext.current = undefined;
	}, [applyAuthorizedSwitch, modelFamilies.offers, recordRouteEvent, routeAuthorization]);
	const failover = useMemo(() => {
		if (!state.lastError || !state.model || classifyProviderFailure(state.lastError) === "non_retryable") return undefined;
		const next = nextRoute(state.model, modelFamilies.offers, requestRequirements.current);
		if (!next) return undefined;
		return { label: `${next.relayName} · ${next.modelId}`, switch: (automatic = false) => authorizeFailover(next, automatic) };
	}, [state.lastError, state.model, modelFamilies.offers, authorizeFailover]);
	const autoSwitchRef = useRef<{ chatId: string; requestId: string; attempted: boolean }>();
	useEffect(() => {
		const users = state.messages.filter((message) => message.role === "user");
		const requestId = users[users.length - 1]?.id ?? `messages-${state.messages.length}`;
		if (!activeChat) return;
		if (autoSwitchRef.current?.chatId !== activeChat.id || autoSwitchRef.current.requestId !== requestId) autoSwitchRef.current = { chatId: activeChat.id, requestId, attempted: false };
		if (!state.lastError || classifyProviderFailure(state.lastError) === "non_retryable" || !modelFamilies.config?.autoFailover || !failover || busy || !connected || autoSwitchRef.current.attempted) return;
		autoSwitchRef.current.attempted = true;
		failover.switch(true);
	}, [activeChat?.id, failover, modelFamilies.config?.autoFailover, state.lastError, state.messages, busy, connected]);
	const routeAuthorizationPrompt = routeAuthorization.sessionId === (activeChat?.id ?? "none") && routeAuthorization.pending ? {
		request: routeAuthorization.pending,
		onChoice: (choice: RouteAuthorizationChoice) => resolveAuthorization(routeAuthorization.pending?.requestId ?? "", choice),
	} : undefined;

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
						{displayModel && <span className="header-model" title={`${familyContext.familyOf(displayModel)?.name ?? displayModel.provider} · ${displayModel.providerName ?? displayModel.provider} · ${displayModel.id}`}><span>{familyContext.familyOf(displayModel)?.name ?? displayModel.provider}</span><span className="header-model-sep">·</span><span>{displayModel.name ?? displayModel.id}</span><span className="header-model-sep">·</span><span>{displayModel.providerName ?? displayModel.provider}</span></span>}
					</div>
					<div className="header-actions">{busy && <span className="working"><span className="dot busy" />正在处理</span>}<ThemeToggle /><button className="icon-btn" onClick={() => setPromptDialogOpen(true)} disabled={busy} title="系统提示词" aria-label="系统提示词"><Icon name="message" /></button><button className="icon-btn" onClick={() => setProviderDialogOpen(true)} disabled={busy} title="配置提供商" aria-label="配置提供商"><Icon name="settings" /></button><button className={`icon-btn ${rawOpen ? "active" : ""}`} onClick={() => setRawOpen((open) => !open)} title="诊断日志" aria-label="诊断日志" aria-pressed={rawOpen}><Icon name="code" /></button></div>
				</header>
				{library.error && <div className="workspace-alert" role="alert"><span>{library.error}</span><button className="btn ghost" onClick={library.workspace ? library.clearError : () => void library.initialize()} disabled={library.loading}>{library.workspace ? "关闭" : "重试"}</button></div>}
				<div className="body">
					<VoyageWorkspace modelNotice={modelNotice} key={activeChat?.id ?? "loading"} state={displayState} connected={connected} pending={session.pending} actions={actions} onSend={send} onReconnect={session.reconnect} projectName={activeProject?.name} search={search} onConfigureSearch={() => setSearchDialogOpen(true)} failover={failover} routeAuthorization={routeAuthorizationPrompt} />
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
