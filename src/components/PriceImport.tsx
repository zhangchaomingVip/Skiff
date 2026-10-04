import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { FAMILY_KEYWORDS } from "../chat/modelDiscovery";
import { importPricedModels, type PricedModel } from "../chat/pricingPage";
import { fetchPricingPage } from "../rpc/pricingPage";
import { Icon } from "./Icon";

const formatCost = (value: number) => String(Number(value.toFixed(6)));
const formatContext = (value: number | null) => {
	if (!value) return "";
	if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
};

/**
 * Pricing-page import: paste a public models/pricing URL, pick the models to
 * pull in, and the route form fills ids, prices and limits from the result.
 */
export function PriceImport({ familyId, addedIds, disabled, onImport }: {
	familyId: string;
	addedIds: string[];
	disabled: boolean;
	onImport: (models: PricedModel[]) => void;
}) {
	const [open, setOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [loading, setLoading] = useState(false);
	const [models, setModels] = useState<PricedModel[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [query, setQuery] = useState("");
	const [error, setError] = useState<string>();
	const requestRef = useRef(0);

	useEffect(() => {
		if (!error) return;
		const timer = window.setTimeout(() => setError(undefined), 6000);
		return () => window.clearTimeout(timer);
	}, [error]);

	const added = useMemo(() => new Set(addedIds.map((id) => id.toLowerCase())), [addedIds]);
	const keywords = FAMILY_KEYWORDS[familyId] ?? [familyId];
	const ranked = (list: PricedModel[]) => {
		const boost = (id: string) => keywords.some((word) => id.toLowerCase().includes(word));
		return list.length > 20
			? [...list].sort((a, b) => Number(boost(b.modelId)) - Number(boost(a.modelId)) || a.modelId.localeCompare(b.modelId))
			: [...list].sort((a, b) => a.modelId.localeCompare(b.modelId));
	};
	const filtered = useMemo(() => models.filter((model) => model.modelId.toLowerCase().includes(query.trim().toLowerCase())), [models, query]);

	const run = async () => {
		if (disabled || loading || !url.trim()) return;
		const request = ++requestRef.current;
		setLoading(true); setError(undefined);
		try {
			const models = ranked(await importPricedModels(url.trim(), fetchPricingPage));
			if (request !== requestRef.current) return;
			setModels(models);
			setSelected(models.map((model) => model.modelId));
			setQuery("");
		} catch (error) {
			if (request === requestRef.current) { setModels([]); setSelected([]); setError(String(error).replace(/^Error: /, "")); }
		} finally {
			if (request === requestRef.current) setLoading(false);
		}
	};

	const keyDown = (event: KeyboardEvent) => {
		if (event.key === "Enter" && !event.nativeEvent.isComposing) {
			event.preventDefault();
			void run();
		}
	};
	const toggle = (modelId: string) => {
		setSelected((items) => items.includes(modelId) ? items.filter((item) => item !== modelId) : [...items, modelId]);
	};
	const importSelected = () => {
		const picked = models.filter((model) => selected.includes(model.modelId) && !added.has(model.modelId.toLowerCase()));
		if (!picked.length) return;
		onImport(picked);
		setOpen(false);
	};

	return <>
		<button type="button" className="btn ghost compact" onClick={() => setOpen((value) => !value)} aria-expanded={open} disabled={disabled}>从价格页导入</button>
		{open && <div className="price-import">
			<div className="price-import-row">
				<input type="url" inputMode="url" placeholder="https://tokenrhythm.studio/models" aria-label="定价页地址" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={keyDown} disabled={disabled || loading} />
				<button type="button" className="btn ghost compact" onClick={() => void run()} disabled={disabled || loading || !url.trim()} aria-busy={loading}>{loading && <span className="model-discovery-spinner" aria-hidden="true" />}{loading ? "获取中…" : "获取价格"}</button>
			</div>
			<small>粘贴服务商公开的模型价格页，自动识别模型、单价与上下文长度。</small>
			{error && <div className="model-discovery-error" role="alert"><span>{error}</span><button type="button" className="icon-btn" aria-label="关闭导入错误" onClick={() => setError(undefined)}><Icon name="close" size={14} /></button></div>}
			{models.length > 0 && <div className="price-import-list">
				{models.length > 10 && <input className="price-import-search" type="search" placeholder="搜索模型 ID…" aria-label="搜索模型 ID" value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />}
				{filtered.map((model) => {
					const isAdded = added.has(model.modelId.toLowerCase());
					return <label className={`price-import-option${isAdded ? " disabled" : ""}`} key={model.modelId}>
						<input type="checkbox" checked={selected.includes(model.modelId)} disabled={disabled || isAdded} onChange={() => toggle(model.modelId)} />
						<span className="price-import-id">{model.modelId}{model.note && <span className="provider-tag muted-tag">{model.note}</span>}{isAdded && <span className="provider-tag">已添加</span>}</span>
						<small>入 {formatCost(model.inputCost)} / 出 {formatCost(model.outputCost)} · {model.currency}{model.contextWindow ? ` · 上下文 ${formatContext(model.contextWindow)}` : ""}</small>
					</label>;
				})}
				{!filtered.length && <p className="model-discovery-empty" role="status">没有匹配的模型</p>}
			</div>}
			{models.length > 0 && <div className="price-import-actions"><button type="button" className="btn primary compact" onClick={importSelected} disabled={disabled || !selected.some((id) => !added.has(id.toLowerCase()))}>导入 {selected.filter((id) => !added.has(id.toLowerCase())).length} 个模型</button></div>}
		</div>}
	</>;
}
