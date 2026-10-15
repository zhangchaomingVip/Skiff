import type { Delivery } from "../chat/interactions";
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ImageAttachment, SessionState } from "../chat/types";
import type { PiSessionActions } from "../chat/usePiSession";
import { useVoyageMetrics } from "../chat/useVoyageMetrics";
import { LiveTurnContext } from "../chat/liveTurnContext";
import type { WebSearchControls } from "../chat/webSearch";
import type { DraftTarget } from "../chat/useDraft";
import type { MessageReveal } from "../chat/useConversationSearch";
import { ChatView } from "./ChatView";
import { ContextUsage } from "./ContextUsage";
import { VoyageRail } from "./VoyageRail";
import { useModelFamily } from "../chat/familyContext";
import type { RouteAuthorizationChoice, RouteAuthorizationRequest } from "../chat/routeAuthorization";
import { Dialog } from "./ui";
import { ResizeSeparator } from "./ResizeSeparator";

const StableChatView = memo(ChatView);

export function VoyageWorkspace({ draftTarget, revealMessage, state, loading = false, connected, pending, actions, onSend, onReconnect, projectName, search, onConfigureSearch, failover, modelNotice, routeAuthorization, railWidth = 260, availableWidth = window.innerWidth, onRailWidth, onRailWidthCommit }: {
	draftTarget?: DraftTarget;
	revealMessage?: MessageReveal;
	modelNotice?: string;
	state: SessionState;
	loading?: boolean;
	connected: boolean;
	pending: boolean;
	actions: PiSessionActions;
	onSend: (text: string, images?: ImageAttachment[], delivery?: Delivery) => Promise<boolean>;
	onReconnect: () => void;
	projectName?: string;
	search: WebSearchControls;
	onConfigureSearch: () => void;
	failover?: { label: string; switch: (automatic?: boolean) => void };
	routeAuthorization?: { request: RouteAuthorizationRequest; onChoice: (choice: RouteAuthorizationChoice) => void };
	railWidth?: number;
	availableWidth?: number;
	onRailWidth?: (width: number) => void;
	onRailWidthCommit?: (width: number) => void;
}) {
	const { pricingModels } = useModelFamily();
	const measured = useVoyageMetrics(state.messages, state.model, state.isStreaming, pricingModels ?? state.availableModels, state.activeRun, state.lastError, state.lastOutcome?.reason === "manual" ? state.voyageTimeline?.key : undefined, state.voyageTimeline, state.contextUsage);
	const metrics = { ...measured, status: state.lastOutcome?.reason === "manual" && !state.isStreaming ? "已停止" : measured.status };
	const [expanded, setExpanded] = useState(() => window.innerWidth >= 1200);
	const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 1199px)");
		const resize = (event: MediaQueryListEvent) => setExpanded(!event.matches);
		const compact = window.matchMedia("(max-width: 760px)");
		const updateCompact = () => setNarrow(compact.matches);
		query.addEventListener("change", resize);
		compact.addEventListener("change", updateCompact);
		return () => { query.removeEventListener("change", resize); compact.removeEventListener("change", updateCompact); };
	}, []);
	const toggle = () => setExpanded((value) => !value);
	const hasRoom = narrow || availableWidth >= 608;
	const visibleExpanded = expanded && hasRoom;
	const railBounds = { min: 240, max: Math.max(240, Math.min(480, availableWidth - 368)) };
	const shownRailWidth = Math.max(240, Math.min(railWidth, railBounds.max));

	const layout = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const root = layout.current;
		const workspace = root?.closest<HTMLElement>(".workspace");
		const composer = root?.querySelector<HTMLElement>(".composer");
		if (!root || !workspace || !composer) return;
		// Follow the actual centered content, including rail/sidebar resizing.
		const align = () => workspace.style.setProperty("--chat-content-inset", `${composer.getBoundingClientRect().left - workspace.getBoundingClientRect().left}px`);
		const observer = new ResizeObserver(align);
		observer.observe(root);
		const column = root.querySelector(".chat-column");
		if (column) observer.observe(column);
		observer.observe(composer);
		align();
		return () => { observer.disconnect(); workspace.style.removeProperty("--chat-content-inset"); };
	}, []);

	return <div ref={layout} className={`chat-and-rail ${visibleExpanded ? "rail-expanded" : "rail-collapsed"}`} style={{ "--voyage-width": `${shownRailWidth}px` } as CSSProperties}>
		<div className="chat-column">
			<LiveTurnContext.Provider value={metrics.liveTurn}>
				<StableChatView draftTarget={draftTarget} revealMessage={revealMessage} state={state} loading={loading} connected={connected} pending={pending} actions={actions} onSend={onSend} onReconnect={onReconnect} projectName={projectName} search={search} onConfigureSearch={onConfigureSearch} failover={failover} routeAuthorization={routeAuthorization} />
			</LiveTurnContext.Provider>
			<ContextUsage notice={modelNotice} metrics={metrics} expanded={visibleExpanded} onToggle={toggle} />
		</div>
		{visibleExpanded && !narrow && onRailWidth && onRailWidthCommit && <ResizeSeparator label="调整右侧航行台宽度" value={shownRailWidth} bounds={railBounds} direction={-1} onResize={onRailWidth} onCommit={onRailWidthCommit} />}
		{narrow && expanded ? <Dialog className="voyage-dialog" aria-label="航行台详情" returnFocusSelector=".voyage-summary" onClose={() => setExpanded(false)}><VoyageRail metrics={metrics} expanded onToggle={toggle} /></Dialog> : <VoyageRail metrics={metrics} expanded={visibleExpanded} onToggle={toggle} />}
	</div>;
}
