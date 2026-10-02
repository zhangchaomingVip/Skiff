import { useState } from "react";
import type { ImageAttachment, SessionState } from "../chat/types";
import { UsageDetails } from "./UsageDetails";
import type { PiSessionActions } from "../chat/usePiSession";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

/** Transcript + notices + composer. */
export function ChatView({
	state,
	connected,
	actions,
	pending,
	projectName,
	onSend,
	onReconnect,
	elapsedMs,
}: {
	state: SessionState;
	connected: boolean;
	actions: PiSessionActions;
	pending: boolean;
	projectName?: string;
	onSend: (text: string, images?: ImageAttachment[]) => Promise<boolean>;
	onReconnect: () => void;
	elapsedMs: number;
}) {
	const [draft, setDraft] = useState("");
	const alerts = state.notices.filter((notice) => notice.kind !== "info");

	return (
		<section className="chat">
			<MessageList messages={state.messages} projectName={projectName} onSuggestion={setDraft} />
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
				<div className="banner error" role="alert"><span>{state.lastError}</span>{!connected ? <button className="btn ghost" onClick={onReconnect}>重新连接</button> : <button className="icon-btn" onClick={actions.clearError} aria-label="关闭错误提示">×</button>}</div>
			)}
			{connected && !state.availableModels.length && <div className="notice model-notice">pi 中暂无可用模型，请先在 pi 配置模型与凭据。<button className="btn ghost" onClick={onReconnect}>重新加载</button></div>}
			<Composer
				disabled={!connected || pending || !state.model || !state.availableModels.length}
				streaming={state.isStreaming}
				onSend={onSend}
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
			/>
			<UsageDetails messages={state.messages} elapsedMs={elapsedMs} />
		</section>
	);
}
