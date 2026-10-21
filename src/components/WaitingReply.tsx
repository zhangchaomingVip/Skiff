import type { ModelDisplay } from "../chat/modelDisplay";
import { BrandIcon } from "./BrandIcon";
import { processCountLabel } from "../chat/turnProcess";
import { ProcessRow } from "./ProcessDisclosure";
import { ProcessStatus } from "./TurnProcessGroup";

/** Display-only assistant row while pi has not created its first reply. */
export function WaitingReply({ roleDisplay }: { turnId: string; roleDisplay: ModelDisplay }) {
	return <article className="msg assistant waiting-reply" aria-label="Skiff 的消息">
		<div className="msg-role">{roleDisplay.brand && <BrandIcon name={roleDisplay.brand} size={14} />}{roleDisplay.label}</div>
		<div className="msg-body"><ProcessRow icon="spark" label={<span className="process-count-label">{processCountLabel({ placement: "head", entries: [], counts: { thinkingSegments: 0, thinkingChars: 0, steps: 0 } }, true)}</span>} status={<ProcessStatus running />} /></div>
	</article>;
}
