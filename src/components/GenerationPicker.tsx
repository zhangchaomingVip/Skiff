import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { Popover } from "./ui";
import "./generation-workspace.css";

export interface GenerationPickerOption {
	value: string;
	label: string;
	hint?: string;
}

/** A pill that opens the design-home popover skeleton instead of a native
 *  select: service, model and quality keep the same quiet chip and panel in
 *  both themes, and never fall back to the OS dropdown. */
export function GenerationPicker({ id, label, icon, value, options, disabled, placeholder, onChange }: {
	id?: string;
	label: string;
	icon: IconName;
	value: string;
	options: GenerationPickerOption[];
	disabled?: boolean;
	placeholder: string;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const current = options.find((option) => option.value === value);
	const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
	useEffect(() => {
		if (!open) return;
		const selected = list.current?.querySelector<HTMLElement>("[role=option][aria-selected=true]") ?? list.current?.querySelector<HTMLElement>("[role=option]");
		selected?.focus();
	}, [open]);
	const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Tab") { close(); return; }
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=option]"));
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
		items[next]?.focus();
	};
	return <div className="generation-picker">
		<button type="button" id={id} ref={trigger} className="generation-picker-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={current ? `${label}：${current.label}` : label} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open && !disabled) setOpen(true); } }}>
			<Icon name={icon} size={13} />
			<span className="generation-picker-value">{current?.label ?? placeholder}</span>
			<span className="chev-caret" aria-hidden="true"><Icon name="chevron" size={11} /></span>
		</button>
		{open && createPortal(<Popover anchor={trigger} className="generation-picker-menu" aria-label={`选择${label}`} onClose={() => setOpen(false)} onKeyDown={navigate}>
			<p className="generation-picker-title">{label}</p>
			<div className="generation-picker-options" role="listbox" aria-label={label} ref={list}>
				{options.map((option) => {
					const selected = option.value === current?.value;
					return <button key={option.value} type="button" role="option" aria-selected={selected} tabIndex={-1} className="generation-picker-option" onClick={() => { onChange(option.value); close(true); }}>
						<span className="generation-picker-check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
						<span className="generation-picker-copy"><strong>{option.label}</strong>{option.hint && <small>{option.hint}</small>}</span>
					</button>;
				})}
			</div>
		</Popover>, trigger.current?.closest("dialog") ?? document.body)}
	</div>;
}
