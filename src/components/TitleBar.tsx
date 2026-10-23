import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "./ui";
import { Icon } from "./Icon";

/**
 * Custom window title bar shown when the native frame is disabled
 * (`decorations: false`). The strip is the drag region; the three buttons
 * replicate minimize / maximize / close.
 *
 * `data-tauri-drag-region="deep"` is required: without the `deep` value Tauri
 * only starts a drag when the pointer target is the marked element itself, and
 * the spacer/controls children fill the whole strip. Buttons still block
 * dragging, and Tauri handles double-click maximize natively in `deep` mode,
 * so no React double-click handler is needed here.
 */
export function TitleBar({ nav, voyageOpen, onToggleVoyage, children }: { nav?: ReactNode; voyageOpen?: boolean; onToggleVoyage?: () => void; children?: ReactNode }) {
	// Browser previews do not expose a complete Tauri runtime. Keep the title
	// bar visible there while leaving native window controls available in Tauri.
	const win = (() => {
		try {
			return getCurrentWindow();
		} catch {
			return null;
		}
	})();
	const stop = (event: ReactMouseEvent) => event.stopPropagation();
	// Window commands reject outside a Tauri context (browser preview); ignore that.
	const run = (action: Promise<void>) => void action.catch(() => undefined);
	return (
		<div className="titlebar" data-tauri-drag-region="deep">
			{nav}
			<div className="titlebar-spacer" />
			{(children || onToggleVoyage) && <div className="titlebar-tools">{children}{onToggleVoyage && <IconButton size="compact" onClick={onToggleVoyage} aria-pressed={voyageOpen} aria-label="航行台" title={voyageOpen ? "收起航行台" : "展开航行台"}><Icon name="gauge" /></IconButton>}</div>}
			<div className="titlebar-controls">
				<button className="titlebar-btn" type="button" onClick={() => { if (win) run(win.minimize()); }} onMouseDown={stop} aria-label="最小化" title="最小化"><Icon name="minimize" size={16} /></button>
				<button className="titlebar-btn" type="button" onClick={() => { if (win) run(win.toggleMaximize()); }} onMouseDown={stop} aria-label="最大化或还原" title="最大化/还原"><Icon name="maximize" size={15} /></button>
				<button className="titlebar-btn titlebar-close" type="button" onClick={() => { if (win) run(win.close()); }} onMouseDown={stop} aria-label="关闭" title="关闭"><Icon name="close" size={16} /></button>
			</div>
		</div>
	);
}
