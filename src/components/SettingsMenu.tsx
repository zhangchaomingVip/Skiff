import { useLayoutEffect, useRef, useState } from "react";
import { Button, Popover } from "./ui";
import { Icon } from "./Icon";
import { settingsCategories, type SettingsCategory, type SettingsRestrictions } from "./settingsNavigation";

export function SettingsMenu({ connected, active, restrictions, onOpen }: { connected: boolean; active: boolean; restrictions: SettingsRestrictions; onOpen: (category: SettingsCategory) => void }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => { if (open) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open]);
	return <div className="sidebar-footer settings-entry">
		<Button ref={trigger} variant="ghost" className="settings-trigger" aria-label="设置" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
			<Icon name="settings" /><span><strong>设置</strong><small>{active ? `当前会话：pi ${connected ? "已连接" : "未连接"}` : "无活动会话"}</small></span><Icon name="chevron" size={14} />
		</Button>
		{open && <Popover anchor={trigger} aria-label="设置分类" onClose={() => setOpen(false)} className="settings-menu">
			<div ref={panel}>{settingsCategories.map(({ id, label, icon }) => <div key={id}>
				<Button variant="ghost" disabled={!!restrictions[id]} title={restrictions[id]} onClick={() => { trigger.current?.focus(); setOpen(false); onOpen(id); }}><Icon name={icon} size={16} />{label}</Button>
				{restrictions[id] && <small>{restrictions[id]}</small>}
			</div>)}</div>
		</Popover>}
	</div>;
}
