import { useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton, Popover } from "./ui";
import { Icon } from "./Icon";
import { settingsCategories, type SettingsCategory, type SettingsRestrictions } from "./settingsNavigation";

/** Title bar entry for settings: the menu seeds the category the dialog opens on. */
export function SettingsMenu({ restrictions, onOpen }: { restrictions: SettingsRestrictions; onOpen: (category: SettingsCategory) => void }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => { if (open) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open]);
	return <>
		<IconButton ref={trigger} size="compact" className="settings-trigger" aria-label="设置" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}><Icon name="settings" /></IconButton>
		{open && <Popover anchor={trigger} aria-label="设置分类" onClose={() => setOpen(false)} className="settings-menu">
			<div ref={panel}>{settingsCategories.map(({ id, label, icon }) => <div key={id}>
				<Button variant="ghost" disabled={!!restrictions[id]} title={restrictions[id]} onClick={() => { trigger.current?.focus(); setOpen(false); onOpen(id); }}><Icon name={icon} size={16} />{label}</Button>
				{restrictions[id] && <small>{restrictions[id]}</small>}
			</div>)}</div>
		</Popover>}
	</>;
}
