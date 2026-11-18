import { useEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { browserNative, type BrowserDependencies, type BrowserStatus, type BrowserTab } from "../browser/native";
import { browserControlLabels, browserHost, browserTabLabel, canWatchBrowser } from "../browser/model";
import { watchBrowser, type BrowserStreamPhase, type BrowserViewer } from "../browser/viewer";
import { browserViewport, browserZoomLevels, browserZoomPercent, defaultBrowserZoom, isBrowserZoom, nextBrowserZoom } from "../browser/viewport";
import { attachBrowserInput, browserPoint } from "../browser/input";
import type { BrowserActions } from "../browser/useBrowserActions";
import type { BrowserPanelControls } from "../browser/useBrowserPanel";
import { Button, IconButton, Popover } from "./ui";
import { Icon } from "./Icon";

type BrowserInputHandle = { flush: () => Promise<void>; focus?: () => void };
interface BrowserPageHandle {
	send: (value: Record<string, unknown>, status: BrowserStatus) => boolean;
	reload: (status: BrowserStatus) => boolean;
	navigate: (url: string, status: BrowserStatus) => boolean;
	history: (direction: "back" | "forward", status: BrowserStatus) => boolean;
}

function BrowserFavicon({ url }: { url: string }) {
	const [failed, setFailed] = useState(false);
	const host = browserHost(url);
	useEffect(() => { setFailed(false); }, [host]);
	if (!host || failed) return <Icon name="globe" size={14} />;
	return <img className="browser-favicon" src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" width={14} height={14} draggable={false} onError={() => setFailed(true)} />;
}

const checkModifiers = (event: MouseEvent) => (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);

/** The page is live but the AI owns it: the first human gesture interrupts the task and is
 * then replayed into the page, so taking over never costs the click that requested it. */
function TakeoverLayer({ canvas, viewer, takeOver, inputHandle }: { canvas: RefObject<HTMLCanvasElement>; viewer: MutableRefObject<BrowserViewer | undefined>; takeOver: () => Promise<BrowserStatus | undefined>; inputHandle: MutableRefObject<BrowserInputHandle | undefined> }) {
	const layer = useRef<HTMLDivElement>(null);
	const takeover = useRef(takeOver); takeover.current = takeOver;
	useEffect(() => {
		const element = layer.current;
		if (!element) return;
		let disposed = false;
		let pointerBusy = false;
		let pumping = false;
		const wheel = { x: 0, y: 0, at: { x: 0, y: 0 }, modifiers: 0 };
		const point = (event: { clientX: number; clientY: number }) => browserPoint(canvas.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 }, canvas.current ?? { width: 0, height: 0 }, event.clientX, event.clientY, viewer.current?.scale() ?? 1);
		const focusInput = () => requestAnimationFrame(() => inputHandle.current?.focus?.());
		const pointerdown = (event: PointerEvent) => {
			if (pointerBusy || disposed || ![0, 1, 2].includes(event.button)) return;
			event.preventDefault(); event.stopPropagation();
			const location = point(event);
			const button = ["left", "middle", "right"][event.button] ?? "left";
			const modifiers = checkModifiers(event);
			pointerBusy = true;
			void takeover.current().then((status) => {
				// The takeover layer unmounts as soon as control flips to human; that cleanup
				// must not swallow the gesture that requested the takeover. A vanished viewer
				// still drops it because there is no socket to replay into.
				const active = viewer.current;
				if (!status || !location || !active) return;
				active.send({ type: "input_mouse", eventType: "mousePressed", ...location, button, buttons: 1, clickCount: 1, modifiers }, status);
				active.send({ type: "input_mouse", eventType: "mouseReleased", ...location, button, buttons: 0, clickCount: 1, modifiers }, status);
				focusInput();
			}).finally(() => { pointerBusy = false; });
		};
		const flushWheel = async () => {
			if (pumping || disposed || (!wheel.x && !wheel.y)) return;
			pumping = true;
			const deltaX = Math.max(-4000, Math.min(4000, wheel.x));
			const deltaY = Math.max(-4000, Math.min(4000, wheel.y));
			const at = wheel.at; const modifiers = wheel.modifiers;
			wheel.x = 0; wheel.y = 0;
			const status = await takeover.current();
			if (status) viewer.current?.send({ type: "input_mouse", eventType: "mouseWheel", x: at.x, y: at.y, deltaX, deltaY, modifiers }, status);
			pumping = false;
			if (wheel.x || wheel.y) void flushWheel();
		};
		const onWheel = (event: WheelEvent) => {
			const location = point(event);
			if (!location || disposed) return;
			event.preventDefault(); event.stopPropagation();
			const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (canvas.current?.height ?? 1) : 1;
			wheel.x += event.deltaX * factor; wheel.y += event.deltaY * factor;
			wheel.at = location; wheel.modifiers = checkModifiers(event);
			void flushWheel();
		};
		const contextmenu = (event: Event) => event.preventDefault();
		element.addEventListener("pointerdown", pointerdown);
		element.addEventListener("wheel", onWheel, { passive: false });
		element.addEventListener("contextmenu", contextmenu);
		return () => {
			disposed = true;
			element.removeEventListener("pointerdown", pointerdown);
			element.removeEventListener("wheel", onWheel);
			element.removeEventListener("contextmenu", contextmenu);
		};
	}, [canvas, viewer, inputHandle]);
	return <div ref={layer} className="browser-takeover" data-label="点击画面即接管浏览器" aria-hidden="true" />;
}

