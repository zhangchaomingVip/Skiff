import { Input, Button, IconButton, Popover } from "./ui";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { ModelInfo } from "../chat/types";
import { Icon } from "./Icon";
import { BrandIcon } from "./BrandIcon";
import { modelBrand } from "../chat/modelDisplay";
import { pickerGroups, pickerFamilyGroups, pickerModelName } from "../chat/modelPicker";
import { modelFavoriteKey } from "../chat/useModelFavorites";
import { formatContextWindow } from "../chat/modelFamilies";

const sameModel = (a?: ModelInfo, b?: ModelInfo) => !!a && !!b && a.provider === b.provider && a.id === b.id;
const contextLabel = (value?: number) => value && value > 0 ? formatContextWindow(value).replace(/k$/, "K") : undefined;
const formatPriceNumber = (value: number | undefined, currency: ModelInfo["currency"]) => {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "待配置";
	const symbol = currency === "USD" ? "$" : "¥";
	if (value === 0) return `${symbol}0`;
	const precision = value < 0.01 ? 3 : 2;
	const rounded = Number(value.toFixed(precision));
	return `${symbol}${rounded}`;
};

function ModelFamilyFilter({ families, value, disabled, onChange }: {
	families: { key: string; name: string }[];
	value?: string;
	disabled: boolean;
	onChange: (value: string | undefined) => void;
}) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const id = useId();
	const options = [{ key: undefined, name: "全部家族" }, ...families];
	const label = options.find((option) => option.key === value)?.name ?? "全部家族";
	useLayoutEffect(() => {
		if (open) menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
	}, [open, value]);
	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Tab") {
			event.preventDefault();
			setOpen(false);
			if (event.shiftKey) trigger.current?.focus();
			else trigger.current?.closest(".model-provider-filters")?.querySelector<HTMLButtonElement>(".model-provider-options button:not(:disabled)")?.focus();
			return;
		}
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
		const current = items.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
		items[next]?.focus();
		items[next]?.scrollIntoView({ block: "nearest" });
	};
	return <div className="model-family-filter" onBlur={(event) => {
		if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
	}}>
		<Button ref={trigger} variant="ghost" size="compact" className="model-family-trigger" role="combobox" aria-label="筛选模型家族" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} data-selected={value !== undefined} title={label} disabled={disabled} onClick={() => setOpen((previous) => !previous)} onKeyDown={(event) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
		}}><span className="model-family-label">{label}</span><span className="model-family-caret"><Icon name="chevron" size={12} /></span></Button>
		{open && !disabled && <Popover anchor={trigger} id={id} role="listbox" aria-label="模型家族" className="model-family-menu" onClose={() => setOpen(false)}>
			<div ref={menu} onKeyDown={navigate}>
				{options.map((option) => <button type="button" role="option" key={option.key === undefined ? "all" : `family:${option.key}`} aria-selected={option.key === value} tabIndex={option.key === value ? 0 : -1} className="model-family-option" onClick={() => {
					onChange(option.key); setOpen(false); trigger.current?.focus();
				}}><span>{option.name}</span>{option.key === value && <Icon name="check" size={14} />}</button>)}
			</div>
		</Popover>}
	</div>;
}

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
	const [selectedFamily, setSelectedFamily] = useState<string>();
	const [active, setActive] = useState(0);
	const id = useId();
	const providers = useMemo(() => pickerGroups(models, "", familyOf), [models, familyOf]);
	const families = useMemo(() => pickerFamilyGroups(models, "", familyOf).map(({ key, name }) => ({ key, name })), [models, familyOf]);
	const groups = useMemo(() => {
		let startIndex = 0;
		return pickerFamilyGroups(models, query, familyOf, provider, selectedFamily).map((group) => {
			const section = { ...group, startIndex };
			startIndex += group.models.length;
			return section;
		});
	}, [models, query, familyOf, provider, selectedFamily]);
	const rows = useMemo(() => groups.flatMap((group) => group.models), [groups]);

	useEffect(() => {
		const selected = rows.findIndex((model) => sameModel(model, current));
		setActive(query ? 0 : Math.max(0, selected));
	}, [rows, query, current?.provider, current?.id]);
	useEffect(() => {
		document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
	}, [id, active, rows]);
	useEffect(() => { if (provider && !providers.some((group) => group.key === provider)) setProvider(undefined); }, [provider, providers]);
	useEffect(() => { if (selectedFamily !== undefined && !families.some((family) => family.key === selectedFamily)) setSelectedFamily(undefined); }, [selectedFamily, families]);

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
		<header className="model-catalog-header">
			<h2>切换模型</h2>
			<div className="model-catalog-header-actions">
				<Button variant="ghost" size="compact" onClick={onManage} disabled={disabled}><Icon name="settings" size={14} />管理提供商</Button>
				<IconButton aria-label="关闭模型选择" onClick={onClose}><Icon name="close" size={16} /></IconButton>
			</div>
		</header>
		<div className="model-catalog-search"><Icon name="search" size={15} /><Input ref={searchRef} appearance="plain" autoFocus role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={rows[active] ? `${id}-${active}` : undefined} aria-label="搜索家族、提供商或模型" placeholder="搜索模型或提供商…" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} /></div>
		<div className="model-provider-filters" role="group" aria-label="模型筛选">
			<ModelFamilyFilter families={families} value={selectedFamily} disabled={disabled} onChange={setSelectedFamily} />
			<span className="model-filter-divider" aria-hidden="true" />
			<div className="model-provider-options" role="group" aria-label="按提供商筛选">
				<Button variant="ghost" size="compact" aria-pressed={!provider} onClick={() => setProvider(undefined)}>全部</Button>
				{providers.map((group) => <Button variant="ghost" size="compact" key={group.key} aria-pressed={provider === group.key} onClick={() => setProvider(group.key)}>{group.name}</Button>)}
			</div>
		</div>
		<div className="model-catalog-list" role="listbox" aria-label="可用模型" id={id}>
			{groups.map((group, groupIndex) => <div className="model-catalog-section" role="group" aria-labelledby={`${id}-family-${groupIndex}`} key={group.key}>
				<div className="model-catalog-section-head" id={`${id}-family-${groupIndex}`}>{group.name}</div>
				{group.models.map((model, offset) => {
					const index = group.startIndex + offset;
					const selected = sameModel(model, current);
					const favorite = favorites.includes(modelFavoriteKey(model));
					const name = pickerModelName(model);
					const providerName = model.providerName ?? model.provider;
					const showProvider = !provider || provider !== (model.relayId ?? model.provider);
					const brand = modelBrand(model.familyId, model.id, model.name);
					const context = contextLabel(model.contextWindow);
					const account = model.billingAccountId?.trim();
					const showAccount = !!account && account !== "未标注";
					const isFree = model.cost?.input === 0 && model.cost?.output === 0;
					const inputPrice = formatPriceNumber(model.cost?.input, model.currency);
					const outputPrice = formatPriceNumber(model.cost?.output, model.currency);
					const pricingText = isFree ? "免费使用" : `输入 ${inputPrice} · 输出 ${outputPrice} / 1M tokens`;
					const multiplier = model.priceMultiplier !== undefined && model.priceMultiplier !== 1 ? `（官方价格 × ${model.priceMultiplier}）` : "";
					const tooltip = [
						`${name} (${model.id})`,
						`提供商：${providerName}`,
						`计费：${pricingText}${multiplier}`,
						showAccount ? `扣费账户：${account}` : undefined,
					].filter(Boolean).join("\n");
					return <div className={`model-catalog-row${index === active ? " is-active" : ""}${selected ? " is-current" : ""}`} key={modelFavoriteKey(model)}>
						<button type="button" id={`${id}-${index}`} className="model-catalog-option" role="option" aria-selected={selected} aria-label={`选择 ${providerName} ${model.id}`} title={tooltip} disabled={disabled} onMouseEnter={() => setActive(index)} onClick={() => onSelect(model)}>
							<span className="model-catalog-brand">{brand ? <BrandIcon name={brand} size={16} /> : <Icon name="tokens" size={16} />}</span>
							<span className="model-catalog-name">{name}</span>
							<span className="model-catalog-meta">
								{showProvider ? <span className="model-catalog-provider" title={providerName}>{providerName}</span> : <span className="sr-only">{providerName}</span>}
								{showProvider && context && <span className="model-catalog-separator" aria-hidden="true">·</span>}
								{context && <span className="model-catalog-spec" title={`${context} 上下文`}>{context}</span>}
							</span>
							<span className="model-catalog-check" aria-label={selected ? "当前模型" : undefined}>{selected && <Icon name="check" size={16} />}</span>
						</button>
						<IconButton variant="ghost" className={`model-favorite${favorite ? " is-favorite" : ""}`} aria-label={`${favorite ? "取消收藏" : "收藏"} ${providerName} ${name}`} aria-pressed={favorite} title={favorite ? "取消收藏" : "收藏到快捷列表"} disabled={disabled} onClick={() => onToggleFavorite(model)}><Icon name="star" size={16} /></IconButton>
					</div>;
				})}
			</div>)}
			{!rows.length && <div className="model-catalog-empty" role="status"><Icon name="search" size={24} /><p>{models.length ? "没有匹配的模型" : "暂无可用模型"}</p><span>{models.length ? "试试其他关键词、家族或提供商" : "在提供商设置中添加或启用模型"}</span></div>}
		</div>
		{configurationHint && <p className="menu-hint" role="status">{configurationHint}</p>}
	</div>;
}
