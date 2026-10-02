import type { SessionState } from "../chat/types";
import type { PiSessionActions } from "../chat/usePiSession";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

/** Transcript + notices + composer. */
export function ChatView({
	state,
	connected,
	actions,
}: {
	state: SessionState;
	connected: boolean;
	actions: PiSessionActions;
}) {
	const alerts = state.notices.filter((notice) => notice.kind !== "info");

	return (
		<section className="chat">
			<MessageList messages={state.messages} />
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
				<button className="banner error" onClick={actions.clearError} title="dismiss">
					{state.lastError}
					<span className="dismiss">×</span>
				</button>
			)}
			<Composer
				disabled={!connected}
				streaming={state.isStreaming}
				onSend={actions.prompt}
				onAbort={actions.abort}
			/>
		</section>
	);
}
