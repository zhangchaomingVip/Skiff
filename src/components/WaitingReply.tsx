import { useTurnElapsed } from "../chat/useTurnElapsed";
import { ProcessRow } from "./ProcessDisclosure";

/** Display-only assistant row while pi has not created its first reply. */
export function WaitingReply({ turnId, startedAt }: { turnId: string; startedAt?: number }) {
	const elapsed = useTurnElapsed(true, startedAt);
	return <article className="msg assistant waiting-reply" data-waiting-turn={turnId} aria-label="Skiff 的消息">
		<div className="message-segment"><div className="msg-body"><ProcessRow label={<span className="process-count-label">{elapsed}</span>} /></div></div>
	</article>;
}
