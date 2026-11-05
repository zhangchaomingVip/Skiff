import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Dialog, Popover, SegmentedControl } from "./ui";
import type { ModelInfo } from "../chat/types";
import { FAMILY_LABELS } from "../chat/useModelFamilies";
import { useModelFamily } from "../chat/familyContext";
import { ModelPicker } from "./ModelPicker";
import { BrandIcon, type BrandName } from "./BrandIcon";
import { Icon } from "./Icon";
import { modelBrand } from "../chat/modelDisplay";
import { pickerGroups, pickerModelName, visiblePickerModels } from "../chat/modelPicker";
import { useFamilyModels } from "../chat/useFamilyModels";
import { modelFavoriteKey, useModelFavorites } from "../chat/useModelFavorites";
import { LEVEL_LABELS } from "./ReasoningChip";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId?: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

/** Model pill (family · model) and provider management. */
export function ModelMenu({ models, model, disabled, onModel, thinkingLevel, thinkingLevels = [], thinkingDisabled = false, onThinkingLevel }: {
	models: ModelInfo[];
	model?: ModelInfo;
	disabled: boolean;
	onModel: (model: ModelInfo) => void;
	thinkingLevel?: string;
	thinkingLevels?: string[];
	thinkingDisabled?: boolean;
	onThinkingLevel?: (level: string) => void;
}) {
	const { familyOf, manage: onManage, models: familyModels, current, select, configurationHint } = useModelFamily();
	models = familyModels ?? models;
	const { config: visibleModels, catalog } = useFamilyModels();
	model = current ?? model;
	const pickerModels = useMemo(() => {
		const visible = visiblePickerModels(models, visibleModels, catalog, familyOf);
		const active = models.find((item) => model && modelFavoriteKey(item) === modelFavoriteKey(model));
		return active && !visible.includes(active) ? [active, ...visible] : visible;
	}, [models, visibleModels, catalog, familyOf, model]);
	onModel = select ?? onModel;
	const [open, setOpen] = useState(false);
	const [catalogOpen, setCatalogOpen] = useState(false);
	const { favorites, toggleFavorite } = useModelFavorites();
	const quickList = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const searchInput = useRef<HTMLInputElement>(null);
	const family = model ? familyOf(model) : undefined;
	const mark = brand(family?.id) ?? modelBrand(model?.provider, model?.id, model?.name);
	const displayName = model ? pickerModelName(model) : "选择模型";
	const fullTitle = model ? [family ? FAMILY_LABELS[family.id] ?? family.name : undefined, displayName, model.providerName, model.routeId, `${model.provider}/${model.id}`].filter(Boolean).join(" · ") : "选择模型";
	const quickModels = pickerModels.filter((item) => favorites.includes(modelFavoriteKey(item)) || (model && modelFavoriteKey(item) === modelFavoriteKey(model)));
	if (model && !quickModels.some((item) => modelFavoriteKey(item) === modelFavoriteKey(model))) quickModels.unshift(model);
	const groups = pickerGroups(quickModels, "", familyOf);
	const level = thinkingLevels.includes(thinkingLevel ?? "") ? thinkingLevel! : thinkingLevels[0];
	const canThink = thinkingLevels.some((value) => value !== "off");
	const selectModel = (next: ModelInfo) => { if (disabled) return; onModel(next); setOpen(false); setCatalogOpen(false); trigger.current?.focus(); };
	const manage = () => { setOpen(false); setCatalogOpen(false); requestAnimationFrame(() => onManage()); };
	useEffect(() => {
		if (open) (quickList.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]") ?? quickList.current?.querySelector<HTMLButtonElement>("button"))?.focus();
	}, [open]);
	const navigateQuickModels = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
		buttons[next]?.focus();
	};

	return <div className="model-chip-wrap">
		<Button className="model-trigger" ref={trigger} disabled={disabled} onClick={() => setOpen((value) => !value)} aria-expanded={open || catalogOpen} aria-haspopup="dialog" aria-label="选择模型" title={fullTitle}>
			{mark ? <BrandIcon name={mark} size={14} /> : <Icon name="tokens" size={14} />}
			<span className="model-trigger-label">{displayName}</span>
			{canThink && <span className={`model-trigger-thinking${level !== "off" ? " is-on" : ""}`}>· {level === "off" ? "关闭思考" : `思考 ${LEVEL_LABELS[level] ?? level}`}</span>}
			<span className="chev-caret"><Icon name="chevron" size={12} /></span>
		</Button>
		{open && <Popover anchor={trigger} onClose={() => setOpen(false)} className="model-popover" aria-label="选择模型">
			<div className="model-quick-list" ref={quickList} onKeyDown={navigateQuickModels}>
				{groups.map((group) => <section className="model-quick-group" key={group.key}><h3>{group.name}</h3>{group.models.map((item) => <Button variant="ghost" className="model-quick-option" key={modelFavoriteKey(item)} aria-pressed={!!model && modelFavoriteKey(item) === modelFavoriteKey(model)} title={item.id} disabled={disabled} onClick={() => selectModel(item)}><span>{pickerModelName(item)}</span>{model && modelFavoriteKey(item) === modelFavoriteKey(model) && <Icon name="check" size={16} />}</Button>)}</section>)}
				{!groups.length && <p className="menu-hint">收藏模型后，可在这里快速切换。</p>}
			</div>
			{canThink && onThinkingLevel && <div className="model-quick-thinking"><span>思考</span><SegmentedControl value={level} label="推理等级" options={thinkingLevels.map((value) => ({ value, label: LEVEL_LABELS[value] ?? value }))} disabled={disabled || thinkingDisabled} onChange={onThinkingLevel} /></div>}
			<p className="model-cache-hint">切换模型或思考程度可能使提示词缓存失效，增加 token 消耗。建议在新会话中切换。</p>
			{configurationHint && <p className="menu-hint" role="status">{configurationHint}</p>}
			<div className="model-quick-footer"><Button variant="ghost" onClick={() => { setOpen(false); setCatalogOpen(true); }}><Icon name="layers" size={16} />更多模型…</Button></div>
		</Popover>}
		{catalogOpen && <Dialog className="model-catalog-dialog" initialFocus={searchInput} aria-label="切换模型" onClose={() => setCatalogOpen(false)} returnFocusSelector=".model-trigger"><ModelPicker searchRef={searchInput} configurationHint={configurationHint} models={pickerModels} familyOf={familyOf} current={model} onManage={manage} onSelect={selectModel} onClose={() => setCatalogOpen(false)} favorites={favorites} onToggleFavorite={toggleFavorite} disabled={disabled} /></Dialog>}
	</div>;
}
