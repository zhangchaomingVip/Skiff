import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../chat/types";
import { ModelPicker } from "./ModelPicker";
import { Icon } from "./Icon";

const humanizeTokens = (value: number): string => {
	if (!Number.isFinite(value) || value <= 0) return "";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
	if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}K`;
	return String(value);
};

export function ModelMenu({ models, model, level, levels, disabled, onModel, onLevel, onMaxTokens }: {
	models: ModelInfo[]; model?: ModelInfo; level?: string; levels: string[]; disabled: boolean;
	onModel: (model: ModelInfo) => void; onLevel: (level: string) => void; onMaxTokens: (maxTokens: number | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const [maxTokens, setMaxTokens] = useState("");
	useEffect(() => { setMaxTokens(model?.maxTokens ? String(model.maxTokens) : ""); }, [model?.provider, model?.id, model?.maxTokens]);
	const commitMaxTokens = () => {
		const raw = maxTokens.trim();
		// Clearing the field restores the adapter/model default.
		if (!raw) { if (model?.maxTokens !== undefined) onMaxTokens(null); return; }
		const value = Math.floor(Number(raw));
		if (Number.isFinite(value) && value > 0 && value !== model?.maxTokens) onMaxTokens(value);
	};
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
			<ModelPicker models={models} current={model} onSelect={(next) => { onModel(next); setOpen(false); trigger.current?.focus(); }} disabled={disabled} />
			<div className="model-setting-row"><span>推理等级</span>{levels.length ? <div className="level-options" role="radiogroup" aria-label="推理等级">{levels.map((value) => { const selected = (levels.includes(level ?? "") ? level : levels[0]) === value; return <button key={value} type="button" role="radio" aria-checked={selected} disabled={disabled || !canThink} className={selected ? "selected" : ""} onClick={() => onLevel(value)}>{value === "off" ? "关闭" : value}</button>; })}</div> : <span className="level-empty">暂不可用</span>}</div>
			<div className="model-setting-row"><label htmlFor="max-tokens">最大输出</label><span className="model-number-wrap"><input id="max-tokens" className="model-number" type="number" min={1} max={model?.contextWindow} value={maxTokens} placeholder="默认" disabled={disabled} onChange={(event) => setMaxTokens(event.target.value)} onBlur={commitMaxTokens} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitMaxTokens(); } }} aria-label="最大输出 Token" /><span className="model-number-hint">{humanizeTokens(Math.floor(Number(maxTokens)))}</span></span></div>
			<p className="menu-hint">{canThink ? "等级由当前模型支持的能力决定" : "当前模型不支持调整推理等级"} · 最大输出限制单次回复长度，调高可减少手动「继续」。</p>
		</div>}
	</div>;
}
