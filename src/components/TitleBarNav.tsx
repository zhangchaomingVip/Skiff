import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";
import { IconButton } from "./ui";

/** Top-left application bar: the mark and the sidebar toggle, nothing else. The
 *  file/edit/help text menus are gone, so the strip starts with window chrome and
 *  hands the remaining width to the mode switch and the drag region. The mark keeps
 *  the activity column's axis instead of pushing text into the corner. */
export function TitleBarNav({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
	const toggleLabel = sidebarOpen ? "收起侧栏" : "展开侧栏";
	return <nav className="titlebar-nav" aria-label="应用栏">
		<span className="titlebar-mark" role="img" aria-label="Skiff"><BrandMark /></span>
		<IconButton size="compact" className="titlebar-sidebar-toggle" onClick={onToggleSidebar} aria-label={toggleLabel} title={toggleLabel}><Icon name="panel" /></IconButton>
	</nav>;
}
