import { Button, IconButton } from "./ui";
import { Icon } from "./Icon";
import { useRef, useState } from "react";
import type { ChatMessage, ImageAttachment, SessionState } from "../chat/types";
import type { TextAttachment } from "../chat/textAttachments";
import { isProviderFailure } from "../chat/modelFamilies";
import { useModelFamily } from "../chat/familyContext";
import type { PiSessionActions } from "../chat/usePiSession";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import type { WebSearchControls } from "../chat/webSearch";
import { billingAccountLabel, type RouteAuthorizationChoice, type RouteAuthorizationRequest } from "../chat/routeAuthorization";

/** Transcript + notices + composer. */
export function ChatView({
	state,
	loading = false,
	connected,
	actions,
	pending,
	projectName,
	search,
	onConfigureSearch,
	onSend,
	onReconnect,
	failover,
	routeAuthorization,
}: {
	state: SessionState;
	loading?: boolean;
	connected: boolean;
	actions: PiSessionActions;
	pending: boolean;
	projectName?: string;
	search: WebSearchControls;
	onConfigureSearch: () => void;
	onSend: (text: string, images?: ImageAttachment[]) => Promise<boolean>;
	onReconnect: () => void;
	/** A same-family channel that can take over after a provider error. */
	failover?: { label: string; switch: (automatic?: boolean) => void };
	routeAuthorization?: { request: RouteAuthorizationRequest; onChoice: (choice: RouteAuthorizationChoice) => void };
}) {
	const [draft, setDraft] = useState("");
	const { manage } = useModelFamily();
	const [editing, setEditing] = useState<ChatMessage>();
	const [restoredImages, setRestoredImages] = useState<ImageAttachment[]>([]);
	const [restoredFiles, setRestoredFiles] = useState<TextAttachment[]>([]);
	const [focusSignal, setFocusSignal] = useState(0);
	const [followSignal, setFollowSignal] = useState(0);
	const latest = useRef({ messages: state.messages, model: state.model, onSend });
	latest.current = { messages: state.messages, model: state.model, onSend };
	const disabled = !connected || pending || state.isStreaming;
	const cancelEdit = () => { setEditing(undefined); setDraft(""); setRestoredImages([]); setRestoredFiles([]); };
	const send = async (text: string, images?: ImageAttachment[]) => {
		if (editing) { if (!await actions.rewind(editing.id)) return false; setEditing(undefined); }
		setFollowSignal((n) => n + 1);
		const accepted = await onSend(text, images);
		return accepted;
	};
	const alerts = state.notices.filter((notice) => notice.kind !== "info");

	return (
		<section className="chat">
			{loading ? <div className="session-loading" role="status" aria-label="正在加载会话"><span className="dot busy" />正在加载会话…</div> : <MessageList messages={state.messages} pendingPrompt={state.pendingPrompt} activeTurnId={state.activeRun?.turnId} projectName={projectName} running={state.isStreaming} models={state.availableModels} model={state.model} onSuggestion={(text) => { setDraft(text); setFocusSignal((n) => n + 1); }} followSignal={followSignal} />}
			{alerts.length > 0 && (
				<div className="notices">
					{alerts.slice(-3).map((notice) => (
						<div key={notice.id} className={`notice ${notice.kind}`}>
							{notice.text}
						</div>
					))}
				</div>
			)}
			{routeAuthorization && (
				<div className="banner route-authorization" role="alert">
					<div className="route-authorization-copy">
						<strong>线路切换需要确认</strong>
						<span>{routeAuthorization.request.source.relayName} → {routeAuthorization.request.target.relayName} · {routeAuthorization.request.target.modelId}</span>
						<small>目标扣费账户：{billingAccountLabel(routeAuthorization.request.target)}</small>
					</div>
					<div className="route-authorization-actions">
						<Button variant="primary" size="primary" onClick={() => routeAuthorization.onChoice("once")}>同意</Button>
						<Button  onClick={() => routeAuthorization.onChoice("session")}>本次会话都同意</Button>
						<Button variant="ghost" onClick={() => routeAuthorization.onChoice("keep_failed")}>保持失败</Button>
					</div>
				</div>
			)}
			{state.lastError && (
				<div className={`banner error ${connected && isProviderFailure(state.lastError) ? "provider-toast" : ""}`} role="alert"><span>{state.lastError}</span>{failover && <Button variant="ghost" disabled={disabled} onClick={() => failover.switch()}>切换到同家族下一个可用提供商（{failover.label}）</Button>}{!connected ? <Button variant="ghost" onClick={() => onReconnect()}>重新连接</Button> : <IconButton onClick={actions.clearError} aria-label="关闭错误提示"><Icon name="close" /></IconButton>}</div>
			)}
			{connected && !state.availableModels.length && <div className="notice model-notice">暂无已启用的提供商，请添加或启用提供商。<Button variant="ghost" onClick={manage}>管理提供商…</Button></div>}
			<Composer
				disabled={!connected || pending || !state.model || !state.availableModels.length}
				streaming={state.isStreaming}
				onSend={send}
				onAbort={actions.abort}
				text={draft}
				onTextChange={setDraft}
				models={state.availableModels}
				model={state.model}
				onSelectModel={actions.setModel}
				connected={connected}
				modelDisabled={!connected || pending || state.isStreaming}
				thinkingLevel={state.thinkingLevel}
				thinkingLevels={state.thinkingLevels ?? []}
				onThinkingLevel={actions.setThinkingLevel}
				focusSignal={focusSignal}
				restoredImages={restoredImages}
				restoredFiles={restoredFiles}
				editing={!!editing}
				onCancelEdit={cancelEdit}
				getCommands={actions.getCommands}
				search={search}
				onConfigureSearch={onConfigureSearch}
			/>
		</section>
	);
}
