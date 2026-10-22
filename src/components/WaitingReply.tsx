import type { ModelDisplay } from "../chat/modelDisplay";
import { BrandIcon } from "./BrandIcon";
import { Icon } from "./Icon";
import type { TurnProcessGroup } from "../chat/turnProcess";
import { useProcessActivity } from "../chat/useProcessActivity";
import { ProcessRow } from "./ProcessDisclosure";
import { processActivity } from "../chat/processStatus";

/** Display-only assistant row while pi has not created its first reply. */
export function WaitingReply({ turnId, roleDisplay, showRole = true }: { turnId: string; roleDisplay: ModelDisplay; showRole?: boolean }) {
	const group: TurnProcessGroup = { id: `${turnId}:waiting`, turnId, placement: "head", entries: [], narrationTexts: [], counts: { thinkingSegments: 0, thinkingChars: 0, steps: 0 }, closed: false, advanced: false, pending: false, error: false };
	const elapsed = useProcessActivity(group, true);
	const label = processActivity(group).label;
	return <article className="msg assistant waiting-reply" aria-label="Skiff 的消息">
		<div className="message-bubble">
		<div className={`msg-role${showRole ? "" : " is-compact"}`} title={roleDisplay.label}>{roleDisplay.brand ? <BrandIcon name={roleDisplay.brand} size={14} /> : <Icon name="spark" size={14} />}<span className={showRole ? undefined : "sr-only"}>{roleDisplay.label}</span></div>
		<div className="msg-body"><ProcessRow icon="spark" label={<><span className="process-count-label">{label}</span>{elapsed && <span className="process-elapsed">{elapsed}</span>}</>} /></div>
		</div>
	</article>;
}
