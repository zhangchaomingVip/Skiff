import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { darkThemeColors, setDarkThemeColor, setThemeColor, setThemePreference, setThemeStars, themeColors, useDarkThemeColor, useThemeColor, useThemePreference, useThemeStars } from "../theme";
import { ArchivedSessions } from "./ArchivedSessions";
import { Icon } from "./Icon";
import { PromptSettings } from "./PromptSettings";
import { ProvidersSettingsContent, type ProvidersSettingsProps } from "./ProvidersSettings";
import { Button, Dialog, IconButton, SegmentedControl } from "./ui";
import { isMacPlatform, settingsCategories, type SettingsCategory, type SettingsRestrictions } from "./settingsNavigation";
import type { SettingsEditorHandle } from "./settingsEditor";
import type { WebSearchControls } from "../chat/webSearch";
import { WebSearchSettings } from "./WebSearchSettings";
import { FontSettings } from "./FontSettings";

export function SettingsDialog({ initialCategory, restrictions, prompt, providers, archives, search, onRetryModels, onClose, onCategoryChange }: {
	initialCategory: SettingsCategory;
	restrictions: SettingsRestrictions;
	prompt: ComponentProps<typeof PromptSettings>;
	providers: Omit<ProvidersSettingsProps, "onLockChange" | "focusLocation">;
	archives: ComponentProps<typeof ArchivedSessions>;
	search: WebSearchControls;
	onRetryModels: () => void;
	onClose: () => void;
	/** Lets the shell reopen preferences on the tab the user left. */
	onCategoryChange?: (category: SettingsCategory) => void;
}) {
	const [category, setCategoryRaw] = useState(initialCategory);
	useEffect(() => { onCategoryChange?.(category); }, [category, onCategoryChange]);
	const [{ locked, pending }, setInteraction] = useState({ locked: false, pending: false });
	const setCategory = useCallback((next: SettingsCategory) => { setInteraction({ locked: false, pending: false }); setCategoryRaw(next); }, []);
	const updateInteraction = useCallback((locked: boolean, pending: boolean) => setInteraction({ locked, pending }), []);
	const editor = useRef<SettingsEditorHandle>(null);
	const [switchTarget, setSwitchTarget] = useState<SettingsCategory>();
	const switchCancel = useRef<HTMLButtonElement>(null);
	const navigationLocked = pending || (locked && editor.current?.dirty === undefined);
	const switchCategory = (next: SettingsCategory) => {
		if (next === category) return;
		if (editor.current?.dirty) setSwitchTarget(next);
		else setCategory(next);
	};
	const theme = useThemePreference();
	const themeColor = useThemeColor();
	const darkThemeColor = useDarkThemeColor();
	const themeStars = useThemeStars();
	const modifier = isMacPlatform() ? "Cmd" : "Ctrl";
	const close = () => { if (!editor.current?.pending) onClose(); };
	const escape = () => { if (editor.current?.pending) return; if (editor.current?.editing) editor.current.back(); else close(); };
	return <Dialog className="settings-dialog" aria-labelledby="settings-title" onClose={close} onEscape={escape} pending={pending} returnFocusSelector=".settings-trigger">
		<div className="settings-heading"><h1 id="settings-title">设置</h1><IconButton aria-label="关闭设置" disabled={pending} onClick={close}><Icon name="close" /></IconButton></div>
		<div className="settings-layout">
			<nav className="settings-nav" aria-label="设置分类">{settingsCategories.map(({ id, label, icon }) => <Button key={id} variant="ghost" aria-pressed={category === id} disabled={navigationLocked || !!restrictions[id]} title={navigationLocked ? "请先返回列表或等待保存完成" : restrictions[id]} onClick={() => switchCategory(id)}><Icon name={icon} size={16} />{label}</Button>)}
			</nav>
			<div className="settings-content">
				{category === "fonts" && <FontSettings />}
				{category === "appearance" && <section className="settings-page" aria-labelledby="appearance-title"><h2 id="appearance-title">外观</h2><p className="muted">选择应用主题与主题色，立即生效。</p>
					<div className="settings-group">
						<div className="settings-row">
							<div className="settings-row-text"><span className="settings-row-title">主题模式</span><span className="settings-row-hint">跟随系统时，自动匹配操作系统的浅色或深色设置。</span></div>
							<SegmentedControl label="应用主题" value={theme} onChange={(value) => setThemePreference(value)} options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} />
						</div>
						<div className="settings-row is-stacked">
							<div className="settings-row-text"><span className="settings-row-title">主题色</span><span className="settings-row-hint">决定侧边栏、标题栏与控件的基础色；切换浅色或深色时保持不变。</span></div>
							<div className="settings-swatches" role="group" aria-label="浅色配色">{themeColors.map(({ value, label }) => <Button key={value} variant="setting" className="settings-theme-color" data-theme-color-option={value} aria-pressed={themeColor === value} onClick={() => setThemeColor(value)}>
								<span className="settings-swatch-art" aria-hidden="true" /><span className="settings-swatch-label">{label}</span>
							</Button>)}</div>
						</div>
					</div>
					<div className="settings-group">
						<div className="settings-row is-stacked">
							<div className="settings-row-text"><span className="settings-row-title">深色背景</span><span className="settings-row-hint">仅在深色模式下生效，浅色模式保留上方主题色。</span></div>
							<div className="settings-swatches" role="group" aria-label="深色背景">{darkThemeColors.map(({ value, label }) => <Button key={value} variant="setting" className="settings-theme-color" data-dark-theme-color-option={value} aria-pressed={darkThemeColor === value} onClick={() => setDarkThemeColor(value)}>
								<span className="settings-swatch-art" aria-hidden="true" /><span className="settings-swatch-label">{label}</span>
							</Button>)}</div>
						</div>
					</div>
					<div className="settings-group">
						<div className="settings-row">
							<div className="settings-row-text"><label className="settings-row-title" htmlFor="settings-theme-stars">显示星星</label><span id="settings-theme-stars-description" className="settings-row-hint">细小星点静止，部分亮星缓慢呼吸；关闭后保留底色。</span></div>
							<label className="switch"><input id="settings-theme-stars" type="checkbox" checked={themeStars} aria-describedby="settings-theme-stars-description" onChange={(event) => setThemeStars(event.target.checked)} /><span className="slider" /></label>
						</div>
					</div>
				</section>}
				{category === "websearch" && <section className="settings-page" aria-labelledby="websearch-title"><h2 id="websearch-title">联网搜索</h2><p className="muted">为 pi 配置 web_search 工具，引擎可在 Tavily 与 Exa 之间选择；开关作用于当前 pi 会话。</p><WebSearchSettings search={search} /></section>}
				{category === "prompt" && <section aria-labelledby="prompt-title"><h2 id="prompt-title">系统提示词</h2><p className="muted">附加到 pi 系统提示词末尾（--append-system-prompt），随每次会话启动生效。保存后当前会话会重启。</p><fieldset className="settings-config" disabled={!!restrictions.prompt}><PromptSettings {...prompt} /></fieldset>{restrictions.prompt && <p className="settings-restriction">{restrictions.prompt}</p>}</section>}
				{category === "providers" && <><fieldset className="settings-config" disabled={!!restrictions.providers}><ProvidersSettingsContent {...providers} ref={editor} onLockChange={updateInteraction} /></fieldset>{providers.configError && !locked && <Button disabled={!!restrictions.providers} onClick={onRetryModels}>重新读取配置</Button>}</>}
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
		{switchTarget && <Dialog className="project-dialog" aria-labelledby="settings-discard-title" initialFocus={switchCancel} onClose={() => setSwitchTarget(undefined)}>
			<div className="dialog-heading"><h2 id="settings-discard-title">放弃更改并切换？</h2></div>
			<p>当前供应商有未保存的更改，切换分类将放弃这些更改。</p>
			<div className="dialog-actions">
				<Button ref={switchCancel} variant="secondary" onClick={() => setSwitchTarget(undefined)}>继续编辑</Button>
				<Button variant="primary" onClick={() => { setCategory(switchTarget); setSwitchTarget(undefined); }}>放弃更改并切换</Button>
			</div>
		</Dialog>}
	</Dialog>;
}
