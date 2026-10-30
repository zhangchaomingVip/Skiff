import type { Delivery } from "../chat/interactions";
import { memo, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { ImageAttachment, SessionState } from "../chat/types";
import type { PiSessionActions } from "../chat/usePiSession";
import { useVoyageMetrics } from "../chat/useVoyageMetrics";
import { LiveTurnContext } from "../chat/liveTurnContext";
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

/**
 * Voyage rail visibility. The dashboard stays closed until the title bar
 * toggle opens it; crossing the desktop breakpoint still collapses and
 * restores the rail so it never squeezes a narrow workspace.
 */
export function useVoyagePanel() {
	const [expanded, setExpanded] = useState(false);
	const toggle = useCallback(() => setExpanded((value) => !value), []);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 1199px)");
		const resize = (event: MediaQueryListEvent) => setExpanded(!event.matches);
		query.addEventListener("change", resize);
		return () => query.removeEventListener("change", resize);
	}, []);
	return [expanded, toggle] as const;
}

export function VoyageWorkspace({ draftTarget, revealMessage, state, loading = false, connected, pending, actions, onSend, onReconnect, projectName, failover, modelNotice, routeAuthorization, railWidth = 260, availableWidth = window.innerWidth, onRailWidth, onRailWidthCommit, topBar, expanded: controlledExpanded, onToggle }: {
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
	failover?: { label: string; switch: (automatic?: boolean) => void };
	routeAuthorization?: { request: RouteAuthorizationRequest; onChoice: (choice: RouteAuthorizationChoice) => void };
	railWidth?: number;
	availableWidth?: number;
	onRailWidth?: (width: number) => void;
	onRailWidthCommit?: (width: number) => void;
	/** Chat column header and notices; kept inside the column so the rail divider runs full height. */
	topBar?: ReactNode;
	expanded?: boolean;
	onToggle?: () => void;
}) {
	const { pricingModels } = useModelFamily();
	const measured = useVoyageMetrics(state.messages, state.model, state.isStreaming, pricingModels ?? state.availableModels, state.activeRun, state.lastError, state.lastOutcome?.reason === "manual" ? state.voyageTimeline?.key : undefined, state.voyageTimeline, state.contextUsage);
	const metrics = { ...measured, status: state.lastOutcome?.reason === "manual" && !state.isStreaming ? "已停止" : measured.status };
	const [ownExpanded, toggleOwn] = useVoyagePanel();
	const expanded = controlledExpanded ?? ownExpanded;
	const toggle = onToggle ?? toggleOwn;
	const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
	useEffect(() => {
		const compact = window.matchMedia("(max-width: 760px)");
		const updateCompact = () => setNarrow(compact.matches);
		compact.addEventListener("change", updateCompact);
		return () => compact.removeEventListener("change", updateCompact);
	}, []);
	const hasRoom = narrow || availableWidth >= 608;
	const visibleExpanded = expanded && hasRoom;
	const railBounds = { min: 240, max: Math.max(240, Math.min(480, availableWidth - 368)) };
	const shownRailWidth = Math.max(240, Math.min(railWidth, railBounds.max));

	return <div className={`chat-and-rail ${visibleExpanded ? "rail-expanded" : "rail-collapsed"}`} style={{ "--voyage-width": `${shownRailWidth}px` } as CSSProperties}>
		<div className="chat-column">
			{topBar}
			<LiveTurnContext.Provider value={metrics.liveTurn}>
				<StableChatView draftTarget={draftTarget} revealMessage={revealMessage} state={state} loading={loading} connected={connected} pending={pending} actions={actions} onSend={onSend} onReconnect={onReconnect} projectName={projectName} failover={failover} routeAuthorization={routeAuthorization} />
			</LiveTurnContext.Provider>
			<ContextUsage notice={modelNotice} metrics={metrics} />
		</div>
		{visibleExpanded && !narrow && onRailWidth && onRailWidthCommit && <ResizeSeparator label="调整右侧航行台宽度" value={shownRailWidth} bounds={railBounds} direction={-1} onResize={onRailWidth} onCommit={onRailWidthCommit} />}
		{narrow && expanded ? <Dialog className="voyage-dialog" aria-label="航行台详情" returnFocusSelector=".titlebar-tools button" onClose={toggle}><VoyageRail metrics={metrics} onCollapse={toggle} /></Dialog> : visibleExpanded && <VoyageRail metrics={metrics} />}
	</div>;
}
