import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../chat/types";
import { ModelPicker } from "./ModelPicker";
import { Icon } from "./Icon";

export function ModelMenu({ models, model, level, levels, disabled, onModel, onLevel }: {
	models: ModelInfo[]; model?: ModelInfo; level?: string; levels: string[]; disabled: boolean;
	onModel: (model: ModelInfo) => void; onLevel: (level: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
		const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
		document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", key);
		return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", key); };
	}, [open]);
	const canThink = levels.some((value) => value !== "off");
	return <div className="model-menu" ref={root}>
		<button className="model-trigger" ref={trigger} disabled={disabled} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label="模型与推理设置"><span>{model?.name ?? model?.id ?? "选择模型"}</span>{canThink && <span className="thinking-label">{level ?? "off"}</span>}<Icon name="chevron" size={12} /></button>
		{open && <div className="model-popover" role="dialog" aria-label="模型与推理">
			<div className="model-setting-row"><span>模型</span><ModelPicker models={models} current={model} onSelect={onModel} disabled={disabled} /></div>
			<div className="model-setting-row"><label htmlFor="thinking-level">推理等级</label><select id="thinking-level" aria-label="推理等级" disabled={disabled || !canThink} value={levels.includes(level ?? "") ? level : levels[0] ?? ""} onChange={(event) => onLevel(event.target.value)}>{levels.length ? levels.map((value) => <option key={value} value={value}>{value === "off" ? "关闭" : value}</option>) : <option value="">暂不可用</option>}</select></div>
			<p className="menu-hint">{canThink ? "等级由当前模型支持的能力决定" : "当前模型不支持调整推理等级"}</p>
		</div>}
	</div>;
}
