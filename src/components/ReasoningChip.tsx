import { Button, Popover } from "./ui";
import { useRef, useState } from "react";
import { Icon } from "./Icon";

/** Levels that cost noticeable extra thinking time; only they earn an accent cue. */
const ELEVATED_LEVELS = new Set(["high", "xhigh", "max"]);

/** One short Chinese name per pi key; the pill only rewords "off" as "no reasoning". */
export const LEVEL_LABELS: Record<string, string> = { off: "关闭", minimal: "极简", low: "低", medium: "标准", high: "高", xhigh: "极高", max: "最高" };

/** Thinking-level pill; hidden when the selected model cannot reason. */
export function ReasoningChip({ level, levels, disabled, onLevel }: {
	level?: string; levels: string[]; disabled: boolean; onLevel: (level: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const canThink = levels.some((value) => value !== "off");
	const currentLevel = levels.includes(level ?? "") ? level : levels[0];
	if (!canThink) return null;
	// A reasoning level is a normal setting, not a switch that is flipped: the pill
	// stays as quiet as the model pill and only tints its star when raised.
	const thinking = Boolean(currentLevel && currentLevel !== "off");
	const elevated = Boolean(currentLevel && ELEVATED_LEVELS.has(currentLevel));
	const pillLabel = thinking && currentLevel ? LEVEL_LABELS[currentLevel] ?? currentLevel : "无推理";

	return <div className="model-chip-wrap" ref={root}>
		<Button variant="setting" className={`reasoning-trigger${elevated ? " is-elevated" : ""}`} ref={trigger} disabled={disabled} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label="推理等级">
			<Icon name="spark" size={14} />
			<span>{pillLabel}</span>
			<span className="chev-caret"><Icon name="chevron" size={12} /></span>
		</Button>
		{open && <Popover anchor={trigger} onClose={() => setOpen(false)} className="reasoning-popover" aria-label="推理等级">
			<div className="reasoning-popover-title">推理等级</div>
			<div className="level-options" role="radiogroup" aria-label="推理等级">{levels.map((value) => {
				const selected = currentLevel === value;
				return <button type="button" key={value} role="radio" aria-checked={selected} disabled={disabled} className="level-option" onClick={() => { onLevel(value); setOpen(false); trigger.current?.focus(); }}>
					<span className="level-option-label">{LEVEL_LABELS[value] ?? value}</span>
					{selected && <Icon name="check" size={14} />}
				</button>;
			})}</div>
		</Popover>}
	</div>;
}
