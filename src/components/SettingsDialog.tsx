import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { createPortal } from "react-dom";
import { darkThemeColors, setDarkThemeColor, setThemeColor, setThemePreference, setThemeStars, themeColors, useDarkThemeColor, useThemeColor, useResolvedTheme, useThemePreference, useThemeStars } from "../theme";
import { SessionStatistics, type SessionStatisticsProps } from "./SessionStatistics";
import { ArchivedSessions } from "./ArchivedSessions";
import { Icon } from "./Icon";
import { PromptSettings } from "./PromptSettings";
import { TitleModelSettings } from "./TitleModelSettings";
import { ProvidersSettingsContent, type ProvidersSettingsProps } from "./ProvidersSettings";
import { Button, Dialog, SegmentedControl } from "./ui";
import { settingsCategories, type SettingsCategory, type SettingsDeferred, type SettingsRestrictions } from "./settingsNavigation";
import type { SettingsEditorHandle } from "./settingsEditor";
import type { WebSearchControls } from "../chat/webSearch";
import { WebSearchSettings } from "./WebSearchSettings";
import { FontSettings } from "./FontSettings";
import { BrowserSettings } from "./BrowserSettings";
import { ImageGenerationSettings } from "./ImageGenerationSettings";
import { VideoGenerationSettings } from "./VideoGenerationSettings";
import { AboutSettings } from "./AboutSettings";
import type { GenerationStudio } from "../workbench/useGenerationStudio";

