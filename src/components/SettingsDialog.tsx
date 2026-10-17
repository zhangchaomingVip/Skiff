import { useCallback, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { setThemePreference, useThemePreference } from "../theme";
import { ArchivedSessions } from "./ArchivedSessions";
import { FamiliesSettingsContent, type FamiliesSettingsHandle, type FamiliesSettingsProps } from "./FamiliesSettings";
import { Icon } from "./Icon";
import { Button, Dialog, IconButton } from "./ui";
import { isMacPlatform, settingsCategories, type SettingsCategory, type SettingsRestrictions } from "./settingsNavigation";

export function SettingsDialog({ initialCategory, restrictions, models, archives, onRetryModels, onClose }: {
	initialCategory: SettingsCategory;
	restrictions: SettingsRestrictions;
	models: Omit<FamiliesSettingsProps, "onLockChange">;
	archives: ComponentProps<typeof ArchivedSessions>;
	onRetryModels: () => void;
	onClose: () => void;
}) {
	const [category, setCategory] = useState(initialCategory);
	const [{ locked, pending }, setInteraction] = useState({ locked: false, pending: false });
	const updateInteraction = useCallback((locked: boolean, pending: boolean) => setInteraction({ locked, pending }), []);
	const editor = useRef<FamiliesSettingsHandle>(null);
	const theme = useThemePreference();
	const modifier = isMacPlatform() ? "Cmd" : "Ctrl";
	const close = () => { if (!editor.current?.pending) onClose(); };
	const escape = () => { if (editor.current?.pending) return; if (editor.current?.editing) editor.current.back(); else close(); };
	return <Dialog className="settings-dialog" aria-labelledby="settings-title" onClose={close} onEscape={escape} pending={pending} returnFocusSelector=".chat-header .header-settings, .settings-trigger">
		<div className="settings-heading"><h1 id="settings-title">设置</h1><IconButton aria-label="关闭设置" disabled={pending} onClick={close}><Icon name="close" /></IconButton></div>
		<div className="settings-layout">
			<nav className="settings-nav" aria-label="设置分类">{settingsCategories.map(({ id, label, icon }) => <Button key={id} variant="ghost" aria-pressed={category === id} disabled={locked || !!restrictions[id]} title={locked ? "请先返回列表或等待保存完成" : restrictions[id]} onClick={() => setCategory(id)}><Icon name={icon} size={16} />{label}{category === id && <Icon name="check" size={14} />}</Button>)}
				{locked && <p>请先返回列表或等待保存完成，再切换分类。</p>}
			</nav>
			<div className="settings-content">
				{category === "appearance" && <section aria-labelledby="appearance-title"><h2 id="appearance-title">外观</h2><p className="muted">选择应用主题，立即生效。</p><div className="settings-themes" role="group" aria-label="应用主题">{([
					["system", "跟随系统", "monitor"], ["light", "浅色", "sun"], ["dark", "深色", "moon"],
				] as const).map(([value, label, icon]) => <Button key={value} variant="setting" aria-pressed={theme === value} onClick={() => setThemePreference(value)}><Icon name={icon} />{label}{theme === value && <Icon name="check" size={14} />}</Button>)}</div></section>}
				{category === "models" && <><fieldset className="settings-config" disabled={!!restrictions.models}><FamiliesSettingsContent {...models} ref={editor} onLockChange={updateInteraction} /></fieldset>{models.configError && !locked && <Button disabled={!!restrictions.models} onClick={onRetryModels}>重新读取配置</Button>}</>}
				{category === "archives" && <section aria-labelledby="archives-title"><h2 id="archives-title">归档会话</h2><p className="muted">查看、恢复或删除已归档的会话。</p><ArchivedSessions {...archives} busy={archives.busy || !!restrictions.archives} /></section>}
				{category === "shortcuts" && <section aria-labelledby="shortcuts-title"><h2 id="shortcuts-title">快捷键</h2><p className="muted">设置及其他模态窗口打开期间，后台聊天快捷键暂停。</p><dl className="settings-shortcuts">{[
					[`${modifier} + ,`, "打开设置", "主页面；不打断其他模态窗口"],
					[`${modifier} + N`, "新聊天", "主页面；在当前项目创建草稿"],
					["Ctrl + K", "聚焦输入框", "聊天页面"],
					["Enter", "发送消息 / 运行命令", "输入框；有候选项时选择候选"],
					["Shift + Enter", "换行", "输入框"],
					["Ctrl + Shift + Backspace", "停止生成", "输入框获得焦点且正在生成"],
					["Esc", "返回 / 关闭", "优先关闭弹层、返回编辑列表；输入框中取消编辑或清空草稿"],
				].map(([keys, action, scope]) => <div key={keys}><dt><kbd>{keys}</kbd></dt><dd><strong>{action}</strong><span>{scope}</span></dd></div>)}</dl></section>}
				{Object.entries(restrictions).map(([id, reason]) => reason && <p className="settings-restriction" key={id}>{settingsCategories.find((item) => item.id === id)?.label}：{reason}</p>)}
			</div>
		</div>
	</Dialog>;
}
