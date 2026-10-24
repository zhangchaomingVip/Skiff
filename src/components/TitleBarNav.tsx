import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton, Popover } from "./ui";
import { isMacPlatform, type SettingsCategory } from "./settingsNavigation";
import type { ChatMessage } from "../chat/types";

type MenuEntry = { label: string; shortcut?: string; disabled?: boolean; onSelect: () => void };

const messageText = (message: ChatMessage) => message.blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n").trim();

/** Clipboard writes go through the async API, falling back to the selection trick when the webview denies it. */
async function copyText(text: string) {
	if (!text) return;
	try { await navigator.clipboard.writeText(text); return; } catch { /* fall through */ }
	const area = document.createElement("textarea");
	area.value = text;
	area.style.position = "fixed";
	area.style.opacity = "0";
	document.body.append(area);
	area.select();
	document.execCommand("copy");
	area.remove();
}

function Menu({ label, sections }: { label: string; sections: MenuEntry[][] }) {
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => { if (open) panel.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }, [open]);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']:not(:disabled)") ?? []);
		if (!items.length) return;
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		const next = event.key === "ArrowDown" ? (index < 0 ? 0 : index + 1) : event.key === "ArrowUp" ? (index < 0 ? items.length - 1 : index - 1) : event.key === "Home" ? 0 : items.length - 1;
		items[(next + items.length) % items.length]?.focus();
	};
	return <>
		<button ref={trigger} type="button" className="titlebar-menu-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{label}</button>
		{open && <Popover anchor={trigger} aria-label={label} className="titlebar-menu" onClose={() => setOpen(false)}>
			<div ref={panel} role="menu" aria-label={label} onKeyDown={onKeyDown}>
				{sections.map((section, index) => <Fragment key={index}>
					{index > 0 && <div role="separator" className="titlebar-menu-separator" />}
					{section.map((entry) => <Button key={entry.label} role="menuitem" variant="ghost" disabled={entry.disabled} onClick={() => { trigger.current?.focus(); setOpen(false); entry.onSelect(); }}>{entry.label}{entry.shortcut && <span className="shortcut">{entry.shortcut}</span>}</Button>)}
				</Fragment>)}
			</div>
		</Popover>}
	</>;
}

/** Top-left application bar: brand, sidebar toggle and the file/edit/help menus. */
export function TitleBarNav({ sidebarOpen, onToggleSidebar, onNewChat, onHome, onAddProject, onOpenSettings, messages }: {
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	onNewChat: () => void;
	onHome: () => void;
	onAddProject: () => void;
	onOpenSettings: (category?: SettingsCategory) => void;
	messages: ChatMessage[];
}) {
	const [about, setAbout] = useState(false);
	const lastReply = [...messages].reverse().find((message) => message.role === "assistant");
	const lastReplyText = lastReply ? messageText(lastReply) : "";
	const transcript = messages.map((message) => `${message.role === "user" ? "你" : "Skiff"}：${messageText(message)}`).filter((line) => !line.endsWith("：")).join("\n\n");
	const toggleLabel = sidebarOpen ? "收起侧栏" : "展开侧栏";
	const modifier = isMacPlatform() ? "Cmd" : "Ctrl";
	return <>
		<nav className="titlebar-nav" aria-label="应用菜单">
			<span className="titlebar-mark"><BrandMark /></span>
			<span className="titlebar-brand">Skiff</span>
			<IconButton size="compact" className="titlebar-sidebar-toggle" onClick={onToggleSidebar} aria-label={toggleLabel} title={toggleLabel}><Icon name="panel" /></IconButton>
			<Menu label="文件" sections={[
				[{ label: "新建聊天", shortcut: `${modifier}+N`, onSelect: onNewChat }],
				[{ label: "主页", onSelect: onHome }, { label: "添加项目…", onSelect: onAddProject }],
				[{ label: "设置…", shortcut: `${modifier}+,`, onSelect: () => onOpenSettings() }],
			]} />
			<Menu label="编辑" sections={[[
				{ label: "复制最近回复", disabled: !lastReplyText, onSelect: () => void copyText(lastReplyText) },
				{ label: "复制全部对话", disabled: !transcript, onSelect: () => void copyText(transcript) },
			]]} />
			<Menu label="帮助" sections={[[
				{ label: "快捷键", onSelect: () => onOpenSettings("shortcuts") },
				{ label: "关于 Skiff", onSelect: () => setAbout(true) },
			]]} />
		</nav>
		{about && <Dialog className="about-dialog" aria-label="关于 Skiff" onClose={() => setAbout(false)}>
			<div className="dialog-heading"><h2>关于 Skiff</h2><IconButton aria-label="关闭关于" onClick={() => setAbout(false)}><Icon name="close" /></IconButton></div>
			<BrandMark size={48} />
			<p>Skiff 是运行 pi 的桌面外壳：会话、模型线路与航行台都收在一处，键盘优先。</p>
		</Dialog>}
	</>;
}