export function SettingsWorkspace({ initialCategory, restrictions, deferred, prompt, providers, archives, statistics, search, images, videos, onRetryModels, onClose, onCategoryChange }: {
	initialCategory: SettingsCategory;
	restrictions: SettingsRestrictions;
	deferred: SettingsDeferred;
	prompt: ComponentProps<typeof PromptSettings>;
	providers: Omit<ProvidersSettingsProps, "onLockChange" | "focusLocation">;
	archives: ComponentProps<typeof ArchivedSessions>;
	statistics: SessionStatisticsProps;
	search: WebSearchControls;
	images: GenerationStudio["images"];
	videos: GenerationStudio["videos"];
	onRetryModels: () => void;
	onClose: () => void;
	/** Lets the shell reopen preferences on the tab the user left. */
	onCategoryChange?: (category: SettingsCategory) => void;
}) {
	const [category, setCategoryRaw] = useState(initialCategory);
	const [navigationHost, setNavigationHost] = useState<HTMLElement | null>(null);
	const [narrow, setNarrow] = useState(() => window.innerWidth <= 760);
	useEffect(() => {
		const query = window.matchMedia("(max-width: 760px)");
		// Narrow layouts drop the settings sidebar, so the navigation falls back
		// into the workspace and the stale portal host must be released.
		const update = () => { setNarrow(query.matches); setNavigationHost(document.getElementById("settings-sidebar-navigation")); };
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
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
	const darkActive = useResolvedTheme() === "dark";
	const close = () => { if (!editor.current?.pending) onClose(); };
	const escape = () => { if (editor.current?.pending) return; if (editor.current?.editing) editor.current.back(); else close(); };
	const escapeRef = useRef(escape);
	escapeRef.current = escape;
	// Settings replaces the workspace instead of living in a <dialog>, so the
	// global Escape and the return focus that the dialog used to provide are
	// handled here. Nested dialogs get the key first and close themselves.
	useEffect(() => {
		const parts = () => [...document.querySelectorAll<HTMLElement>(".settings-workspace, .settings-nav")];
		const tabbable = () => parts().flatMap((part) => [...part.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]).filter((element) => element.getClientRects().length > 0);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || document.querySelector("dialog[open]")) return;
			if (event.key === "Escape") { event.preventDefault(); escapeRef.current(); return; }
			// Settings is not a modal dialog any more, so keep Tab inside the
			// navigation and the content the same way the dialog used to.
			if (event.key !== "Tab") return;
			const items = tabbable();
			if (!items.length) return;
			const active = document.activeElement;
			if (!parts().some((part) => part.contains(active))) { event.preventDefault(); (event.shiftKey ? items[items.length - 1] : items[0]).focus(); return; }
			if (event.shiftKey && active === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
			else if (!event.shiftKey && active === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			queueMicrotask(() => document.querySelector<HTMLElement>(".settings-trigger")?.focus());
		};
	}, []);
	const noteLabel = (id: string) => id === "prompt" ? "自定义附加指令" : settingsCategories.find((item) => item.id === id)?.label;
	const navigation = <nav className="settings-nav" aria-label="设置分类"><Button className="settings-back" variant="ghost" onClick={close} disabled={pending}><Icon name="arrowLeft" size={16} />返回工作区</Button><h1 className="settings-nav-title" id="settings-title">设置</h1>{([
				["通用", ["appearance", "chat"]],
				["模型与能力", ["providers", "websearch", "browser", "images", "videos"]],
				["数据", ["statistics", "archives"]],
				// An untitled trailing group: one entry needs no heading of its own.
				["", ["about"]],
			] as const).map(([group, ids]) => <div className="settings-nav-group" key={group}>{group && <span>{group}</span>}{settingsCategories.filter(({ id }) => (ids as readonly string[]).includes(id)).map(({ id, label, icon }) => <Button key={id} variant="ghost" aria-pressed={category === id} disabled={navigationLocked || !!restrictions[id]} title={navigationLocked ? "请先返回列表或等待保存完成" : restrictions[id]} onClick={() => switchCategory(id)}><Icon name={icon} size={16} />{label}</Button>)}</div>)}
			</nav>;
	return <div className="settings-workspace" aria-labelledby="settings-title" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); escape(); } }}>
		{navigationHost ? createPortal(navigation, navigationHost) : narrow ? navigation : null}
		<div className="settings-layout">

			<div className="settings-content">
				{category === "browser" && <fieldset className="settings-config" disabled={!!restrictions.browser}><BrowserSettings onSaved={prompt.onSaved} /></fieldset>}
				{category === "statistics" && <SessionStatistics {...statistics} />}
				{category === "images" && <ImageGenerationSettings images={images} relays={providers.relays} ref={editor} onLockChange={updateInteraction} />}
				{category === "videos" && <VideoGenerationSettings videos={videos} ref={editor} onLockChange={updateInteraction} />}
				{category === "appearance" && <section className="settings-page" aria-labelledby="appearance-title"><h2 id="appearance-title">外观</h2>
					<div className="settings-group">
						<div className="settings-row">
							<div className="settings-row-text"><span className="settings-row-title">主题模式</span></div>
							<SegmentedControl label="应用主题" value={theme} onChange={(value) => setThemePreference(value)} options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} />
						</div>
						<div className="settings-row is-stacked">
							<div className="settings-row-text"><span className="settings-row-title">主题色</span></div>
							<div className="settings-swatches" role="group" aria-label="浅色配色">{themeColors.map(({ value, label }) => <Button key={value} variant="setting" className="settings-theme-color" data-theme-color-option={value} aria-pressed={themeColor === value} onClick={() => setThemeColor(value)}>
								<span className="settings-swatch-art" aria-hidden="true">{themeColor === value && <span className="settings-swatch-check"><Icon name="check" size={12} /></span>}</span><span className="settings-swatch-label">{label}</span>
							</Button>)}</div>
						</div>
					</div>
					{/* The stars belong to the dark backdrop, so both live in one card. */}
					<div className="settings-group">
						<div className="settings-row is-stacked">
							<div className="settings-row-text"><span className="settings-row-title">深色背景</span>{!darkActive && <span className="settings-row-hint">仅在深色模式下生效。</span>}</div>
							<div className="settings-swatches" role="group" aria-label="深色背景">{darkThemeColors.map(({ value, label }) => <Button key={value} variant="setting" className="settings-theme-color" data-dark-theme-color-option={value} aria-pressed={darkThemeColor === value} onClick={() => setDarkThemeColor(value)}>
								<span className="settings-swatch-art" aria-hidden="true">{darkThemeColor === value && <span className="settings-swatch-check"><Icon name="check" size={12} /></span>}</span><span className="settings-swatch-label">{label}</span>
							</Button>)}</div>
						</div>
						<div className="settings-row">
							<div className="settings-row-text"><label className="settings-row-title" htmlFor="settings-theme-stars">显示星星</label></div>
							<label className="switch"><input id="settings-theme-stars" type="checkbox" checked={themeStars} onChange={(event) => setThemeStars(event.target.checked)} /><span className="slider" /></label>
						</div>
					</div>
					<FontSettings />
				</section>}
				{category === "websearch" && <section className="settings-page" aria-labelledby="websearch-title"><WebSearchSettings search={search} /></section>}
				{category === "chat" && <section className="settings-page" aria-labelledby="chat-settings-title"><h2 id="chat-settings-title">对话</h2><TitleModelSettings onManage={() => setCategory("providers")} /><PromptSettings {...prompt} editRestricted={restrictions.prompt} /></section>}
				{category === "providers" && <><fieldset className="settings-config" disabled={!!restrictions.providers}><ProvidersSettingsContent {...providers} ref={editor} onLockChange={updateInteraction} /></fieldset>{providers.configError && !locked && <Button disabled={!!restrictions.providers} onClick={onRetryModels}>重新读取配置</Button>}</>}
				{category === "about" && <AboutSettings />}
				{category === "archives" && <section className="settings-page" aria-labelledby="archives-title"><h2 id="archives-title">已归档对话</h2><ArchivedSessions {...archives} busy={archives.busy || !!restrictions.archives} /></section>}
				{Object.entries(restrictions).map(([id, reason]) => reason && <p className="settings-restriction" key={id}>{noteLabel(id)}：{reason}</p>)}
				{Object.entries(deferred).map(([id, reason]) => reason && !(restrictions as Record<string, string | undefined>)[id] && <p className="settings-deferred" key={id}>{noteLabel(id)}：{reason}</p>)}
			</div>
		</div>
		{switchTarget && <Dialog className="project-dialog" aria-labelledby="settings-discard-title" initialFocus={switchCancel} onClose={() => setSwitchTarget(undefined)}>
			<div className="dialog-heading"><h2 id="settings-discard-title">放弃更改并切换？</h2></div>
			<p>当前设置有未保存的更改，切换分类将放弃这些更改。</p>
			<div className="dialog-actions">
				<Button ref={switchCancel} variant="secondary" onClick={() => setSwitchTarget(undefined)}>继续编辑</Button>
				<Button variant="primary" onClick={() => { setCategory(switchTarget); setSwitchTarget(undefined); }}>放弃更改并切换</Button>
			</div>
		</Dialog>}
	</div>;
}

