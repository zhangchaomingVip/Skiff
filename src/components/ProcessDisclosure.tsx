import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type ProcessLabelProps = { icon: IconName; label: ReactNode; status?: ReactNode };

function ProcessLabel({ icon, label, status, labelId, statusId }: ProcessLabelProps & { labelId?: string; statusId?: string }) {
	return <>
		<span className="process-row-icon"><Icon name={icon} size={16} /></span>
		<span className="process-row-label" id={labelId}>{label}</span>
		<span className="process-row-trailing">
			<span className="process-row-status" id={statusId}>{status}</span>
			<span className="disclosure"><Icon name="chevron" size={14} /></span>
		</span>
	</>;
}

/** Non-interactive turn metadata keeps the same columns without a fold affordance. */
export function ProcessRow(props: ProcessLabelProps) {
	return <div className="process-row process-row-static"><ProcessLabel {...props} /></div>;
}

/** Native keyboard behavior with the same icon, label, status and arrow slots for every process row. */
export function ProcessDisclosure({ children, className = "", title, summaryLabel, expanded: controlledExpanded, onExpandedChange, collapseOnSpace = false, ...labelProps }: ProcessLabelProps & { children: ReactNode; className?: string; title?: string; summaryLabel?: string; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void; collapseOnSpace?: boolean }) {
	const [localExpanded, setLocalExpanded] = useState(false);
	const expanded = controlledExpanded ?? localExpanded;
	const setExpanded = (value: boolean) => { setLocalExpanded(value); onExpandedChange?.(value); };
	const contentId = useId();
	return <details className={`process-details ${className}`} open={expanded} onToggle={(event) => {
		if (event.target === event.currentTarget && event.currentTarget.open !== expanded) setExpanded(event.currentTarget.open);
	}}>
		<summary role="button" className="process-row" title={title} aria-label={summaryLabel} aria-describedby={summaryLabel ? `${contentId}-label ${contentId}-status` : undefined} aria-expanded={expanded} aria-controls={contentId} onClick={(event) => { event.preventDefault(); setExpanded(!expanded); }} onKeyDown={(event) => {
			if (collapseOnSpace && event.key === " ") { event.preventDefault(); setExpanded(false); }
		}}><ProcessLabel {...labelProps} labelId={summaryLabel ? `${contentId}-label` : undefined} statusId={summaryLabel ? `${contentId}-status` : undefined} /></summary>
		<div className="process-detail-content" id={contentId}>{children}</div>
	</details>;
}

/** Controlled turn folding uses the same row as native process disclosures. */
export function ProcessDisclosureButton({ icon, label, status, expanded, className = "", ...props }: ProcessLabelProps & ButtonHTMLAttributes<HTMLButtonElement> & { expanded: boolean }) {
	return <button {...props} type="button" className={`process-row ${className}`} aria-expanded={expanded}><ProcessLabel icon={icon} label={label} status={status} /></button>;
}