function BrowserScreen({ status, controls, actions, inputHandle, pageHandle, onReload, onAction, zoom, onPhase, takeOver, notice }: {
	status: BrowserStatus;
	controls: BrowserPanelControls;
	actions: BrowserActions;
	inputHandle: MutableRefObject<BrowserInputHandle | undefined>;
	pageHandle: MutableRefObject<BrowserPageHandle | undefined>;
	onReload: (ok: boolean, error?: string) => void;
	onAction: (name: string, ok: boolean, error?: string) => void;
	zoom: number;
	onPhase: (phase: BrowserStreamPhase) => void;
	takeOver: () => Promise<BrowserStatus | undefined>;
	notice?: ReactNode;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const screen = useRef<HTMLDivElement>(null);
	const keyboard = useRef<HTMLTextAreaElement>(null);
	const viewer = useRef<BrowserViewer>();
	const current = useRef(controls); current.current = controls;
	const [phase, setPhase] = useState<BrowserStreamPhase>("connecting");
	const [attempt, retry] = useState(0);
	const live = phase === "live";
	const synced = useRef("");
	// Chrome renders the page at this density, so a click maps from bitmap pixels back to page
	// CSS pixels by dividing by it — even while the panel box and the page viewport differ.
	const density = useRef(2);
	// Chrome lays pages out in the panel's CSS box, so zoom shrinks the viewport instead of
	// the picture: the page grows while the stream keeps its pixel density.
	useEffect(() => {
		// The picture is drawn into the canvas box, so that box — not the surrounding panel —
		// is the page viewport. A different box letterboxes the picture and softens it.
		const element = canvas.current ?? screen.current;
		if (!element) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const apply = (attempts = 0) => {
			// Chrome's window is pinned at 2x, so the picture is always twice the CSS viewport
			// on any display; the display's own density no longer changes the sharpness.
			const request = browserViewport(element.clientWidth, element.clientHeight, 2, zoom);
			if (!request) return;
			density.current = request.scale;
			const key = `${status.chatId}:${status.generation}:${zoom}:${request.width}x${request.height}@${request.scale}`;
			if (key === synced.current) return;
			synced.current = key;
			void browserNative.viewport({ chatId: status.chatId, generation: status.generation }, request.width, request.height, request.scale).catch(() => {
				if (synced.current !== key) return;
				synced.current = "";
				// A resize can arrive while the browser is busy with a command; retrying keeps the
				// page viewport matching the panel instead of leaving the picture stretched.
				if (attempts < 2) retryTimer = setTimeout(() => apply(attempts + 1), 600);
			});
		};
		const observer = new ResizeObserver(() => { clearTimeout(timer); clearTimeout(retryTimer); timer = setTimeout(() => apply(), 200); });
		observer.observe(element);
		apply();
		return () => { observer.disconnect(); clearTimeout(timer); clearTimeout(retryTimer); };
	}, [status.chatId, status.generation, live, zoom]);
	const reportPhase = (value: BrowserStreamPhase) => { setPhase(value); onPhase(value); };
	useEffect(() => {
		if (!canvas.current) return;
		viewer.current = watchBrowser(status, canvas.current, {
			phase: reportPhase,
			status: (value) => current.current.updateStatus(value),
			url: (url) => current.current.updateUrl(status, url),
			reload: onReload,
			action: onAction,
		}, () => density.current);
		return () => { viewer.current?.dispose(); viewer.current = undefined; };
	}, [status.chatId, status.generation, attempt]);
	useEffect(() => {
		const active = viewer.current;
		if (!active) return;
		pageHandle.current = {
			send: (value, target) => active.send(value, target),
			reload: (target) => active.reload(target),
			navigate: (url, target) => active.navigate(url, target),
			history: (direction, target) => active.history(direction, target),
		};
		return () => { pageHandle.current = undefined; };
	}, [status.chatId, status.generation, attempt]);
	const interactive = phase === "live" && status.control === "human" && !actions.pending;
	useEffect(() => {
		if (!interactive || !canvas.current || !keyboard.current || !viewer.current) return;
		const input = attachBrowserInput(keyboard.current, canvas.current, viewer.current, status, () => viewer.current?.scale() ?? 1);
		inputHandle.current = input;
		return () => { input.dispose(); if (inputHandle.current === input) inputHandle.current = undefined; };
	}, [interactive, status.controlVersion, status.generation, attempt]);
	const takeover = status.control === "ai" || status.control === "stopped";
	return <div className="browser-screen" data-phase={phase} ref={screen}>
		<canvas ref={canvas} role="img" aria-label="当前聊天的浏览器画面" />
		{interactive && <textarea ref={keyboard} className="browser-input" aria-label="浏览器键盘输入" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />}
		{phase === "live" && takeover && !actions.pending && <TakeoverLayer canvas={canvas} viewer={viewer} takeOver={takeOver} inputHandle={inputHandle} />}
		{phase === "live" && notice && <div className="browser-notice">{notice}</div>}
		{phase !== "live" && <div className="browser-screen-message" role="status"><Icon name={phase === "disconnected" ? "wifi" : "clock"} size={24} /><strong>{phase === "disconnected" ? "画面连接已断开" : phase === "waiting" ? "等待浏览器画面…" : "正在连接画面…"}</strong><p>{phase === "disconnected" ? "当前画面已失效。重新连接会读取最新页面，不会重复执行操作。" : "连接到当前聊天的浏览器。"}</p>{phase === "disconnected" && <Button onClick={() => { current.current.refresh(); retry((value) => value + 1); }}>重新连接画面</Button>}</div>}
	</div>;
}

export function BrowserPanel({ chatId, controls, browserActions, compact, maximized, focusRequest, busy, onSettings, onReconnect, onCollapse, onMaximize }: {
	chatId: string;
	controls: BrowserPanelControls;
	browserActions: BrowserActions;
	compact: boolean;
	maximized: boolean;
	focusRequest: number;
	busy: boolean;
	onSettings: () => void;
	onReconnect: () => void;
	onCollapse: () => void;
	onMaximize: () => void;
}) {
	const { status, error } = controls;
	const inputHandle = useRef<BrowserInputHandle>();
	const pageHandle = useRef<BrowserPageHandle>();
	const panel = useRef<HTMLElement>(null);
	const menuAnchor = useRef<HTMLButtonElement>(null);
	const addressInput = useRef<HTMLInputElement>(null);
	const statusRef = useRef(status); statusRef.current = status;
	const [dependencies, setDependencies] = useState<BrowserDependencies>();
	const [dependencyError, setDependencyError] = useState<string>();
	const [checking, setChecking] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const [actionError, setActionError] = useState<string>();
	const [check, recheck] = useState(0);
	const [menu, setMenu] = useState(false);
	const [editing, setEditing] = useState<string>();
	const [opening, setOpening] = useState(false);
	const [addressOnOpen, setAddressOnOpen] = useState(false);
	const editingActive = editing !== undefined;
	const [phase, setPhase] = useState<BrowserStreamPhase>("connecting");
	const [zoom, setZoom] = useState<number>(() => {
		try { const stored = Number(localStorage.getItem("skiff.browser.zoom")); return isBrowserZoom(stored) ? stored : defaultBrowserZoom; } catch { return defaultBrowserZoom; }
	});
	const changeZoom = (value: number) => {
		const level = isBrowserZoom(value) ? value : defaultBrowserZoom;
		setZoom(level);
		try { localStorage.setItem("skiff.browser.zoom", String(level)); } catch { /* storage may be unavailable */ }
	};
	useEffect(() => {
		let disposed = false;
		setChecking(true); setDependencyError(undefined);
		void browserNative.dependencies().then((value) => { if (!disposed) setDependencies(value); }).catch((reason) => { if (!disposed) setDependencyError(String(reason)); }).finally(() => { if (!disposed) setChecking(false); });
		return () => { disposed = true; };
	}, [check]);
	useEffect(() => { if (focusRequest || compact) panel.current?.focus(); }, [focusRequest, compact]);
	useEffect(() => {
		if (!editingActive) return;
		const frame = requestAnimationFrame(() => { addressInput.current?.focus(); addressInput.current?.select(); });
		return () => cancelAnimationFrame(frame);
	}, [editingActive]);
	useEffect(() => { if (!canWatchBrowser(status)) setPhase("connecting"); }, [status?.control]);
	const collapse = () => { setMenu(false); onCollapse(); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".browser-trigger")?.focus()); };
	const live = phase === "live" && !error;
	const watch = canWatchBrowser(status) && !error;
	const failed = status && ["disconnected", "faulted"].includes(status.control);
	const applyStatus = (value: BrowserStatus) => { statusRef.current = value; controls.updateStatus(value); };
	const ensureHuman = async (): Promise<BrowserStatus | undefined> => {
		const current = statusRef.current;
		if (!current || !live || browserActions.pending) return undefined;
		if (current.control === "human") return current;
		if (current.control === "ai" || current.control === "stopped") return browserActions.run("takeOver");
		return undefined;
	};
	const beginAddress = (value?: string) => {
		const current = statusRef.current;
		if (!current) return;
		setActionError(undefined);
		setEditing(value ?? current.url ?? "");
		requestAnimationFrame(() => { addressInput.current?.focus(); addressInput.current?.select(); });
	};
	useEffect(() => {
		if (!addressOnOpen || phase !== "live" || status?.control !== "human") return;
		setAddressOnOpen(false);
		beginAddress(status.url && status.url !== "about:blank" ? status.url : "");
	}, [addressOnOpen, phase, status?.url, status?.control]);
	const editAddress = async () => {
		if (!live || browserActions.pending) return;
		const next = await ensureHuman();
		if (next) beginAddress(next.url ?? "");
	};
	const commitAddress = async () => {
		const text = editing?.trim() ?? "";
		if (!text) { setEditing(undefined); return; }
		const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
		const next = await ensureHuman();
		if (!next) return;
		if (!pageHandle.current?.navigate(url, next)) { setActionError("画面尚未连接，暂时无法跳转"); return; }
		setEditing(undefined);
	};
	const history = async (direction: "back" | "forward") => {
		const next = await ensureHuman();
		if (!next) return;
		if (!pageHandle.current?.history(direction, next)) setActionError("画面尚未连接，暂时无法浏览历史");
	};
	const reloadPage = async () => {
		const next = await ensureHuman();
		if (!next) return;
		setActionError(undefined);
		if (!pageHandle.current?.reload(next)) setActionError("画面尚未连接，暂时无法刷新网页");
	};
	const reloadResult = (ok: boolean, failure?: string) => { if (!ok) setActionError(failure ?? "刷新网页失败，请重新连接画面"); };
	const actionResult = (name: string, ok: boolean, failure?: string) => { if (!ok) setActionError(failure ?? `${name === "navigate" ? "网页跳转" : "浏览历史"}失败`); else setActionError(undefined); };
	const changeTab = async (tab: BrowserTab) => {
		const current = statusRef.current;
		if (!current || !live || browserActions.pending || !tab.id) return;
		const next = await ensureHuman();
		if (!next) return;
		try {
			const updated = await browserNative.tab(next, { type: "select", tabId: tab.id });
			applyStatus(updated); setActionError(undefined);
		} catch (reason) { setActionError(String(reason)); }
	};
	const newTab = async () => {
		const current = statusRef.current;
		if (!current || !live || browserActions.pending) return;
		const next = await ensureHuman();
		if (!next) return;
		try {
			const updated = await browserNative.tab(next, { type: "new" });
			applyStatus(updated); setActionError(undefined);
			// A new tab starts at about:blank; put the caret in the address bar so the
			// next keystroke is the destination rather than a click on an empty page.
			beginAddress("");
		} catch (reason) { setActionError(String(reason)); }
	};
	const closeTab = async (tab: BrowserTab) => {
		const current = statusRef.current;
		if (!current || !live || browserActions.pending) return;
		const next = await ensureHuman();
		if (!next) return;
		const tabs = statusRef.current?.tabs ?? [];
		if (!tab.id || tabs.length <= 1) {
			await browserActions.run("close", inputHandle.current?.flush);
			return;
		}
		try {
			const updated = await browserNative.tab(next, { type: "close", tabId: tab.id });
			applyStatus(updated); setActionError(undefined);
		} catch (reason) { setActionError(String(reason)); }
	};
	const returnToAi = () => { setMenu(false); void browserActions.run("return", inputHandle.current?.flush); };
	const readCurrentPage = () => { setMenu(false); void browserActions.run("read", inputHandle.current?.flush); };
	const continueTask = () => void browserActions.run("continue");
	const closeBrowser = () => { setMenu(false); void browserActions.run("close", inputHandle.current?.flush); };
	const openBrowser = async () => {
		if (!chatId || busy || opening) return;
		setOpening(true); setActionError(undefined);
		try {
			const opened = await browserNative.start(chatId, true);
			applyStatus(opened);
			setAddressOnOpen(true);
			controls.refresh();
		} catch (reason) { setActionError(String(reason)); }
		finally { setOpening(false); }
	};
	const prepare = async () => {
		if (!status || busy || preparing) return;
		setPreparing(true); setActionError(undefined);
		try { const closed = await browserNative.close(status); controls.updateStatus(closed); controls.refresh(); onReconnect(); }
		catch (reason) { setActionError(String(reason)); }
		finally { setPreparing(false); }
	};
	const zoomable = watch;
	const zoomPercent = browserZoomPercent(zoom);
	const host = browserHost(status?.url);
	const tabs: BrowserTab[] = status?.tabs.length && !["closed", "closing"].includes(status.control)
		? status.tabs
		: [{ id: "", title: status?.control === "closed" ? "浏览器" : status?.title ?? "浏览器", url: status?.control === "closed" ? "" : status?.url ?? "", active: true }];
	const tabsAvailable = !!status && ["ai", "human", "stopped"].includes(status.control) && !browserActions.pending;
	const returnable = status?.control === "human" || status?.control === "stopped";
	const manualAvailable = !!dependencies?.enabled && dependencies.ready && !busy && !checking;
	const notice = status?.control === "human" && live
		? <Button className="browser-handoff" size="compact" disabled={!!browserActions.pending || busy} loading={browserActions.pending === "return"} onClick={returnToAi}><Icon name="spark" size={14} />交还 AI</Button>
		: status?.control === "ai" && status.requiresSnapshot && live
			? <Button className="browser-handoff" size="compact" variant="primary" disabled={!!browserActions.pending || busy} loading={browserActions.pending === "continue"} onClick={continueTask}>继续浏览任务</Button>
			: undefined;
	return <section className="browser-panel" ref={panel} tabIndex={-1} aria-label="浏览器画面" aria-description={browserActions.pending ? "正在处理控制请求" : browserControlLabels[status?.control ?? "closed"]} data-chat-id={chatId} data-generation={status?.generation ?? ""} data-control={status?.control ?? "none"} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse(); } }}>
		<header className="browser-panel-header">
			<div className="browser-tabs" role="tablist" aria-label="浏览器标签页">
				{tabs.map((tab) => {
					const label = browserTabLabel(tab);
					return <div key={tab.id || "current"} className={`browser-tab${tab.active ? " is-active" : ""}`} role="tab" aria-selected={tab.active} aria-label={label} tabIndex={tab.active ? 0 : -1} title={tab.url || label} onClick={() => { if (tab.active || !tab.id) return; void changeTab(tab); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!tab.active && tab.id) void changeTab(tab); } }}>
						<BrowserFavicon url={tab.url} />
						<span className="browser-tab-title">{label}</span>
						<button type="button" className="browser-tab-close" aria-label={`关闭 ${label}`} title="关闭标签页" disabled={!tabsAvailable || !live} onClick={(event) => { event.stopPropagation(); void closeTab(tab); }}><Icon name="close" size={12} /></button>
					</div>;
				})}
				<button type="button" className="browser-new-tab" aria-label="新建标签页" title="新建标签页" disabled={!tabsAvailable || !live} onClick={() => void newTab()}><Icon name="plus" size={14} /></button>
			</div>
			<div className="browser-panel-header-actions">
				<IconButton size="compact" aria-label={maximized ? "还原浏览器宽度" : "最大化浏览器"} title={maximized ? "还原浏览器宽度" : "最大化浏览器"} disabled={compact} onClick={onMaximize}><Icon name={maximized ? "collapse" : "expand"} size={16} /></IconButton>
				<IconButton size="compact" aria-label={compact ? "返回聊天" : "收起浏览器"} title={compact ? "返回聊天" : "收起浏览器"} onClick={collapse}><Icon name={compact ? "arrowLeft" : "panel"} size={16} /></IconButton>
			</div>
		</header>
		<div className="browser-toolbar">
			<div className="browser-nav" role="group" aria-label="网页导航">
				<IconButton size="compact" aria-label="后退" title={status?.canGoBack ? "后退" : "没有可后退的页面"} disabled={!live || !status?.canGoBack || !!browserActions.pending} onClick={() => void history("back")}><Icon name="arrowLeft" size={16} /></IconButton>
				<IconButton size="compact" aria-label="前进" title={status?.canGoForward ? "前进" : "没有可前进的页面"} disabled={!live || !status?.canGoForward || !!browserActions.pending} onClick={() => void history("forward")}><Icon name="arrowRight" size={16} /></IconButton>
				<IconButton size="compact" aria-label="刷新网页" title="重新加载当前网页" disabled={!live || !!browserActions.pending} onClick={() => void reloadPage()}><Icon name="refresh" size={16} /></IconButton>
			</div>
			<div className={`browser-address${editing !== undefined ? " is-editing" : ""}`}>
				{editing !== undefined
					? <input ref={addressInput} className="browser-address-input" aria-label="地址栏" value={editing} onChange={(event) => setEditing(event.target.value)} onKeyDown={(event) => {
						if (event.key === "Enter") { event.preventDefault(); void commitAddress(); }
						else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(undefined); }
					}} onBlur={() => setEditing(undefined)} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
					: <button type="button" className="browser-address-display" aria-label="地址栏" title={status?.url ?? "尚未打开网页"} onClick={() => void editAddress()}>{host || "新标签页"}</button>}
			</div>
			<IconButton ref={menuAnchor} size="compact" aria-label="更多浏览器操作" aria-haspopup="menu" aria-expanded={menu} title="更多浏览器操作" disabled={!status} onClick={() => setMenu((value) => !value)}><Icon name="more" size={16} /></IconButton>
			{menu && <Popover anchor={menuAnchor} onClose={() => setMenu(false)} className="browser-menu" role="menu" aria-label="浏览器菜单">
				<div className="browser-menu-zoom" role="group" aria-label="网页缩放">
					<IconButton size="compact" aria-label="缩小网页" title={zoomable ? "缩小网页" : "浏览器画面就绪后可缩放"} disabled={!zoomable || zoom <= browserZoomLevels[0]} onClick={() => changeZoom(nextBrowserZoom(zoom, -1))}><Icon name="minus" size={16} /></IconButton>
					<button type="button" className="browser-zoom-value" disabled={!zoomable} aria-label={`网页缩放 ${zoomPercent}%，点击恢复 100%`} title="点击恢复 100%" onClick={() => changeZoom(defaultBrowserZoom)}>{zoomPercent}%</button>
					<IconButton size="compact" aria-label="放大网页" title={zoomable ? "放大网页" : "浏览器画面就绪后可缩放"} disabled={!zoomable || zoom >= browserZoomLevels[browserZoomLevels.length - 1]} onClick={() => changeZoom(nextBrowserZoom(zoom, 1))}><Icon name="plus" size={16} /></IconButton>
				</div>
				{(returnable || status?.requiresSnapshot) && <span className="browser-menu-separator" role="presentation" />}
				{returnable && <Button size="compact" variant="ghost" className="browser-menu-item" role="menuitem" disabled={!!browserActions.pending || busy} loading={browserActions.pending === "read"} onClick={readCurrentPage}><Icon name="globe" size={16} /><span>让 AI 读取当前页</span></Button>}
				{returnable && <Button size="compact" variant="ghost" className="browser-menu-item" role="menuitem" disabled={!!browserActions.pending || busy} loading={browserActions.pending === "return"} onClick={returnToAi}><Icon name="spark" size={16} /><span>交还 AI 继续任务</span></Button>}
				{status?.requiresSnapshot && status.control === "ai" && <Button size="compact" variant="ghost" className="browser-menu-item" role="menuitem" disabled={!!browserActions.pending || busy} loading={browserActions.pending === "continue"} onClick={continueTask}><Icon name="arrowRight" size={16} /><span>继续浏览任务</span></Button>}
				<span className="browser-menu-separator" role="presentation" />
				<Button size="compact" variant="ghost" className="browser-menu-item" role="menuitem" disabled={!!browserActions.pending} loading={browserActions.pending === "close"} onClick={closeBrowser}><Icon name="close" size={16} /><span>关闭浏览器</span></Button>
			</Popover>}
		</div>
		{browserActions.error && <p className="browser-panel-error" role="alert">{browserActions.error}</p>}
		{watch && status ? controls.visible ? <BrowserScreen key={`${status.chatId}:${status.generation}`} status={status} controls={controls} actions={browserActions} inputHandle={inputHandle} pageHandle={pageHandle} onReload={reloadResult} onAction={actionResult} zoom={zoom} onPhase={setPhase} takeOver={ensureHuman} notice={notice} /> : <div className="browser-empty"><Icon name="monitor" size={28} /><strong>画面已暂停</strong><p>返回此聊天后显示最新画面，浏览器任务继续运行。</p></div> : <div className="browser-empty" role="status">
			<Icon name={error || dependencyError || failed ? "wifi" : status?.control === "starting" ? "clock" : "monitor"} size={28} />
			<strong>{error ? "浏览器服务暂不可用" : status?.control === "starting" ? "正在启动浏览器…" : failed ? browserControlLabels[status.control] : status?.control === "closing" ? "正在关闭浏览器…" : status?.control === "closed" ? "浏览器已关闭" : !dependencies ? "正在检查浏览器…" : !dependencies.ready ? "浏览器尚未就绪" : !dependencies.enabled ? "AI 浏览器尚未启用" : "打开浏览器开始浏览"}</strong>
			<p>{error ?? dependencyError ?? status?.error ?? (failed ? "重新打开会关闭当前页面，保留此聊天的登录状态。" : status?.control === "starting" ? "首次启动可能需要几秒，画面就绪后会自动显示。" : status?.control === "closed" ? "当前页面已关闭。可以自己打开浏览器继续浏览，也可以让 AI 打开网页。" : dependencies && !dependencies.ready ? dependencies.message : dependencies && !dependencies.enabled ? "在设置中开启后，可以自己浏览或交给 AI。" : "先自己输入网址、开标签；需要 AI 时，把当前页面交给它。")}</p>
			{failed && <><p>重新准备会关闭当前页面，保留此聊天的登录状态。</p><div className="browser-empty-actions">{manualAvailable && <Button variant="primary" disabled={opening || busy} loading={opening} onClick={() => void openBrowser()}>重新打开浏览器</Button>}<Button disabled={busy || preparing} loading={preparing} title={busy ? "请等待当前轮次结束后再重新准备" : undefined} onClick={() => void prepare()}>关闭并重新准备</Button></div></>}
			{error && <Button onClick={controls.refresh}>重新检测</Button>}
			{status?.control === "closed" && manualAvailable && <div className="browser-empty-actions"><Button variant="primary" disabled={opening || busy} loading={opening} onClick={() => void openBrowser()}>打开浏览器</Button></div>}
			{!status && <div className="browser-empty-actions">{manualAvailable && <Button variant="primary" disabled={opening || busy} loading={opening} onClick={() => void openBrowser()}>打开浏览器</Button>}<Button disabled={checking} onClick={() => { recheck((value) => value + 1); controls.refresh(); }}>{checking ? "正在检测…" : "重新检测"}</Button><Button onClick={onSettings}>浏览器设置</Button></div>}
		</div>}
		{actionError && <p className="browser-panel-error" role="alert">{actionError}</p>}
	</section>;
}
