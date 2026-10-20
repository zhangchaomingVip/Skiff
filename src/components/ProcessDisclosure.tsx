import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type ProcessLabelProps = { icon: IconName; label: ReactNode; status?: ReactNode };

function ProcessLabel({ icon, label, status }: ProcessLabelProps) {
	return <>
		<span className="process-row-icon"><Icon name={icon} size={16} /></span>
		<span className="process-row-label">{label}</span>
		<span className="process-row-status">{status}</span>
		<span className="disclosure"><Icon name="chevron" size={14} /></span>
	</>;
}

/** Native keyboard behavior with the same icon, label, status and arrow slots for every process row. */
export function ProcessDisclosure({ children, className = "", title, ...labelProps }: ProcessLabelProps & { children: ReactNode; className?: string; title?: string }) {
	const [expanded, setExpanded] = useState(false);
	const contentId = useId();
	return <details className={`process-details ${className}`} open={expanded} onToggle={(event) => {
		if (event.target === event.currentTarget) setExpanded(event.currentTarget.open);
	}}>
		<summary className="process-row" title={title} aria-expanded={expanded} aria-controls={contentId}><ProcessLabel {...labelProps} /></summary>
		<div className="process-detail-content" id={contentId}>{children}</div>
	</details>;
}

/** Controlled turn folding uses the same row as native process disclosures. */
export function ProcessDisclosureButton({ icon, label, status, expanded, className = "", ...props }: ProcessLabelProps & ButtonHTMLAttributes<HTMLButtonElement> & { expanded: boolean }) {
	return <button {...props} type="button" className={`process-row ${className}`} aria-expanded={expanded}><ProcessLabel icon={icon} label={label} status={status} /></button>;
}
