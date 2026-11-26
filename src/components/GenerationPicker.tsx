import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { Popover } from "./ui";
import type { GenerationStudio } from "../workbench/useGenerationStudio";
import "./generation-workspace.css";

export interface GenerationPickerOption {
	value: string;
	label: string;
	hint?: string;
	/** What the closed chip shows, when it needs more than the menu label (e.g. a service to tell twins apart). */
	display?: string;
	/** Options sharing a group render under one heading (e.g. the service a model comes from). */
	group?: string;
}

/** A pill that opens the design-home popover skeleton instead of a native
 *  select: service, model and quality keep the same quiet chip and panel in
 *  both themes, and never fall back to the OS dropdown. */
export function GenerationPicker({ id, label, icon, prefix, value, options, disabled, placeholder, onChange }: {
	id?: string;
	/** Short visible role for the chip ("存到", "质量"), so a bare value never has to explain itself. */
	prefix?: string;
	label: string;
	icon?: IconName;
	value: string;
	options: GenerationPickerOption[];
	disabled?: boolean;
	placeholder: string;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	// A mouse-opened menu moves focus for keyboard continuity but must not paint the keyboard ring.
	const [pointer, setPointer] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const current = options.find((option) => option.value === value);
	const grouped = new Set(options.map((option) => option.group)).size > 1;
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
		<button type="button" id={id} ref={trigger} className="generation-picker-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={current ? `${label}：${current.display ?? current.label}` : label} onClick={(event) => { setPointer(event.detail > 0); setOpen((value) => !value); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setPointer(false); if (!open && !disabled) setOpen(true); } }}>
			{icon && <Icon name={icon} size={13} />}
			{prefix && <span className="generation-picker-prefix" aria-hidden="true">{prefix}</span>}
			<span className="generation-picker-value">{current ? current.display ?? current.label : placeholder}</span>
			<span className="chev-caret" aria-hidden="true"><Icon name="chevron" size={11} /></span>
		</button>
		{open && createPortal(<Popover anchor={trigger} className="generation-picker-menu" aria-label={`选择${label}`} onClose={() => setOpen(false)} onKeyDown={navigate}>
			{!grouped && <p className="generation-picker-title">{label}</p>}
			<div className="generation-picker-options" role="listbox" aria-label={label} ref={list} data-pointer={pointer || undefined} onKeyDown={() => setPointer(false)}>
				{options.map((option, index) => {
					const selected = option.value === current?.value;
					const heading = grouped && option.group !== options[index - 1]?.group ? <p key={`group-${option.group}`} className="generation-picker-group" role="presentation">{option.group}</p> : null;
					return [heading, <button key={option.value} type="button" role="option" aria-selected={selected} tabIndex={-1} className="generation-picker-option" onClick={() => { onChange(option.value); close(true); }}>
						<span className="generation-picker-check" aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>
						<span className="generation-picker-copy"><strong>{option.label}</strong>{option.hint && <small>{option.hint}</small>}</span>
					</button>];
				})}
			</div>
		</Popover>, trigger.current?.closest("dialog") ?? document.body)}
	</div>;
}

/** Service and model travel together through one picker. */
export const modelKey = (serviceId: string, modelId: string) => `${serviceId}\u0000${modelId}`;
export const splitModelKey = (value: string) => value.split("\u0000") as [string, string];
/** The canvas new work lands in, named only inside a canvas route; home has no target until it sends. */
export function canvasTarget(studio: GenerationStudio) {
	if (studio.view !== "canvas") return undefined;
	return studio.canvases.find((canvas) => canvas.id === studio.canvasId)?.name ?? "早期作品";
}

/** The composer's single entry for a reference: upload from disk or reuse a past work.
 *  Drag and paste still work; this only makes the option discoverable. */
export function ReferenceAddMenu({ label, onUpload, onHistory }: { label: string; onUpload: () => void; onHistory?: () => void }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	useEffect(() => { if (open) list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus(); }, [open]);
	const pick = (action: () => void) => { setOpen(false); action(); };
	return <div className="generation-field generation-reference-add">
		<button type="button" ref={trigger} className="generation-picker-trigger generation-reference-add-trigger" aria-label={label} title={label} aria-haspopup={onHistory ? "menu" : undefined} aria-expanded={onHistory ? open : undefined} onClick={() => { if (onHistory) setOpen((value) => !value); else onUpload(); }}><Icon name="plus" size={15} /></button>
		{open && onHistory && createPortal(<Popover anchor={trigger} className="generation-picker-menu" role="menu" aria-label={label} onClose={() => setOpen(false)}>
			<div className="generation-picker-options" ref={list}>
				<button type="button" role="menuitem" className="generation-picker-option" onClick={() => pick(onUpload)}><span className="generation-picker-check" aria-hidden="true"><Icon name="upload" size={14} /></span><span className="generation-picker-copy"><strong>上传本地图片</strong><small>也可以直接拖入或粘贴</small></span></button>
				<button type="button" role="menuitem" className="generation-picker-option" onClick={() => pick(onHistory)}><span className="generation-picker-check" aria-hidden="true"><Icon name="clock" size={14} /></span><span className="generation-picker-copy"><strong>从历史作品中选</strong><small>用生成过的图片做参考</small></span></button>
			</div>
		</Popover>, trigger.current?.closest("dialog") ?? document.body)}
	</div>;
}

/** One entry per model across services. A model id offered by two services names its
 *  service on the closed chip, so the toolbar never shows two identical choices. */
export function modelOptions(services: Array<{ id: string; name: string; configured: boolean; models: Array<{ id: string }> }>) {
	const seen = new Map<string, number>();
	for (const service of services) for (const model of service.models) seen.set(model.id, (seen.get(model.id) ?? 0) + 1);
	return services.flatMap((service) => service.models.map((model) => ({
		value: modelKey(service.id, model.id),
		label: model.id,
		group: service.name,
		display: (seen.get(model.id) ?? 0) > 1 ? `${model.id} · ${service.name}` : undefined,
		hint: service.configured ? undefined : "未配置密钥",
	})));
}
