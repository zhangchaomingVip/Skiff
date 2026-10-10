import type { ModelDisplay } from "../chat/modelDisplay";
import { BrandIcon } from "./BrandIcon";
import { TurnSummary } from "./TurnSummary";

/** Display-only assistant row while pi has not created its first reply. */
export function WaitingReply({ turnId, roleDisplay }: { turnId: string; roleDisplay: ModelDisplay }) {
	return <article className="msg assistant" aria-label="Skiff 的消息">
		<div className="msg-role">{roleDisplay.brand && <BrandIcon name={roleDisplay.brand} size={14} />}{roleDisplay.label}</div>
		<div className="msg-body"><span className="typing">等待回复… · <TurnSummary turnId={turnId} steps={0} /></span></div>
	</article>;
}
