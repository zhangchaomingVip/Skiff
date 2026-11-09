import { type CSSProperties, type ReactNode } from "react";
import type { BrowserPanelControls } from "../browser/useBrowserPanel";
import type { BrowserActions } from "../browser/useBrowserActions";
import { BrowserPanel } from "./BrowserPanel";
import { ResizeSeparator } from "./ResizeSeparator";

export function BrowserWorkspace({ children, chatId, controls, browserActions, availableWidth, width, onWidth, onWidthCommit, focusRequest, busy, onSettings, onReconnect }: {
	children: ReactNode;
	chatId?: string;
	controls: BrowserPanelControls;
	browserActions: BrowserActions;
	availableWidth: number;
	width: number;
	onWidth: (width: number) => void;
	onWidthCommit: (width: number) => void;
	focusRequest: number;
	busy: boolean;
	onSettings: () => void;
	onReconnect: () => void;
}) {
	const compact = window.innerWidth <= 760 || availableWidth < 720;
	const bounds = { min: 320, max: Math.max(320, Math.min(1000, availableWidth - 368)) };
	const shownWidth = Math.min(bounds.max, Math.max(bounds.min, width));
	const open = !!chatId && controls.expanded;
	return <div className={`browser-workspace${open ? " is-open" : ""}${compact ? " is-compact" : ""}`} style={{ "--browser-width": `${shownWidth}px` } as CSSProperties}>
		<div className="browser-chat" hidden={compact && open}>{children}</div>
		{open && !compact && <ResizeSeparator label="调整浏览器面板宽度" value={shownWidth} bounds={bounds} direction={-1} onResize={onWidth} onCommit={onWidthCommit} />}
		{open && chatId && <BrowserPanel key={chatId} chatId={chatId} controls={controls} browserActions={browserActions} compact={compact} focusRequest={focusRequest} busy={busy} onSettings={onSettings} onReconnect={onReconnect} onCollapse={() => controls.setExpanded(false)} />}
	</div>;
}
