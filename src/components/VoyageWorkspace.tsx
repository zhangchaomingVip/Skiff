import { memo, useEffect, useState } from "react";
import type { ImageAttachment, SessionState } from "../chat/types";
import type { PiSessionActions } from "../chat/usePiSession";
import { useVoyageMetrics } from "../chat/useVoyageMetrics";
import type { WebSearchControls } from "../chat/webSearch";
import { ChatView } from "./ChatView";
import { ContextUsage } from "./ContextUsage";
import { VoyageRail } from "./VoyageRail";

const StableChatView = memo(ChatView);

export function VoyageWorkspace({ state, connected, pending, actions, onSend, onReconnect, projectName, search, onConfigureSearch }: {
	state: SessionState;
	connected: boolean;
	pending: boolean;
	actions: PiSessionActions;
	onSend: (text: string, images?: ImageAttachment[]) => Promise<boolean>;
	onReconnect: () => void;
	projectName?: string;
	search: WebSearchControls;
	onConfigureSearch: () => void;
}) {
	const metrics = useVoyageMetrics(state.messages, state.model, state.isStreaming);
	const [expanded, setExpanded] = useState(() => window.innerWidth >= 900);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 899px)");
		const resize = (event: MediaQueryListEvent) => setExpanded(!event.matches);
		query.addEventListener("change", resize);
		return () => query.removeEventListener("change", resize);
	}, []);
	const toggle = () => setExpanded((value) => !value);

	return <div className={`chat-and-rail ${expanded ? "rail-expanded" : "rail-collapsed"}`}>
		<div className="chat-column">
			<StableChatView state={state} connected={connected} pending={pending} actions={actions} onSend={onSend} onReconnect={onReconnect} projectName={projectName} search={search} onConfigureSearch={onConfigureSearch} />
			<ContextUsage metrics={metrics} expanded={expanded} onToggle={toggle} />
		</div>
		<VoyageRail metrics={metrics} expanded={expanded} onToggle={toggle} />
	</div>;
}
