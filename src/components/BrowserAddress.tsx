import { useEffect, useId, useRef, useState } from "react";
import { browserHistoryEvent, browserHistoryKey, matchBrowserHistory, readBrowserHistory, removeBrowserVisit } from "../browser/history";
import { Icon } from "./Icon";

export function BrowserAddress({ initialValue, onSubmit, onCancel, disabled, newTab = false }: {
	initialValue: string;
	onSubmit: (value: string) => void;
	onCancel?: () => void;
	disabled: boolean;
	newTab?: boolean;
}) {
	const [value, setValue] = useState(initialValue);
	const [items, setItems] = useState(readBrowserHistory);
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState(-1);
	const input = useRef<HTMLInputElement>(null);
	const listId = useId();
	const matches = matchBrowserHistory(items, value);
	useEffect(() => { if (open && selected >= 0) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" }); }, [open, selected, listId]);
	useEffect(() => { if (!disabled) { input.current?.focus(); if (!newTab) input.current?.select(); } }, [newTab, disabled]);
	useEffect(() => {
		const update = () => setItems(readBrowserHistory());
		const storage = (event: StorageEvent) => { if (event.key === browserHistoryKey || event.key === null) update(); };
		window.addEventListener(browserHistoryEvent, update);
		window.addEventListener("storage", storage);
		return () => { window.removeEventListener(browserHistoryEvent, update); window.removeEventListener("storage", storage); };
	}, []);
	return <div className={`browser-omnibox${newTab ? " is-new-tab" : ""}`} onBlur={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); onCancel?.(); }
	}}>
		<div className="browser-omnibox-field">
			{newTab && <Icon name="search" size={20} />}
			<input ref={input} className="browser-address-input" aria-label="地址栏" role="combobox" aria-autocomplete="list" aria-expanded={open && matches.length > 0} aria-controls={listId} aria-activedescendant={open && selected >= 0 && matches[selected] ? `${listId}-${selected}` : undefined} value={value} placeholder="搜索或输入网址" disabled={disabled} onFocus={() => setOpen(true)} onChange={(event) => { setValue(event.target.value); setSelected(-1); setOpen(true); }} onKeyDown={(event) => {
				if (event.nativeEvent.isComposing || event.keyCode === 229) return;
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault(); setOpen(true);
					setSelected((previous) => matches.length ? previous < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1) : (previous + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length : -1);
				} else if (event.key === "Enter") {
					event.preventDefault(); onSubmit(open && selected >= 0 && matches[selected] ? matches[selected].url : value);
				} else if (event.key === "Escape") {
					event.preventDefault(); event.stopPropagation(); setOpen(false); setSelected(-1); onCancel?.();
				}
			}} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
		</div>
		{open && matches.length > 0 && <div className="browser-suggestions" id={listId} role="listbox" aria-label="浏览历史建议">
			{matches.map((item, index) => <div key={item.url} id={`${listId}-${index}`} role="option" aria-selected={selected === index} className={`browser-suggestion${selected === index ? " is-selected" : ""}`}>
				<button className="browser-suggestion-open" type="button" tabIndex={-1} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onSubmit(item.url)}>
					<Icon name="globe" size={18} /><span className="browser-suggestion-title">{item.title}</span><span className="browser-suggestion-url">{item.url.replace(/^https?:\/\//, "")}</span>
				</button>
				<button className="browser-suggestion-remove" type="button" aria-label={`删除历史记录 ${item.title}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { removeBrowserVisit(item.url); setSelected(-1); input.current?.focus(); }}><Icon name="close" size={14} /></button>
			</div>)}
		</div>}
	</div>;
}
