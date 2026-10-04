import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModelInfo } from "../chat/types";
import { FAMILY_LABELS } from "../chat/useModelFamilies";
import { useModelFamily } from "../chat/familyContext";
import { ModelPicker } from "./ModelPicker";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { Icon } from "./Icon";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId?: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

/** Model pill (family · model) and provider management. */
export function ModelMenu({ models, model, disabled, onModel }: {
	models: ModelInfo[];
	model?: ModelInfo;
	disabled: boolean;
	onModel: (model: ModelInfo) => void;
}) {
	const { familyOf, manage: onManage, models: familyModels, current, select, configurationHint } = useModelFamily();
	models = familyModels ?? models;
	model = current ?? model;
	onModel = select ?? onModel;
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<{ left: number; bottom: number; width: number }>();
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const family = model ? familyOf(model) : undefined;
	const mark = brand(family?.id);
	useLayoutEffect(() => {
		if (!open) return;
		const align = () => {
			const rect = trigger.current?.getBoundingClientRect();
			if (!rect) return;
			const width = Math.min(360, window.innerWidth - 24);
			setPosition({ width, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 6 });
		};
		align(); window.addEventListener("resize", align);
		return () => window.removeEventListener("resize", align);
	}, [open]);
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

	return <div className="model-chip-wrap" ref={root}>
		<button className="model-trigger" ref={trigger} disabled={disabled} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" aria-label="选择模型" title={model ? `${family ? `${FAMILY_LABELS[family.id] ?? family.name} · ` : ""}${model.providerName ?? model.provider} · ${model.id}` : "选择模型"}>
			{mark && <BrandIcon name={mark} size={14} />}
			<span className="model-trigger-label">{family ? `${FAMILY_LABELS[family.id] ?? family.name} · ${model?.id}` : model?.name ?? model?.id ?? "选择模型"}</span>
			<span className="chev-caret"><Icon name="chevron" size={12} /></span>
		</button>
		{open && <div className="model-popover" style={position ? { position: "fixed", right: "auto", ...position } : undefined} role="dialog" aria-label="选择模型">
			<ModelPicker configurationHint={configurationHint} models={models} familyOf={familyOf} current={model} onManage={() => { setOpen(false); onManage(); }} onSelect={(next) => { onModel(next); setOpen(false); trigger.current?.focus(); }} disabled={disabled} />
		</div>}
	</div>;
}
