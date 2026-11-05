import { Input, Button, IconButton } from "./ui";
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import type { ModelInfo } from "../chat/types";
import { Icon } from "./Icon";
import { offerPrice, offerAccount } from "../chat/offerDisplay";
import { pickerGroups, pickerModelName } from "../chat/modelPicker";
import { modelFavoriteKey } from "../chat/useModelFavorites";
import { formatContextWindow } from "../chat/modelFamilies";

const sameModel = (a?: ModelInfo, b?: ModelInfo) => !!a && !!b && a.provider === b.provider && a.id === b.id;
const contextLabel = (value?: number) => value && value > 0 ? `${formatContextWindow(value)} 上下文` : undefined;
const capabilities = (model: ModelInfo) => [contextLabel(model.contextWindow), model.reasoning && "思考", (model.vision || model.input?.includes("image")) && "图片输入", model.tools && "工具调用"].filter(Boolean).join(" · ");

/** The full catalog keeps exact provider/model targets while filtering by provider and search. */
export function ModelPicker({ models, familyOf, current, onSelect, onManage, onClose, favorites, onToggleFavorite, configurationHint, searchRef, disabled = false }: {
	configurationHint?: string;
	models: ModelInfo[];
	familyOf: (model: ModelInfo) => { id: string; name: string } | undefined;
	current?: ModelInfo;
	onSelect: (model: ModelInfo) => void;
	onManage: () => void;
	onClose: () => void;
	favorites: string[];
	onToggleFavorite: (model: ModelInfo) => void;
	disabled?: boolean;
	searchRef?: RefObject<HTMLInputElement>;
}) {
	const [query, setQuery] = useState("");
	const [provider, setProvider] = useState<string>();
	const [active, setActive] = useState(0);
	const id = useId();
	const providers = useMemo(() => pickerGroups(models, "", familyOf), [models, familyOf]);
	const groups = useMemo(() => pickerGroups(models, query, familyOf).filter((group) => !provider || group.key === provider), [models, query, familyOf, provider]);
	const rows = useMemo(() => groups.flatMap((group) => group.models), [groups]);

	useEffect(() => {
		const selected = rows.findIndex((model) => sameModel(model, current));
		setActive(query ? 0 : Math.max(0, selected));
	}, [rows, query, current?.provider, current?.id]);
	useEffect(() => {
		document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
	}, [id, active, rows]);
	useEffect(() => { if (provider && !providers.some((group) => group.key === provider)) setProvider(undefined); }, [provider, providers]);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing || event.keyCode === 229) return;
		if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			setActive((value) => event.key === "Home" ? 0 : event.key === "End" ? Math.max(0, rows.length - 1) : Math.max(0, Math.min(rows.length - 1, value + (event.key === "ArrowDown" ? 1 : -1))));
		} else if (event.key === "Enter") {
			event.preventDefault();
			const model = rows[active] ?? rows[0];
			if (model && !disabled) onSelect(model);
		}
	};

	return <div className="model-catalog">
		<header className="model-catalog-header"><h2>切换模型</h2><IconButton aria-label="关闭模型选择" onClick={onClose}><Icon name="close" size={20} /></IconButton></header>
		<div className="model-catalog-search"><Icon name="search" size={18} /><Input ref={searchRef} appearance="plain" autoFocus role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={rows[active] ? `${id}-${active}` : undefined} aria-label="搜索家族、提供商或模型" placeholder="搜索模型或提供商…" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} /></div>
		<div className="model-provider-filters" role="group" aria-label="按提供商筛选">
			<Button variant="ghost" size="compact" aria-pressed={!provider} onClick={() => setProvider(undefined)}>全部</Button>
			{providers.map((group) => <Button variant="ghost" size="compact" key={group.key} aria-pressed={provider === group.key} onClick={() => setProvider(group.key)}>{group.name}</Button>)}
		</div>
		<div className="model-catalog-list" role="listbox" aria-label="可用模型" id={id}>
			{rows.map((model, index) => {
				const selected = sameModel(model, current);
				const favorite = favorites.includes(modelFavoriteKey(model));
				const name = pickerModelName(model);
				const providerName = model.providerName ?? model.provider;
				return <div className={`model-catalog-row${index === active ? " is-active" : ""}${selected ? " is-current" : ""}`} key={modelFavoriteKey(model)}>
					<button type="button" id={`${id}-${index}`} className="model-catalog-option" role="option" aria-selected={selected} aria-label={`选择 ${providerName} ${model.id}`} title={model.id} disabled={disabled} onMouseEnter={() => setActive(index)} onClick={() => onSelect(model)}>
						<span className="model-catalog-name">{name}</span>
						<span className="model-catalog-meta">{[providerName, capabilities(model)].filter(Boolean).join(" · ")}</span>
						<span className="model-catalog-billing">{offerPrice({ currency: model.currency, inputCost: model.cost?.input, outputCost: model.cost?.output })} · {offerAccount(model.billingAccountId)}{model.priceMultiplier !== undefined && model.priceMultiplier !== 1 ? ` · 官方价格 × ${model.priceMultiplier}` : ""}</span>
						{selected && <span className="model-catalog-check" aria-label="当前模型"><Icon name="check" size={18} /></span>}
					</button>
					<IconButton variant="ghost" className={`model-favorite${favorite ? " is-favorite" : ""}`} aria-label={`${favorite ? "取消收藏" : "收藏"} ${providerName} ${name}`} aria-pressed={favorite} title={favorite ? "取消收藏" : "收藏到快捷列表"} disabled={disabled} onClick={() => onToggleFavorite(model)}><Icon name="star" size={18} /></IconButton>
				</div>;
			})}
			{!rows.length && <div className="model-catalog-empty" role="status"><Icon name="search" size={24} /><p>{models.length ? "没有匹配的模型" : "暂无可用模型"}</p><span>{models.length ? "试试其他关键词或提供商" : "在提供商设置中添加或启用模型"}</span></div>}
		</div>
		{configurationHint && <p className="menu-hint" role="status">{configurationHint}</p>}
		<footer className="model-catalog-footer"><span className="model-keyboard-hint"><kbd>↑</kbd><kbd>↓</kbd> 导航 <span>·</span> <kbd>Enter</kbd> 选择 <span>·</span> <kbd>Esc</kbd> 关闭</span><Button variant="ghost" size="compact" onClick={onManage} disabled={disabled}><Icon name="settings" size={14} />管理提供商</Button></footer>
	</div>;
}
