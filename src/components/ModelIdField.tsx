import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { sortDiscoveredModels } from "../chat/modelDiscovery";
import { discoverModels } from "../rpc/modelDiscovery";
import { Icon } from "./Icon";

export function ModelIdField({ baseUrl, apiKey, familyId, value, onChange, addedIds = [], onAdd, disabled }: {
	baseUrl: string;
	apiKey: string;
	familyId: string;
	value: string;
	onChange: (id: string) => void;
	addedIds?: string[];
	onAdd?: (ids: string[]) => void;
	disabled: boolean;
}) {
	const fieldId = useId();
	const [selected, setSelected] = useState<string[]>([]);
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const activeRef = useRef<HTMLButtonElement>(null);
	const requestRef = useRef(0);
	const inFlight = useRef(false);
	const valueRef = useRef(value);
	valueRef.current = value;
	const [loading, setLoading] = useState(false);
	const [models, setModels] = useState<string[]>([]);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeId, setActiveId] = useState("");
	const [error, setError] = useState<string>();
	const filtered = useMemo(() => models.filter((id) => id.toLowerCase().includes(query.trim().toLowerCase())), [models, query]);
	const active = filtered.includes(activeId) ? activeId : filtered[0];
	const activeIndex = filtered.indexOf(active);
	const optionId = activeIndex >= 0 ? `${fieldId}-option-${activeIndex}` : undefined;

	// Invalidate responses when credentials change, the draft closes, or a
	// different provider is opened. Native requests still have a 10s deadline.
	useEffect(() => {
		requestRef.current += 1;
		inFlight.current = false;
		setLoading(false); setOpen(false); setModels([]); setQuery(""); setError(undefined);
		return () => { requestRef.current += 1; };
	}, [baseUrl, apiKey, familyId]);

	useEffect(() => {
		if (!error) return;
		const timer = window.setTimeout(() => setError(undefined), 5000);
		return () => window.clearTimeout(timer);
	}, [error]);

	useEffect(() => {
		if (open) (models.length > 10 ? searchRef : inputRef).current?.focus();
	}, [open, models]);
	useEffect(() => { if (open) activeRef.current?.scrollIntoView({ block: "nearest" }); }, [open, active]);
	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
		document.addEventListener("pointerdown", closeOutside);
		return () => document.removeEventListener("pointerdown", closeOutside);
	}, [open]);

	const fetchModels = async () => {
		if (disabled || inFlight.current || !baseUrl.trim() || !apiKey.trim()) return;
		const request = ++requestRef.current;
		inFlight.current = true;
		setLoading(true); setError(undefined); setOpen(false); setQuery("");
		try {
			const ids = sortDiscoveredModels(await discoverModels(baseUrl, apiKey), familyId);
			if (request !== requestRef.current) return;
			if (!ids.length) throw new Error("接口未返回模型，请手动填写模型 ID");
			setSelected([]); setModels(ids); setActiveId(ids.includes(valueRef.current.trim()) ? valueRef.current.trim() : ids[0]); setOpen(true);
		} catch (e) {
			if (request === requestRef.current) setError(String(e).replace(/^Error: /, "").replaceAll(apiKey.trim(), "[已隐藏]"));
		} finally {
			if (request === requestRef.current) { inFlight.current = false; setLoading(false); }
		}
	};
	const choose = (id: string) => {
		if (disabled || addedIds.includes(id)) return;
		if (onAdd) { setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]); return; }
		onChange(id); setOpen(false); inputRef.current?.focus();
	};
	const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape" && (open || error)) {
			event.preventDefault(); event.stopPropagation(); setOpen(false); setError(undefined); inputRef.current?.focus();
		} else if (open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key) && !event.nativeEvent.isComposing) {
			if (event.target instanceof HTMLButtonElement && event.target.getAttribute("role") !== "option") return;
			event.preventDefault(); event.stopPropagation();
			if (event.key === "Enter") { if (active) choose(active); }
			else if (filtered.length) setActiveId(filtered[(activeIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length]);
		}
	};

	return <div ref={rootRef} className="provider-field model-discovery" onKeyDown={keyDown} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
		<label htmlFor={fieldId}>模型 ID</label>
		<div className="field-with-action">
			<input ref={inputRef} id={fieldId} required role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${fieldId}-list` : undefined} aria-activedescendant={open ? optionId : undefined} placeholder="deepseek-chat / kimi-k2 / glm-4.6" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
			<button type="button" className="btn ghost compact model-discovery-trigger" onClick={() => void fetchModels()} disabled={disabled || loading || !baseUrl.trim() || !apiKey.trim()} aria-busy={loading}>{loading && <span className="model-discovery-spinner" aria-hidden="true" />}{loading ? "获取中…" : "获取模型列表"}</button>
		</div>
		{open && <div className="model-discovery-menu">
			<div className="model-discovery-heading"><span>{filtered.length} 个模型</span><button type="button" className="icon-btn" aria-label="关闭模型列表" onClick={() => { setOpen(false); inputRef.current?.focus(); }}><Icon name="close" size={14} /></button></div>
			{models.length > 10 && <input ref={searchRef} className="model-discovery-search" type="search" placeholder="搜索模型 ID…" aria-label="搜索模型 ID" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${fieldId}-list`} aria-activedescendant={optionId} value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} />}
			<div id={`${fieldId}-list`} className="model-discovery-options" role="listbox" aria-multiselectable={!!onAdd} aria-label="可用模型" aria-busy={loading}>
				{filtered.map((id, index) => <button ref={id === active ? activeRef : undefined} id={`${fieldId}-option-${index}`} type="button" role="option" aria-selected={onAdd ? selected.includes(id) : id === value.trim()} className={`model-discovery-option${id === active ? " active" : ""}`} key={id} tabIndex={-1} onMouseEnter={() => setActiveId(id)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(id)} disabled={disabled || addedIds.includes(id)}>{onAdd && <span aria-hidden="true">{selected.includes(id) ? "☑" : "☐"}</span>}<span>{id}{addedIds.includes(id) ? "（已添加）" : ""}</span>{!onAdd && id === value.trim() && <Icon name="check" size={14} />}</button>)}
				{!filtered.length && <p className="model-discovery-empty" role="status">没有匹配的模型</p>}
			</div>
			{onAdd && <button type="button" className="btn primary compact" disabled={disabled || !selected.length} onClick={() => { onAdd(models.filter((id) => selected.includes(id) && !addedIds.includes(id))); setOpen(false); setSelected([]); inputRef.current?.focus(); }}>添加选中的 {selected.length} 个模型</button>}
		</div>}
		{error && <div className="model-discovery-error" role="alert"><span>{error}</span><button type="button" className="icon-btn" aria-label="关闭模型获取错误" onClick={() => setError(undefined)}><Icon name="close" size={14} /></button></div>}
	</div>;
}
