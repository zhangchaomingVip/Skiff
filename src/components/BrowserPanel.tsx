import { useEffect, useRef, useState } from "react";
import { browserNative, type BrowserDependencies, type BrowserStatus } from "../browser/native";
import { browserControlLabels, canWatchBrowser } from "../browser/model";
import { watchBrowser, type BrowserStreamPhase } from "../browser/viewer";
import { browserViewport } from "../browser/viewport";
import { attachBrowserInput } from "../browser/input";
import type { BrowserActions } from "../browser/useBrowserActions";
import type { BrowserPanelControls } from "../browser/useBrowserPanel";
import { Button, IconButton } from "./ui";
import { Icon } from "./Icon";

function BrowserScreen({ status, controls, actions, inputHandle }: { status: BrowserStatus; controls: BrowserPanelControls; actions: BrowserActions; inputHandle: React.MutableRefObject<{ flush: () => Promise<void> } | undefined> }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const screen = useRef<HTMLDivElement>(null);
	const keyboard = useRef<HTMLTextAreaElement>(null);
	const viewer = useRef<ReturnType<typeof watchBrowser>>();
	const current = useRef(controls); current.current = controls;
	const [phase, setPhase] = useState<BrowserStreamPhase>("connecting");
	const [attempt, retry] = useState(0);
	const live = phase === "live";
	const synced = useRef("");
	// Chrome streams at CSS resolution, so the viewport carries the panel's device pixels and maps 1:1 there.
	useEffect(() => {
		const element = screen.current;
		if (!element) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const apply = () => {
			const request = browserViewport(element.clientWidth, element.clientHeight, window.devicePixelRatio);
			if (!request) return;
			const key = `${status.chatId}:${status.generation}:${request.width}x${request.height}@${request.scale}`;
			if (key === synced.current) return;
			synced.current = key;
			void browserNative.viewport({ chatId: status.chatId, generation: status.generation }, request.width, request.height, request.scale).catch(() => { if (synced.current === key) synced.current = ""; });
		};
		const observer = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(apply, 200); });
		observer.observe(element);
		apply();
		return () => { observer.disconnect(); clearTimeout(timer); };
	}, [status.chatId, status.generation, live]);
	useEffect(() => {
		if (!canvas.current) return;
		viewer.current = watchBrowser(status, canvas.current, {
			phase: setPhase,
			status: (value) => current.current.updateStatus(value),
			url: (url) => current.current.updateUrl(status, url),
		});
		return () => { viewer.current?.dispose(); viewer.current = undefined; };
	}, [status.chatId, status.generation, attempt]);
	const interactive = phase === "live" && status.control === "human" && !actions.pending;
	useEffect(() => {
		if (!interactive || !canvas.current || !keyboard.current || !viewer.current) return;
		const input = attachBrowserInput(keyboard.current, canvas.current, viewer.current, status);
		inputHandle.current = input;
		return () => { input.dispose(); if (inputHandle.current === input) inputHandle.current = undefined; };
	}, [interactive, status.controlVersion, status.generation, attempt]);
	return <div className="browser-screen" data-phase={phase} ref={screen}>
		<canvas ref={canvas} role="img" aria-label="当前聊天的浏览器画面" />
		{interactive && <textarea ref={keyboard} className="browser-input" aria-label="浏览器键盘输入" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />}
		{phase !== "live" && <div className="browser-screen-message" role="status"><Icon name={phase === "disconnected" ? "wifi" : "clock"} size={24} /><strong>{phase === "disconnected" ? "画面连接已断开" : phase === "waiting" ? "等待浏览器画面…" : "正在连接画面…"}</strong><p>{phase === "disconnected" ? "当前画面已失效。重新连接会读取最新页面，不会重复执行操作。" : "连接到当前聊天的浏览器。"}</p>{phase === "disconnected" && <Button onClick={() => { current.current.refresh(); retry((value) => value + 1); }}>重新连接画面</Button>}</div>}
		{phase === "live" && <span className="browser-live-indicator"><span className="dot" />实时画面</span>}
	</div>;
}

