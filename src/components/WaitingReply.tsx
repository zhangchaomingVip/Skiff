import type { ModelDisplay } from "../chat/modelDisplay";
import { BrandIcon } from "./BrandIcon";
import type { TurnProcessGroup } from "../chat/turnProcess";
import { useProcessActivity } from "../chat/useProcessActivity";
import { ProcessRow } from "./ProcessDisclosure";

/** Display-only assistant row while pi has not created its first reply. */
export function WaitingReply({ turnId, roleDisplay }: { turnId: string; roleDisplay: ModelDisplay }) {
	const group: TurnProcessGroup = { id: `${turnId}:waiting`, turnId, placement: "head", entries: [], narrationTexts: [], counts: { thinkingSegments: 0, thinkingChars: 0, steps: 0 }, closed: false, advanced: false, pending: false, error: false };
	const elapsed = useProcessActivity(group, true);
	return <article className="msg assistant waiting-reply" aria-label="Skiff 的消息">
		<div className="msg-role">{roleDisplay.brand && <BrandIcon name={roleDisplay.brand} size={14} />}{roleDisplay.label}</div>
		<div className="msg-body"><ProcessRow icon="spark" label={<><span className="process-count-label">正在等待模型响应</span>{elapsed && <span className="process-elapsed">{elapsed}</span>}</>} /></div>
	</article>;
}
