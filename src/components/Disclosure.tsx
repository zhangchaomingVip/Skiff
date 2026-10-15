import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";

/** Shared content for native details summaries and controlled turn folds. */
export function DisclosureLabel({ children, status }: { children: ReactNode; status?: ReactNode }) {
	return <><span className="disclosure"><Icon name="chevron" size={14} /></span>{children}{status && <span className="process-disclosure-status">{status}</span>}</>;
}

export function DisclosureButton({ expanded, children, status, actions, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { expanded: boolean; status?: ReactNode; actions?: ReactNode }) {
	return <><button {...props} type="button" className={`process-disclosure ${className}`} aria-expanded={expanded}><DisclosureLabel status={status}>{children}</DisclosureLabel></button>{actions}</>;
}
