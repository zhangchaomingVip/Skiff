import { useEffect, useId, useState } from "react";
import type { ModelInfo } from "../chat/types";
import { Icon } from "./Icon";

export function ModelPicker({ models, current, onSelect, disabled = false }: {
	models: ModelInfo[]; current?: ModelInfo; onSelect: (model: ModelInfo) => void; disabled?: boolean;
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const id = useId();
	useEffect(() => { document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [id, active, query]);
	const filtered = models.filter((model) => `${model.name ?? ""} ${model.id} ${model.provider}`.toLowerCase().includes(query.toLowerCase()));
	return <div className="model-picker">
		<div className="model-search"><Icon name="search" size={15} /><input autoFocus aria-label="搜索模型" role="combobox" aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined} placeholder="搜索模型或提供商…" value={query} disabled={disabled} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((n) => Math.max(0, Math.min(filtered.length - 1, n + (event.key === "ArrowDown" ? 1 : -1)))); }
			if (event.key === "Enter" && filtered[active]) { event.preventDefault(); onSelect(filtered[active]); }
		}} /></div>
		<div className="model-list" id={id} role="listbox" aria-label="可用模型">{filtered.map((model, index) => {
			const selected = model.id === current?.id && model.provider === current.provider;
			return <button key={`${model.provider}/${model.id}`} id={`${id}-${index}`} className={`model-option ${index === active ? "focused" : ""}`} role="option" aria-selected={selected} aria-label={`选择 ${model.name ?? model.id}`} disabled={disabled} onFocus={() => setActive(index)} onClick={() => onSelect(model)}>
				<div><strong>{model.name ?? model.id}</strong>{selected && <Icon name="check" size={14} />}</div><small>{model.provider}{model.contextWindow ? ` · ${(model.contextWindow / 1000).toLocaleString()}k 上下文` : ""}{model.input?.includes("image") ? " · 图片" : ""}</small>
				{typeof model.cost?.input === "number" && typeof model.cost.output === "number" && <small>输入 ${model.cost.input} · 输出 ${model.cost.output} / 百万 tokens</small>}
			</button>;
		})}{!filtered.length && <p className="menu-hint">没有匹配的模型</p>}</div>
	</div>;
}
