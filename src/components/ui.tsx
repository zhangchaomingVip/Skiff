import { cloneElement, isValidElement, forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode, type ReactElement, type RefObject } from "react";
import { Icon } from "./Icon";

type Size = "compact" | "regular" | "primary";
type Variant = "secondary" | "primary" | "ghost" | "danger";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { size?: Size; variant?: Variant; loading?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ size = "regular", variant = "secondary", loading, disabled, type = "button", className = "", children, ...props }, ref) {
	return <button {...props} ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} data-size={size} data-variant={variant} className={`ui-button ${className}`}><span className="ui-button-content">{loading && <Icon name="clock" size={16} />}{children}</span></button>;
});
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(function IconButton({ size = "regular", className = "", ...props }, ref) {
	return <Button {...props} size={size} className={`ui-icon-button ${className}`} ref={ref} />;
});
export function Card({ selected, className = "", ...props }: HTMLAttributes<HTMLElement> & { selected?: boolean }) {
	return <article {...props} data-selected={selected || undefined} className={`ui-card ${className}`} />;
}
export const ListRow = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function ListRow({ className = "", type = "button", ...props }, ref) {
	return <button {...props} ref={ref} type={type} className={`ui-list-row ${className}`} />;
});
export function Chip({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" }) {
	return <span {...props} data-tone={tone} className={`ui-chip ${className}`} />;
}
type FieldAppearance = { appearance?: "default" | "plain" };
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldAppearance>(function Input({ appearance = "default", className = "", ...props }, ref) {
	return <input {...props} ref={ref} data-appearance={appearance} className={`ui-input ${className}`} />;
});
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldAppearance>(function TextArea({ appearance = "default", className = "", ...props }, ref) {
	return <textarea {...props} ref={ref} data-appearance={appearance} className={`ui-input ui-textarea ${className}`} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = "", ...props }, ref) {
	return <select {...props} ref={ref} className={`ui-input ${className}`} />;
});
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }>(function Field({ label, error, hint, id: suppliedId, "aria-describedby": describedBy, ...props }, ref) {
	const generated = useId();
	const id = suppliedId ?? generated;
	return <div className="ui-field"><label htmlFor={id}>{label}</label><Input {...props} ref={ref} id={id} aria-invalid={!!error || undefined} aria-describedby={[describedBy, error || hint ? `${id}-help` : undefined].filter(Boolean).join(" ") || undefined} />{(error || hint) && <span id={`${id}-help`} className="ui-field-help" role={error ? "alert" : undefined}>{error ?? hint}</span>}</div>;
});

function restoreFocus(target: Element | null, fallbackSelector?: string) {
	if (target instanceof HTMLElement && target !== document.body && target !== document.documentElement && target.isConnected && !target.matches(":disabled") && !target.closest("[inert]") && target.getClientRects().length > 0) target.focus();
	else {
		const fallback = [fallbackSelector, "dialog[open] button:not(:disabled)", ".voyage-summary", ".chat-header button:not(:disabled)"].filter((selector): selector is string => !!selector).map((selector) => document.querySelector<HTMLElement>(selector)).find((element) => element && element.getClientRects().length > 0);
		fallback?.focus();
	}
}
type DialogProps = Omit<HTMLAttributes<HTMLDialogElement>, "onClose"> & { onClose: () => void; pending?: boolean; initialFocus?: RefObject<HTMLElement>; returnFocusSelector?: string; onEscape?: () => void; variant?: "modal" | "drawer" };
export function Dialog({ onClose, onEscape, pending, initialFocus, returnFocusSelector, variant = "modal", className = "", children, ...props }: DialogProps) {
	const ref = useRef<HTMLDialogElement>(null);
	useLayoutEffect(() => {
		const target = document.activeElement;
		const dialog = ref.current;
		dialog?.showModal();
		(initialFocus?.current ?? dialog?.querySelector<HTMLElement>("[autofocus], input:not([type=checkbox]):not(:disabled), textarea:not(:disabled), button:not(:disabled)"))?.focus();
		// A drawer may remove its trigger while open. Restore after React has
		// committed the replacement trigger and removed the dialog subtree.
		return () => { dialog?.close(); queueMicrotask(() => restoreFocus(target, returnFocusSelector)); };
	}, []);
	return <dialog {...props} ref={ref} data-variant={variant} className={`ui-dialog ${className}`} onClick={(event) => { props.onClick?.(event); if (variant === "drawer" && event.target === event.currentTarget && !pending) onClose(); }} onCancel={(event) => { event.preventDefault(); if (!pending) (onEscape ?? onClose)(); }} onKeyDown={(event) => {
		props.onKeyDown?.(event);
		if (event.key === "Escape") event.stopPropagation();
		if (event.key !== "Tab" || event.defaultPrevented) return;
		const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], summary, [tabindex]")).filter((item) => !item.matches(":disabled, [hidden], [tabindex='-1']") && item.getClientRects().length > 0);
		const target = event.shiftKey ? focusable[focusable.length - 1] : focusable[0];
		if (!focusable.length || document.activeElement === (event.shiftKey ? focusable[0] : focusable[focusable.length - 1])) { event.preventDefault(); target?.focus(); }
	}}>{children}</dialog>;
}