export function BrowserPanel({ chatId, controls, browserActions, compact, focusRequest, busy, onSettings, onReconnect, onCollapse }: {
	chatId: string;
	controls: BrowserPanelControls;
	browserActions: BrowserActions;
	compact: boolean;
	focusRequest: number;
	busy: boolean;
	onSettings: () => void;
	onReconnect: () => void;
	onCollapse: () => void;
}) {
	const { status, error } = controls;
	const inputHandle = useRef<{ flush: () => Promise<void> }>();
	const heading = useRef<HTMLHeadingElement>(null);
	const [dependencies, setDependencies] = useState<BrowserDependencies>();
	const [dependencyError, setDependencyError] = useState<string>();
	const [checking, setChecking] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const [actionError, setActionError] = useState<string>();
	const [check, recheck] = useState(0);
	useEffect(() => {
		let disposed = false;
		setChecking(true); setDependencyError(undefined);
		void browserNative.dependencies().then((value) => { if (!disposed) setDependencies(value); }).catch((reason) => { if (!disposed) setDependencyError(String(reason)); }).finally(() => { if (!disposed) setChecking(false); });
		return () => { disposed = true; };
	}, [check]);
	useEffect(() => { if (focusRequest || compact) heading.current?.focus(); }, [focusRequest, compact]);
	const collapse = () => { onCollapse(); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".browser-trigger")?.focus()); };
	const prepare = async () => {
		if (!status || busy || preparing) return;
		setPreparing(true); setActionError(undefined);
		try { const closed = await browserNative.close(status); controls.updateStatus(closed); controls.refresh(); onReconnect(); }
		catch (reason) { setActionError(String(reason)); }
		finally { setPreparing(false); }
	};
	const watch = canWatchBrowser(status) && !error;
	const failed = status && ["disconnected", "faulted"].includes(status.control);
	return <section className="browser-panel" aria-label="浏览器画面" data-chat-id={chatId} data-generation={status?.generation ?? ""} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); collapse(); } }}>
		<header className="browser-panel-header"><div className="browser-panel-heading"><Icon name="monitor" size={17} /><h2 ref={heading} tabIndex={-1}>浏览器</h2></div><IconButton size="compact" aria-label={compact ? "返回聊天" : "收起浏览器"} title={compact ? "返回聊天" : "收起浏览器"} onClick={collapse}><Icon name={compact ? "arrowLeft" : "panel"} size={16} /></IconButton></header>
		<div className="browser-address"><Icon name="link" size={14} /><span title={status?.url ?? undefined}>{status?.url ?? "尚未打开网页"}</span></div>
		<div className="browser-control-status" role="status"><span>{browserActions.pending === "takeOver" ? "正在接管，请等待在途操作结束…" : browserActions.pending === "stop" ? "正在停止任务…" : browserActions.pending === "close" ? "正在关闭浏览器…" : error ? "无法读取状态" : status ? browserControlLabels[status.control] : "等待浏览任务"}</span><span>{status?.control === "human" && !browserActions.pending ? "可操作" : "仅观看"}</span></div>
		{status && !["closed", "closing", "disconnected", "faulted"].includes(status.control) && <div className="browser-actions">
			{["starting", "ai", "stopped", "takingOver"].includes(status.control) && <Button size="compact" disabled={!!browserActions.pending} onClick={() => void browserActions.run("takeOver")}>接管浏览器</Button>}
			{["human", "stopped"].includes(status.control) && <Button size="compact" disabled={!!browserActions.pending || busy} onClick={() => void browserActions.run("return", inputHandle.current?.flush)}>交还 AI</Button>}
			{status.control === "ai" && status.requiresSnapshot && <Button size="compact" variant="primary" disabled={!!browserActions.pending || busy} onClick={() => void browserActions.run("continue")}>继续浏览任务</Button>}
			{["starting", "ai", "human", "takingOver", "stopping"].includes(status.control) && <Button size="compact" disabled={!!browserActions.pending} onClick={() => void browserActions.run("stop", inputHandle.current?.flush)}>停止任务</Button>}
			<Button size="compact" variant="ghost" disabled={!!browserActions.pending} onClick={() => void browserActions.run("close", inputHandle.current?.flush)}>关闭浏览器</Button>
		</div>}
		{browserActions.error && <p className="browser-panel-error" role="alert">{browserActions.error}</p>}
		{status?.control === "human" && <p className="browser-input-hint">点击画面后可输入、滚动或粘贴文本。当前 AI 轮次已中断，交还后可继续原任务。</p>}
		{status?.control === "ai" && status.requiresSnapshot && <p className="browser-input-hint">已交还。点击“继续浏览任务”后，AI 会先读取最新页面。</p>}
		{watch && status ? controls.visible ? <BrowserScreen key={`${status.chatId}:${status.generation}`} status={status} controls={controls} actions={browserActions} inputHandle={inputHandle} /> : <div className="browser-empty"><Icon name="monitor" size={28} /><strong>画面已暂停</strong><p>返回此聊天后显示最新画面，浏览器任务继续运行。</p></div> : <div className="browser-empty" role="status">
			<Icon name={error || dependencyError || failed ? "wifi" : status?.control === "starting" ? "clock" : "monitor"} size={28} />
			<strong>{error ? "浏览器服务暂不可用" : status?.control === "starting" ? "正在启动浏览器…" : failed ? browserControlLabels[status.control] : status?.control === "closing" ? "正在关闭浏览器…" : status?.control === "closed" ? "浏览器已关闭" : !dependencies ? "正在检查浏览器…" : !dependencies.ready ? "浏览器尚未就绪" : !dependencies.enabled ? "AI 浏览器尚未启用" : "让 AI 帮你浏览网页"}</strong>
			<p>{error ?? dependencyError ?? status?.error ?? (failed ? "重新准备后，向 AI 描述要打开的网页。" : status?.control === "starting" ? "首次启动可能需要几秒，画面就绪后会自动显示。" : status?.control === "closed" ? "在聊天中让 AI 再次打开网页，即可开始新的浏览任务。" : dependencies && !dependencies.ready ? dependencies.message : dependencies && !dependencies.enabled ? "在设置中开启后，向 AI 描述浏览任务。" : "在聊天中发送网址或描述任务，AI 操作时可以在这里观看。")}</p>
			{failed && <><p>重新准备会关闭当前页面，保留此聊天的登录状态。</p><Button disabled={busy || preparing} loading={preparing} title={busy ? "请等待当前轮次结束后再重新准备" : undefined} onClick={() => void prepare()}>关闭并重新准备</Button></>}
			{error && <Button onClick={controls.refresh}>重新检测</Button>}
			{!status && <div className="browser-empty-actions"><Button disabled={checking} onClick={() => { recheck((value) => value + 1); controls.refresh(); }}>{checking ? "正在检测…" : "重新检测"}</Button><Button onClick={onSettings}>浏览器设置</Button></div>}
			{status?.control === "closed" && <Button disabled={busy} onClick={onReconnect}>重新连接聊天</Button>}
		</div>}
		{actionError && <p className="browser-panel-error" role="alert">{actionError}</p>}
		<footer className="browser-panel-footer">AI 与此画面使用同一浏览器。收起面板后任务继续。</footer>
	</section>;
}
