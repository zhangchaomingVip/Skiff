import { useCallback, useRef, useState } from "react";
import type { ChatMessage, ImageAttachment, SessionState } from "../chat/types";
import { turnDraft, userForTurn } from "../chat/turns";
import { appendTextFiles, type TextAttachment } from "../chat/textAttachments";
import { isProviderFailure } from "../chat/modelFamilies";
import { useModelFamily } from "../chat/familyContext";
import type { PiSessionActions } from "../chat/usePiSession";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ConfirmDialog } from "./ConfirmDialog";
import type { WebSearchControls } from "../chat/webSearch";

/** Transcript + notices + composer. */
export function ChatView({
	state,
	connected,
	actions,
	pending,
	projectName,
	search,
	onConfigureSearch,
	onSend,
	onReconnect,
	failover,
}: {
	state: SessionState;
	connected: boolean;
	actions: PiSessionActions;
	pending: boolean;
	projectName?: string;
	search: WebSearchControls;
	onConfigureSearch: () => void;
	onSend: (text: string, images?: ImageAttachment[]) => Promise<boolean>;
	onReconnect: () => void;
	/** A same-family channel that can take over after a provider error. */
	failover?: { label: string; switch: () => void };
}) {
	const [draft, setDraft] = useState("");
	const { manage } = useModelFamily();
	const [editing, setEditing] = useState<ChatMessage>();
	const [deleting, setDeleting] = useState<ChatMessage>();
	const [restoredImages, setRestoredImages] = useState<ImageAttachment[]>([]);
	const [restoredFiles, setRestoredFiles] = useState<TextAttachment[]>([]);
	const [focusSignal, setFocusSignal] = useState(0);
	const [followSignal, setFollowSignal] = useState(0);
	const latest = useRef({ messages: state.messages, model: state.model, onSend });
	latest.current = { messages: state.messages, model: state.model, onSend };
	const disabled = !connected || pending || state.isStreaming;
	const edit = useCallback((message: ChatMessage) => {
		const content = turnDraft(message);
		setEditing(message); setDraft(content.text); setRestoredImages(content.images); setRestoredFiles(content.files); setFocusSignal((n) => n + 1);
	}, []);
	const cancelEdit = () => { setEditing(undefined); setDraft(""); setRestoredImages([]); setRestoredFiles([]); };
	const regenerate = useCallback(async (message: ChatMessage) => {
		const user = userForTurn(latest.current.messages, message.id);
		if (!user) return;
		const content = turnDraft(user);
		if (content.images.length && !latest.current.model?.input?.includes("image")) { edit(user); return; }
		if (!await actions.rewind(message.id)) return;
		if (await latest.current.onSend(appendTextFiles(content.text, content.files), content.images)) setFollowSignal((n) => n + 1);
		else { setDraft(content.text); setRestoredImages(content.images); setRestoredFiles(content.files); }
	}, [actions, edit]);
	const remove = useCallback(async (message: ChatMessage) => {
		if (await actions.rewind(message.id)) { setEditing(undefined); setDraft(""); setRestoredImages([]); setRestoredFiles([]); }
	}, [actions]);
	const send = async (text: string, images?: ImageAttachment[]) => {
		if (editing) { if (!await actions.rewind(editing.id)) return false; setEditing(undefined); }
		const accepted = await onSend(text, images);
		if (accepted) setFollowSignal((n) => n + 1);
		return accepted;
	};
	const continueTurn = useCallback(async () => { if (await onSend("继续")) setFollowSignal((n) => n + 1); }, [onSend]);
	const alerts = state.notices.filter((notice) => notice.kind !== "info");

	return (
		<section className="chat">
			<MessageList messages={state.messages} projectName={projectName} running={state.isStreaming} models={state.availableModels} model={state.model} onSuggestion={(text) => { setDraft(text); setFocusSignal((n) => n + 1); }} followSignal={followSignal} disabled={disabled} onContinue={continueTurn} onEdit={edit} onRegenerate={regenerate} onDelete={setDeleting} />
			{deleting && <ConfirmDialog title="删除本轮及后续消息" description="本轮提问及之后的所有消息将从当前聊天移除，原 pi 会话文件会保留。" onConfirm={() => void remove(deleting)} onClose={() => setDeleting(undefined)} />}
			{alerts.length > 0 && (
				<div className="notices">
					{alerts.slice(-3).map((notice) => (
						<div key={notice.id} className={`notice ${notice.kind}`}>
							{notice.text}
						</div>
					))}
				</div>
			)}
			{state.lastError && (
				<div className={`banner error ${connected && isProviderFailure(state.lastError) ? "provider-toast" : ""}`} role="alert"><span>{state.lastError}</span>{failover && <button className="btn ghost" disabled={disabled} onClick={failover.switch}>切换到同家族下一个可用提供商（{failover.label}）</button>}{!connected ? <button className="btn ghost" onClick={() => onReconnect()}>重新连接</button> : <button className="icon-btn" onClick={actions.clearError} aria-label="关闭错误提示">×</button>}</div>
			)}
			{connected && !state.availableModels.length && <div className="notice model-notice">暂无已启用的提供商，请添加或启用提供商。<button className="btn ghost" onClick={manage}>管理提供商…</button></div>}
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
