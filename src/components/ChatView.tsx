import { CopyButton } from "./CopyButton";
import { ExtensionDialog } from "./ExtensionDialog";
import { turnDraft } from "../chat/turns";
import { draftAttachments, type DraftRecord } from "../chat/drafts";
import { outcomeLabel, queueSize, type Delivery } from "../chat/interactions";
import { Button, IconButton } from "./ui";
import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ImageAttachment, SessionState } from "../chat/types";
import type { TextAttachment } from "../chat/textAttachments";
import { isProviderFailure } from "../chat/modelFamilies";
import { useModelFamily } from "../chat/familyContext";
import type { PiSessionActions } from "../chat/usePiSession";
import { useDraft, type DraftTarget } from "../chat/useDraft";
import type { MessageReveal } from "../chat/useConversationSearch";
import { Composer } from "./Composer";
import { QueuedMessages } from "./QueuedMessages";
import { MessageList } from "./MessageList";
import { billingAccountLabel, type RouteAuthorizationChoice, type RouteAuthorizationRequest } from "../chat/routeAuthorization";

/** Transcript + notices + composer. */
export function ChatView({
	state,
	loading = false,
	connected,
	actions,
	pending,
	projectName,
	onSend,
	onReconnect,
	failover,
	routeAuthorization,
	draftTarget,
	revealMessage,
}: {
	draftTarget?: DraftTarget;
	revealMessage?: MessageReveal;
	state: SessionState;
	loading?: boolean;
	connected: boolean;
	actions: PiSessionActions;
	pending: boolean;
	projectName?: string;
	onSend: (text: string, images?: ImageAttachment[], delivery?: Delivery) => Promise<boolean>;
	onReconnect: () => void;
	/** A same-family channel that can take over after a provider error. */
	failover?: { label: string; switch: (automatic?: boolean) => void };
	routeAuthorization?: { request: RouteAuthorizationRequest; onChoice: (choice: RouteAuthorizationChoice) => void };
}) {
	const [localDraft, setLocalDraft] = useState("");
	const storedDraft = useDraft(draftTarget);
	const draft = draftTarget ? storedDraft.text : localDraft;
	const setDraft = draftTarget ? storedDraft.onText : setLocalDraft;
	const { manage } = useModelFamily();
	const [editing, setEditing] = useState<ChatMessage>();
	const [restoredImages, setRestoredImages] = useState<ImageAttachment[]>([]);
	const [restoredFiles, setRestoredFiles] = useState<TextAttachment[]>([]);
	const [focusSignal, setFocusSignal] = useState(0);
	const [followSignal, setFollowSignal] = useState(0);
	const [editNotice, setEditNotice] = useState<string>();
	const [editPending, setEditPending] = useState(false);
	const [continuing, setContinuing] = useState(false);
	const [deferredDialog, setDeferredDialog] = useState<string>();
	const fallbackEdit = useRef<DraftRecord["edit"]>();
	const edit = draftTarget ? storedDraft.record?.edit : fallbackEdit.current;
	const latestEdit = useRef(edit); latestEdit.current = edit;
	const mounted = useRef(true);
	const loggedMissingModel = useRef(false);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
	// Log once when the session settles into "offers exist but no current model",
	// which means the runtime projection did not reach pi. The matching banner above
	// gives the user a reconnect action; the log keeps the diagnostic discoverable.
	const missingModel = connected && !loading && !pending && !state.isStreaming && state.availableModels.length > 0 && !state.model;
	useEffect(() => {
		if (missingModel && !loggedMissingModel.current) {
			loggedMissingModel.current = true;
			console.error("[skiff] offers present but no current model; pi likely started without providers", { model: state.model, availableModels: state.availableModels.length });
		} else if (!missingModel) {
			loggedMissingModel.current = false;
		}
	}, [missingModel, state.model, state.availableModels.length]);
	const canEdit = connected && !pending && !state.isStreaming && !state.activeRun && !state.stopping && !queueSize(state.queue) && !editPending;
	const degradeEdit = () => {
		setEditing(undefined); fallbackEdit.current = undefined;
		if (draftTarget) storedDraft.update({ edit: undefined });
		setEditNotice("聊天分支或消息已变化，已转为普通草稿；发送将追加到当前分支。");
	};
	useEffect(() => {
		if (!edit || !connected || loading) return;
		let cancelled = false;
		void actions.validateEdit(edit.target, edit.branchVersion).then((id) => {
			if (cancelled || latestEdit.current !== edit) return;
			if (id) setEditing(state.messages.find((message) => message.id === id)); else degradeEdit();
		}).catch(() => { if (!cancelled && latestEdit.current === edit) degradeEdit(); });
		return () => { cancelled = true; };
	}, [connected, loading, edit?.branchVersion, actions.validateEdit]);
	const beginEdit = async (message: ChatMessage) => {
		if (!canEdit) return;
		setEditPending(true);
		try {
			const context = await actions.captureEdit(message.id);
			if (!mounted.current || !context) { if (mounted.current) setEditNotice("无法确认消息所在分支，请重新载入后再试。"); return; }
			const previous = edit?.previous ?? { text: draft, attachments: draftTarget ? storedDraft.attachments : draftAttachments(restoredImages, restoredFiles) };
			const content = turnDraft(message);
			const metadata = { ...context, previous };
			if (draftTarget) storedDraft.update({ text: content.text, attachments: draftAttachments(content.images, content.files), edit: metadata });
			else { fallbackEdit.current = metadata; setDraft(content.text); setRestoredImages(content.images); setRestoredFiles(content.files); }
			setEditing(message); setEditNotice(undefined); setFocusSignal((n) => n + 1);
		} finally { if (mounted.current) setEditPending(false); }
	};
	const continueRun = async () => {
		if (continuing || state.stopping) return;
		setContinuing(true);
		try { await onSend("请从刚才停止的位置继续，避免重复已输出的内容。"); } finally { if (mounted.current) setContinuing(false); }
	};
	const disabled = !connected || pending || state.isStreaming;
	const cancelEdit = () => {
		const previous = edit?.previous;
		setEditing(undefined); fallbackEdit.current = undefined;
		if (draftTarget) storedDraft.update({ text: previous?.text ?? "", attachments: previous?.attachments ?? [], edit: undefined });
		else { setDraft(previous?.text ?? ""); setRestoredImages([]); setRestoredFiles([]); }
	};
	const send = async (text: string, images?: ImageAttachment[], delivery?: Delivery) => {
		if (edit) {
			let id: string | undefined;
			try { id = await actions.validateEdit(edit.target, edit.branchVersion); } catch { /* degrade safely */ }
			if (!id) { degradeEdit(); return false; }
			if (!await actions.rewind(id, edit, draftTarget ? storedDraft.rebase : undefined)) return false;
			setEditing(undefined); fallbackEdit.current = undefined;
			if (draftTarget) storedDraft.update({ edit: undefined });
		}
		setFollowSignal((n) => n + 1);
		const accepted = await onSend(text, images, delivery);
		return accepted;
	};
	const alerts = state.notices;

	return (
		<section className="chat">
			{loading ? <div className="session-loading" role="status" aria-label="正在加载会话"><span className="dot busy" />正在加载会话…</div> : <MessageList runStartedAt={state.activeRun?.startedAt} retryAttempts={state.retryAttempts} messages={state.messages} pendingPrompt={state.pendingPrompt} activeTurnId={state.activeRun?.turnId} projectName={projectName} running={state.isStreaming} models={state.availableModels} model={state.model} onSuggestion={(text) => { setDraft(text); setFocusSignal((n) => n + 1); }} followSignal={followSignal} revealMessage={revealMessage} onEdit={canEdit ? beginEdit : undefined} onContinue={continueRun} continuing={continuing} lastOutcome={state.lastOutcome} />}
			{alerts.length > 0 && (
				<div className="notices">
					{alerts.slice(-3).map((notice) => (
						<div key={notice.id} className={`notice ${notice.kind}`}>
							<Icon name={notice.kind === "info" ? "info" : "alert"} size={14} />
							<span>{notice.text}</span>
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
			{state.lastError && !state.retrying && !(state.isStreaming && isProviderFailure(state.lastError)) && (
				<div className={`banner error ${connected && isProviderFailure(state.lastError) ? "provider-toast" : ""}`} role="alert"><span>{state.lastError}</span>{failover && <Button variant="ghost" disabled={disabled} onClick={() => failover.switch()}>切换到同家族下一个可用提供商（{failover.label}）</Button>}{!connected ? <Button variant="ghost" onClick={() => onReconnect()}>重新连接</Button> : <IconButton onClick={actions.clearError} aria-label="关闭错误提示"><Icon name="close" /></IconButton>}</div>
			)}
			{connected && !state.availableModels.length && <div className="notice model-notice">暂无已启用的提供商，请添加或启用提供商。<Button variant="ghost" onClick={manage}>管理提供商…</Button></div>}
			{/* Models exist but none resolved for this session: pi almost certainly
			    started without its runtime providers (for example a dropped
			    --extension), so the picker can list them while the composer stays
			    disabled. Fail loud instead of leaving a dead "选择模型" state. */}
			{connected && !loading && !pending && !state.isStreaming && state.availableModels.length > 0 && !state.model && <div className="notice model-notice" role="alert"><span>当前会话未加载到有效模型，pi 可能未注册 provider。</span><Button variant="ghost" onClick={onReconnect}>重新连接</Button></div>}
			{state.dialogs?.[0] && (deferredDialog === state.dialogs[0].id ? <div className="queue-panel" role="status">扩展等待确认 · {state.dialogs.length} 项<Button onClick={() => setDeferredDialog(undefined)}>处理</Button></div> : <ExtensionDialog key={state.dialogs[0].id} request={state.dialogs[0]} onReply={actions.replyDialog} onReconnect={onReconnect} onDefer={() => setDeferredDialog(state.dialogs?.[0]?.id)} />)}
			{editNotice && <p className="draft-notice" role="status">{editNotice}</p>}
			{queueSize(state.queue) > 0 && state.queue && <QueuedMessages queue={state.queue} disabled={state.stopping} onChange={actions.updateQueuedMessage} />}
			{queueSize(state.withdrawn) > 0 && <div className="queue-panel" aria-label="已撤回输入"><strong>已撤回的文字（不含图片）</strong><pre>{[...(state.withdrawn?.steering ?? []), ...(state.withdrawn?.followUp ?? [])].join("\n\n")}</pre><CopyButton text={[...(state.withdrawn?.steering ?? []), ...(state.withdrawn?.followUp ?? [])].join("\n\n")} label="复制撤回文字" /><Button onClick={() => { setDraft([draft, ...(state.withdrawn?.steering ?? []), ...(state.withdrawn?.followUp ?? [])].filter(Boolean).join("\n\n")); setFocusSignal((n) => n + 1); }}>追加到草稿</Button></div>}
			{state.lastOutcome?.reason === "manual" && !state.messages.some((message) => message.role === "user" && `turn:${message.id}` === state.lastOutcome?.turnId) && <div className="turn-outcome manual" role="status">{outcomeLabel("manual")}<Button disabled={continuing || state.stopping} onClick={() => void continueRun()}>继续</Button></div>}
			{draftTarget && storedDraft.notice && <div className="draft-notice" role="status">{storedDraft.notice}{storedDraft.canRetry && <Button variant="ghost" onClick={storedDraft.retry}>重试保存</Button>}</div>}
			<Composer
				disabled={(!!draftTarget && !storedDraft.ready) || !connected || state.stopping || editPending || (!state.isStreaming && pending) || !state.model || !state.availableModels.length}
				missingAttachments={draftTarget ? storedDraft.attachments.filter((item) => item.body === undefined) : undefined}
				onRemoveMissing={storedDraft.removeMissing}
				streaming={state.isStreaming}
				stopping={state.stopping}
				onSend={send}
				onAbort={actions.abort}
				recoveryNotice={draftTarget ? storedDraft.recoveryNotice : undefined}
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
				restoredImages={draftTarget ? storedDraft.restored.images : restoredImages}
				restoredFiles={draftTarget ? storedDraft.restored.files : restoredFiles}
				onAttachmentsChange={draftTarget ? storedDraft.onAttachments : undefined}
				editing={!!editing || !!edit}
				onCancelEdit={cancelEdit}
				getCommands={actions.getCommands}
			/>
		</section>
	);
}
