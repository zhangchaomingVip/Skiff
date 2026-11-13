import { memo, type ReactNode } from "react";

/** Retain browsing state, but defer hidden route props until the route is shown. */
export const WorkspaceRoute = memo(function WorkspaceRoute({ active, label, className, children }: { active: boolean; label: string; className: string; children: ReactNode }) {
	return <div className={className} hidden={!active} aria-label={label}>{children}</div>;
}, (before, after) => !before.active && !after.active);
