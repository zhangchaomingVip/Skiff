import { Input, Button } from "./ui";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ModelInfo } from "../chat/types";
import { FAMILY_LABELS } from "../chat/useModelFamilies";
import { Icon } from "./Icon";
import { offerPrice, offerAccount } from "../chat/offerDisplay";
import { BrandIcon, type BrandName } from "./BrandIcon";

const BRANDABLE = ["deepseek", "kimi", "glm"] as const;
const brand = (familyId?: string): BrandName | undefined => BRANDABLE.find((name) => name === familyId);

interface Row {
	familyId?: string;
	familyName?: string;
	model: ModelInfo;
	index: number;
}

const sameModel = (a?: ModelInfo, b?: ModelInfo) => !!a && !!b && a.provider === b.provider && a.id === b.id;

const cost = (model: ModelInfo) => offerPrice({ currency: model.currency, inputCost: model.cost?.input, outputCost: model.cost?.output });

const subtitle = (model: ModelInfo) => [model.id, model.providerName, offerAccount(model.billingAccountId), cost(model)].filter(Boolean).join(" · ");

/**
 * Family-grouped picker: one group per family, one provider group per channel, one row per model.
 * Keyboard: ↑↓ move, Enter confirm, Esc closes (handled by the caller), typing
 * filters across all families.
 */
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
	const listRef = useRef<HTMLDivElement>(null);

	const groups = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const matches = models.filter((model) => {
			if (!needle) return true;
			const family = familyOf(model);
			return `${model.providerName ?? model.provider} ${model.name ?? ""} ${model.id} ${family?.name ?? ""} ${FAMILY_LABELS[family?.id ?? ""] ?? ""}`.toLowerCase().includes(needle);
		});
		const ordered: { familyId?: string; familyName?: string; providers: { key: string; name: string; models: ModelInfo[] }[] }[] = [];
		for (const model of matches) {
			const family = familyOf(model);
			const key = family?.id ?? "";
			let group = ordered.find((group) => (group.familyId ?? "") === key);
			if (!group) { group = { familyId: family?.id, familyName: family?.name ?? "其他模型", providers: [] }; ordered.push(group); }
			const provider = group.providers.find((provider) => provider.key === model.provider);
			if (provider) provider.models.push(model);
			else group.providers.push({ key: model.provider, name: model.providerName ?? model.provider, models: [model] });
		}
		return ordered;
	}, [models, query, familyOf]);

	const rows: Row[] = useMemo(() => {
		const flat: Row[] = [];
		for (const group of groups) for (const provider of group.providers) for (const model of provider.models) flat.push({ familyId: group.familyId, familyName: group.familyName, model, index: flat.length });
		return flat;
	}, [groups]);

	useEffect(() => { setActive(0); }, [query]);
	useEffect(() => {
		const selected = rows.findIndex((row) => sameModel(row.model, current));
		if (selected >= 0) setActive(selected);
	}, [current?.provider, current?.id, rows.length]);
	useEffect(() => {
		const row = document.getElementById(`${id}-${active}`);
		if (!row) return;
		row.scrollIntoView({ block: "nearest" });
	}, [id, active]);

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setActive((value) => Math.max(0, Math.min(rows.length - 1, value + (event.key === "ArrowDown" ? 1 : -1))));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			const row = rows[active] ?? rows[0];
			if (row) onSelect(row.model);
		}
	};

	let rendered = 0;
	return <div className="family-picker">
		<div className="model-search"><Icon name="search" size={15} /><Input appearance="plain" autoFocus role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={rows[active] ? `${id}-${active}` : undefined} aria-label="搜索家族、提供商或模型" placeholder="搜索家族、提供商或模型…" value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} /></div>
		<div className="family-groups" id={id} role="listbox" aria-label="可用模型" ref={listRef}>
			{groups.map((group) => {
				const mark = brand(group.familyId);
				return <section className="family-group" key={group.familyId ?? "other"}>
					<div className="family-head">{mark ? <BrandIcon name={mark} size={14} /> : <Icon name="spark" size={13} />}<span>{FAMILY_LABELS[group.familyId ?? ""] ?? group.familyName}</span></div>
					{group.providers.map((provider) => <div className="family-provider-group" key={provider.key}>
						<div className="family-provider-head">{provider.name}</div>
						{provider.models.map((model) => {
							const index = rendered++;
							const selected = sameModel(model, current);
							return <button key={`${model.provider}/${model.id}`} id={`${id}-${index}`} className={`family-option ${index === active ? "focused" : ""}`} role="option" aria-selected={selected} aria-label={`选择 ${group.familyName} ${provider.name} ${model.id}`} disabled={disabled} onMouseMove={() => setActive(index)} onClick={() => onSelect(model)}>
								<div className="family-option-main"><strong>{model.name ?? model.id}</strong>{selected && <Icon name="check" size={14} />}</div>
								<small>{subtitle(model)}</small>
							</button>;
						})}
					</div>)}
				</section>;
			})}
			{!groups.length && <p className="menu-hint">没有匹配的模型</p>}
		</div>
		{configurationHint && <p className="menu-hint" role="status">{configurationHint}</p>}
		<div className="family-picker-foot"><Button variant="ghost" size="compact" onClick={onManage} disabled={disabled}><Icon name="settings" size={13} />管理提供商…</Button></div>
	</div>;
}