const popovers: symbol[] = [];
export function Popover({ anchor, onClose, className = "", children, ...props }: HTMLAttributes<HTMLDivElement> & { anchor: RefObject<HTMLElement>; onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const closeRef = useRef(onClose);
	closeRef.current = onClose;
	const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number }>();
	useLayoutEffect(() => {
		const align = () => {
			const rect = anchor.current?.getBoundingClientRect();
			const panel = ref.current;
			if (!rect || !panel) return;
			const width = Math.min(360, window.innerWidth - 24);
			const below = window.innerHeight - rect.bottom - 12;
			const above = rect.top - 12;
			const maxHeight = Math.max(100, Math.max(above, below) - 6);
			const height = Math.min(panel.scrollHeight, maxHeight);
			setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: below >= height ? rect.bottom + 6 : Math.max(12, rect.top - height - 6), maxHeight });
		};
		align(); window.addEventListener("resize", align); window.addEventListener("scroll", align, true);
		const resize = new ResizeObserver(align); if (ref.current) resize.observe(ref.current);
		return () => { resize.disconnect(); window.removeEventListener("resize", align); window.removeEventListener("scroll", align, true); };
	}, [anchor]);
	useEffect(() => {
		const id = Symbol(); popovers.push(id);
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || popovers[popovers.length - 1] !== id) return;
			event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); restoreFocus(anchor.current);
		};
		const outside = (event: PointerEvent) => { if (popovers[popovers.length - 1] === id && !ref.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) closeRef.current(); };
		document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", outside);
		return () => { popovers.splice(popovers.indexOf(id), 1); document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", outside); };
	}, [anchor]);
	return <div {...props} ref={ref} role={props.role ?? "dialog"} className={`ui-popover ${className}`} style={{ ...props.style, ...position }}>{children}</div>;
}
export function Tooltip({ text, children, align = "end" }: { text: string; children: ReactNode; align?: "start" | "end" }) {
	const id = useId();
	const [dismissed, setDismissed] = useState(false);
	return <span className="ui-tooltip-wrap" onFocus={() => setDismissed(false)} onMouseEnter={() => setDismissed(false)} onKeyDown={(event) => { if (event.key === "Escape") setDismissed(true); }}>{isValidElement(children) ? cloneElement(children as ReactElement<HTMLAttributes<HTMLElement>>, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") }) : children}<span className="ui-tooltip" data-align={align} hidden={dismissed} id={id} role="tooltip">{text}</span></span>;
}
export function SegmentedControl<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[]; label: string }) {
	return <div className="ui-segmented" role="group" aria-label={label}>{options.map((option, index) => <Button key={option.value} size="compact" variant="ghost" aria-pressed={value === option.value} tabIndex={value === option.value ? 0 : -1} onClick={() => onChange(option.value)} onKeyDown={(event) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
		onChange(options[next].value);
		(event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
	}}>{option.label}</Button>)}</div>;
}
