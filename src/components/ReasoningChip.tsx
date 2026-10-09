import { Button, Popover } from "./ui";
import { useRef, useState } from "react";
import { Icon } from "./Icon";

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
	const active = Boolean(currentLevel && currentLevel !== "off");

	return <div className="model-chip-wrap" ref={root}>
		<Button className={`reasoning-trigger${active ? " active" : ""}`} ref={trigger} disabled={disabled} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label="推理等级">
			<Icon name="spark" size={14} />
			<span>{active ? currentLevel : "无推理"}</span>
			<span className="chev-caret"><Icon name="chevron" size={12} /></span>
		</Button>
		{open && <Popover anchor={trigger} onClose={() => setOpen(false)} className="model-popover" aria-label="推理等级">
			<div className="model-setting-row"><span>推理等级</span></div>
			<div className="level-options" role="radiogroup" aria-label="推理等级">{levels.map((value) => { const selected = currentLevel === value; return <Button size="compact" key={value} type="button" role="radio" aria-checked={selected} disabled={disabled} className={selected ? "selected" : ""} onClick={() => { onLevel(value); setOpen(false); trigger.current?.focus(); }}>{value === "off" ? "关闭" : value}</Button>; })}</div>
			<p className="menu-hint">等级由当前模型支持的能力决定 · 调高可减少手动「继续」。</p>
		</Popover>}
	</div>;
}
