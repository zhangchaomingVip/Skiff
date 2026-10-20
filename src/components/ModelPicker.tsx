import { Input, Button } from "./ui";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import type { ModelInfo } from "../chat/types";
import { Icon } from "./Icon";
import { offerPrice, offerAccount } from "../chat/offerDisplay";
import { pickerGroups, pickerModelName, formatPriceMultiplier } from "../chat/modelPicker";
import { ProviderIcon } from "./ProviderIcon";

const sameModel = (a?: ModelInfo, b?: ModelInfo) => !!a && !!b && a.provider === b.provider && a.id === b.id;
const subtitle = (model: ModelInfo) => [model.id, model.providerName, model.familyName, offerAccount(model.billingAccountId), offerPrice({ currency: model.currency, inputCost: model.cost?.input, outputCost: model.cost?.output }), model.priceMultiplier === undefined ? undefined : `官方价格 × ${model.priceMultiplier}`].filter(Boolean).join(" · ");

/** Provider groups with compact rows; prices and route details live in tooltips. */
export function ModelPicker({ models, familyOf, current, onSelect, onManage, configurationHint, disabled = false }: {
	configurationHint?: string;
	models: ModelInfo[];
	familyOf: (model: ModelInfo) => { id: string; name: string } | undefined;
	current?: ModelInfo;
	onSelect: (model: ModelInfo) => void;
	onManage: () => void;
	disabled?: boolean;
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const id = useId();
	const groups = useMemo(() => pickerGroups(models, query, familyOf), [models, query, familyOf]);
	const rows = useMemo(() => groups.flatMap((group) => group.models), [groups]);

	useEffect(() => {
		const selected = rows.findIndex((model) => sameModel(model, current));
		setActive(query ? 0 : Math.max(0, selected));
	}, [rows, query, current?.provider, current?.id]);
	useEffect(() => {
		document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
	}, [id, active, rows]);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
			event.preventDefault();
			setActive((value) => event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, value + (event.key === "ArrowDown" ? 1 : -1))));
		} else if (event.key === "Enter") {
			event.preventDefault();
			const model = rows[active] ?? rows[0];
			if (model && !disabled) onSelect(model);
		}
	};

	let rendered = 0;
	return <div className="family-picker">
		<div className="model-search"><Icon name="search" size={15} /><Input appearance="plain" autoFocus role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={rows[active] ? `${id}-${active}` : undefined} aria-label="搜索家族、提供商或模型" placeholder="搜索提供商或模型…" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} /></div>
		<div className="family-groups" id={id} role="listbox" aria-label="可用模型">
			{groups.map((group) => {
				const multiplier = group.models[0]?.priceMultiplier;
				const uniform = group.models.every((model) => model.priceMultiplier === multiplier);
				const badge = uniform ? formatPriceMultiplier(multiplier) : undefined;
				return <div className="family-group" key={group.key} role="group" aria-label={group.name}>
					<div className="family-head"><ProviderIcon id="" name={group.name} size={16} /><span className="family-provider-name">{group.name}</span>{badge && <span className={`model-multiplier ${multiplier! > 1 ? "is-premium" : ""}`} title={`按官方价格的 ${multiplier} 倍计费`}>{badge}</span>}<span className="family-model-count">{group.models.length}</span></div>
					{group.models.map((model) => {
						const index = rendered++;
						const rowBadge = !uniform && formatPriceMultiplier(model.priceMultiplier);
						return <button type="button" key={`${model.provider}/${model.id}`} id={`${id}-${index}`} className={`family-option ${index === active ? "focused" : ""}`} role="option" aria-selected={sameModel(model, current)} aria-label={`选择 ${model.familyName ?? familyOf(model)?.name ?? ""} ${group.name} ${model.id}`} title={subtitle(model)} disabled={disabled} onMouseMove={() => setActive(index)} onClick={() => onSelect(model)}>
							<span className="family-option-label"><span className="family-option-name">{pickerModelName(model)}</span>{sameModel(model, current) && <span className="family-option-current" title="当前模型" aria-hidden="true"><Icon name="check" size={12} /></span>}</span>{rowBadge && <span className={`model-multiplier ${model.priceMultiplier! > 1 ? "is-premium" : ""}`}>{rowBadge}</span>}
						</button>;
					})}
				</div>;
			})}
			{!groups.length && <p className="menu-hint">没有匹配的模型</p>}
		</div>
		{configurationHint && <p className="menu-hint" role="status">{configurationHint}</p>}
		<div className="family-picker-foot"><Button size="compact" onClick={onManage} disabled={disabled}><Icon name="settings" size={13} />管理提供商…</Button></div>
	</div>;
}
