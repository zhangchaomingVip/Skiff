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

/** Stable brand-ish hue per provider so a model stays visually identifiable. */
const PROVIDER_HUES: Record<string, number> = {
	anthropic: 24, openai: 158, google: 217, groq: 12, deepseek: 214, moonshot: 271,
	xai: 220, grok: 220, ollama: 32, openrouter: 250, zhipu: 200, qwen: 190, dashscope: 190,
	siliconflow: 190, volcengine: 205, cohere: 340, mistral: 28, perplexity: 186, together: 260,
	fireworks: 20, azure: 205, openai_compat: 158, custom: 158,
};

function providerHue(provider: string): number {
	const key = provider.toLowerCase();
	const known = PROVIDER_HUES[key];
	if (known !== undefined) return known;
	let hash = 0;
	for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) % 360;
	return hash;
}

function ModelBadge({ provider }: { provider: string }) {
	const initial = (provider.trim()[0] ?? "?").toUpperCase();
	const hue = providerHue(provider || "unknown");
	return <span className="model-badge" style={{ color: `hsl(${hue} 55% 45%)`, background: `hsl(${hue} 60% 45% / 0.14)` }} aria-hidden="true">{initial}</span>;
}

/** Model picker pill plus the max-output setting. */
export function ModelMenu({ models, model, disabled, onModel, onMaxTokens }: {
	models: ModelInfo[]; model?: ModelInfo; disabled: boolean;
	onModel: (model: ModelInfo) => void; onMaxTokens: (maxTokens: number | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const [maxTokens, setMaxTokens] = useState("");
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	useEffect(() => { setMaxTokens(model?.maxTokens ? String(model.maxTokens) : ""); }, [model?.provider, model?.id, model?.maxTokens]);
	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			setOpen(false);
			trigger.current?.focus();
		};
		document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", key);
		return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", key); };
	}, [open]);
	const commitMaxTokens = () => {
		const raw = maxTokens.trim();
		// Clearing the field restores the adapter/model default.
		if (!raw) { if (model?.maxTokens !== undefined) onMaxTokens(null); return; }
		const value = Math.floor(Number(raw));
		if (Number.isFinite(value) && value > 0 && value !== model?.maxTokens) onMaxTokens(value);
	};

	return <div className="model-chip-wrap" ref={root}>
		<button className="model-trigger" ref={trigger} disabled={disabled} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label="选择模型">
			{model && <ModelBadge provider={model.provider} />}
			<span>{model?.name ?? model?.id ?? "选择模型"}</span>
			<span className="chev-caret"><Icon name="chevron" size={12} /></span>
		</button>
		{open && <div className="model-popover" role="dialog" aria-label="模型与最大输出">
			<ModelPicker models={models} current={model} onSelect={(next) => { onModel(next); setOpen(false); trigger.current?.focus(); }} disabled={disabled} />
			<div className="model-setting-row"><label htmlFor="max-tokens">最大输出</label><span className="model-number-wrap"><input id="max-tokens" className="model-number" type="number" min={1} max={model?.contextWindow} value={maxTokens} placeholder="默认" disabled={disabled} onChange={(event) => setMaxTokens(event.target.value)} onBlur={commitMaxTokens} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitMaxTokens(); } }} aria-label="最大输出 Token" /><span className="model-number-hint">{humanizeTokens(Math.floor(Number(maxTokens)))}</span></span></div>
		</div>}
	</div>;
}
