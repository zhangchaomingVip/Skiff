import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { IconButton } from "./ui";
import { Icon } from "./Icon";
import { VoyageBento } from "./VoyageBento";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { formatDuration } from "../chat/usage";
import { toolStatusLabel, toolTargetText, type VoyageTool } from "../chat/voyageTimeline";
import { toolKind } from "../chat/toolRuns";
import { TOOL_ICONS } from "./toolIcons";
import { companionPose, latestToolFailed, POSE_MOOD, type CompanionPose } from "../chat/companionPose";
import { readCompanion, saveCompanion } from "../chat/voyageDeck";

/** The poke frame: pressing the navigator shows the tap art for a beat. */
const TAP_ART = "/companion/tap.webp";
const TAP_MS = 640;
const COMPANION_ART: Record<CompanionPose | "still", string> = {
	idle: "/companion/idle.webp",
	happy: "/companion/happy.webp",
	eat: "/companion/eat.webp",
	sleep: "/companion/sleep.webp",
	angry: "/companion/angry.webp",
	still: "/companion/idle.png",
};
/** The squashed frown lasts about three stomps. */
const SQUASH_MS = 3000;

function statusText(metrics: VoyageMetrics): string {
	return metrics.status;
}

function toolIcon(tool: VoyageTool) {
	const name = tool.status === "completed" ? "check" : tool.status === "failed" || tool.status === "timeout" ? "close" : TOOL_ICONS[toolKind(tool.name)];
	return <Icon name={name} size={16} />;
}

function ToolTraceRow({ tool }: { tool: VoyageTool }) {
	const target = toolTargetText(tool.summary);
	const caption = target;
	const stateLabel = tool.status === "completed" || tool.status === "running" ? undefined : toolStatusLabel[tool.status];
	return <li className={`voyage-tool-row tool-${tool.status} ${tool.showDuration ? "tool-long" : "tool-short"}`} data-tool-id={tool.id} aria-label={`${tool.name}${stateLabel ? `，${stateLabel}` : ""}${caption ? `，${caption}` : ""}`}><span className="voyage-tool-icon" aria-hidden="true">{toolIcon(tool)}</span><strong className="voyage-tool-name" title={tool.name}>{tool.name}</strong>{caption && <span className="voyage-tool-desc" title={tool.summary}>{caption}</span>}{stateLabel && <span className="voyage-tool-state">{stateLabel}</span>}{tool.showDuration && <time className="voyage-tool-time">{formatDuration(tool.durationMs)}</time>}{tool.status !== "running" && tool.result && <span className="voyage-tool-result" title={tool.result}>{tool.result}</span>}</li>;
}

/** Only running calls get airtime; finished work collapses into the log drawer. */
function ToolCapsule({ metrics }: { metrics: VoyageMetrics }) {
	if (!metrics.activeTools.length) return null;
	return <section className="voyage-tools voyage-tools-live" aria-label="工具航迹">
		<span className="voyage-tool-announcement" role="status" aria-live="polite">{metrics.activeTools.map((tool) => `${tool.name}，执行中`).join("；")}</span>
		<ol className="voyage-tool-stream voyage-tool-active" aria-label="活动工具" aria-live="off" tabIndex={0}>{[...metrics.activeTools].reverse().map((tool) => <ToolTraceRow key={tool.id} tool={tool} />)}</ol>
	</section>;
}

function ToolLog({ metrics }: { metrics: VoyageMetrics }) {
	if (!metrics.toolLog.length) return null;
	const failures = metrics.toolLog.filter((tool) => tool.status !== "completed").length;
	const summary = `航海日志 · ${metrics.toolLog.length} 项已入日志${failures ? `（${failures} 次失败）` : ""}`;
	return <details className="voyage-tool-log"><summary>{summary}</summary><ol className="voyage-tool-stream" aria-label="工具完成日志" aria-live="polite" aria-relevant="additions" tabIndex={0}>{metrics.toolLog.map((tool) => <ToolTraceRow key={tool.id} tool={tool} />)}</ol></details>;
}

function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReduced(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return reduced;
}

/** Live progress wins over the squash reaction; reduced motion keeps a still pose. */
function useCompanionMood(metrics: VoyageMetrics) {
	const reduced = useReducedMotion();
	const automatic = companionPose({
		streaming: metrics.streaming,
		phase: metrics.phase,
		activity: metrics.activity,
		ratio: metrics.ratio,
		activeTools: metrics.activeTools.length,
		failedTool: latestToolFailed(metrics.toolLog),
		hitRate: metrics.turn.hitRate,
	});
	const [manual, setManual] = useState<{ pose: CompanionPose; until: number }>();
	useEffect(() => { setManual(undefined); }, [automatic]);
	useEffect(() => {
		if (!manual) return;
		const timer = window.setTimeout(() => setManual(undefined), Math.max(0, manual.until - Date.now()));
		return () => window.clearTimeout(timer);
	}, [manual]);
	const pose: CompanionPose | "still" = reduced ? "still" : manual?.pose ?? automatic;
	return {
		pose,
		reduced,
		/** Hold a pose for a moment; the next real state change takes it back. */
		press: (target: CompanionPose, ms: number) => setManual({ pose: target, until: Date.now() + ms }),
	};
}

/** The navigator stage: five live poses driven by the voyage, with a static
 *  reduced-motion fallback and a pettable, squishable body. */
function Companion({ pose, press, reduced }: { pose: CompanionPose | "still"; press: (pose: CompanionPose, ms: number) => void; reduced: boolean }) {
	const [custom, setCustom] = useState<string | undefined>(() => readCompanion());
	const [missing, setMissing] = useState<string[]>([]);
	const [notice, setNotice] = useState("");
	const [tapped, setTapped] = useState(false);
	const file = useRef<HTMLInputElement>(null);
	const art = useRef<HTMLImageElement>(null);
	const noticeTimer = useRef<number>();
	const tapTimer = useRef<number>();
	useEffect(() => () => {
		window.clearTimeout(noticeTimer.current);
		window.clearTimeout(tapTimer.current);
	}, []);
	// Warm the other poses so the first switch is not a blank frame.
	useEffect(() => {
		if (reduced) return;
		for (const name of ["happy", "eat", "sleep", "angry"] as const) {
			const image = new Image();
			image.src = COMPANION_ART[name];
		}
	}, [reduced]);
	const candidates = custom ? [custom, COMPANION_ART.idle, COMPANION_ART.still] : [COMPANION_ART[pose], COMPANION_ART.idle, COMPANION_ART.still];
	const shown = candidates.find((candidate) => !missing.includes(candidate));
	// A poke borrows the art for a beat; the pose itself never changes.
	const shownNow = tapped && shown !== TAP_ART && !missing.includes(TAP_ART) ? TAP_ART : shown;
	const announce = (message: string) => {
		setNotice(message);
		window.clearTimeout(noticeTimer.current);
		noticeTimer.current = window.setTimeout(() => setNotice(""), 2400);
	};
	const pick = (event: ChangeEvent<HTMLInputElement>) => {
		const selected = event.target.files?.[0];
		event.target.value = "";
		if (!selected) return;
		if (!/^image\/(?:webp|gif|png)$/.test(selected.type)) { announce("仅支持 webp、gif 或 png"); return; }
		const reader = new FileReader();
		reader.onload = () => {
			const value = typeof reader.result === "string" ? reader.result : "";
			if (!value.startsWith("data:image/")) { announce("无法读取该图片"); return; }
			if (!saveCompanion(value)) { announce("图片过大，请控制在 1MB 以内"); return; }
			setCustom(value);
			setMissing((list) => list.filter((item) => item !== value));
			announce("领航员已更换");
		};
		reader.onerror = () => announce("无法读取该图片");
		reader.readAsDataURL(selected);
	};
	const reset = () => {
		saveCompanion(undefined);
		setCustom(undefined);
		announce("已恢复默认领航员");
	};
	const poke = () => {
		setTapped(true);
		window.clearTimeout(tapTimer.current);
		tapTimer.current = window.setTimeout(() => setTapped(false), TAP_MS);
		if (reduced) return;
		art.current?.animate([{ transform: "scale(1)" }, { transform: "translateY(-6px) scale(1.05, .95)" }, { transform: "scale(.98, 1.02)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.3, 1.5, .45, 1)" });
	};
	const squash = () => {
		// A double click ends the poke frame before the frown lands.
		window.clearTimeout(tapTimer.current);
		setTapped(false);
		if (!reduced) art.current?.animate([{ transform: "scale(1.18, .72)" }, { transform: "scale(.94, 1.1)" }, { transform: "scale(1.03, .98)" }, { transform: "scale(1)" }], { duration: 620, easing: "cubic-bezier(.4, 1.8, .5, 1)" });
		press("angry", SQUASH_MS);
		announce("领航员被捏扁了，正在跺脚");
	};
	return <div className={`voyage-companion pose-${pose}`}>
		<div className="voyage-companion-stage" aria-label={`领航员，${pose === "still" ? "静止" : POSE_MOOD[pose]}，右键更换`} title="单击互动，双击捏扁，右键更换领航员" onContextMenu={(event) => { event.preventDefault(); file.current?.click(); }} onClick={poke} onDoubleClick={squash}>
			<svg className="voyage-stage-decor" viewBox="0 0 200 200" aria-hidden="true">
				<g className="voyage-drift-a"><circle cx="38" cy="96" r="3.6" /><circle cx="54" cy="76" r="2" /></g>
				<g className="voyage-drift-b"><circle cx="164" cy="62" r="2.6" /><circle cx="152" cy="84" r="1.6" /></g>
				<path className="voyage-drift-c" d="M150 118c8-7 18-6 22-2-4 6-14 9-22 2Zm0 0-6-5v10Z" />
				<path className="voyage-sparkle-a" d="m64 44 2.4 6.2 6.2 2.4-6.2 2.4L64 61.2l-2.4-6.2L55.4 52.6l6.2-2.4Z" />
				<path className="voyage-sparkle-b" d="m142 150 1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8Z" />
				<g className="voyage-floor-bubbles"><circle cx="168" cy="181" r="6" /><circle cx="185" cy="169" r="3.5" /><path d="M164 179q1-3 4-3M183 168q.5-1.5 2-1.5" /></g>
			</svg>
			{shownNow ? <img ref={art} className="voyage-companion-art" src={shownNow} alt="" draggable={false} onError={() => setMissing((list) => list.includes(shownNow) ? list : [...list, shownNow])} /> : <span className="voyage-companion-ghost" aria-hidden="true" />}
			{pose === "sleep" && <span className="voyage-companion-bubble" aria-hidden="true">z z</span>}
			<svg className="voyage-companion-pedestal" viewBox="0 0 160 44" aria-hidden="true">
				<ellipse className="voyage-pedestal-glow" cx="80" cy="22" rx="50" ry="14" />
				<ellipse className="voyage-pedestal-ring" cx="80" cy="22" rx="58" ry="12" />
				<ellipse className="voyage-pedestal-ripple" cx="80" cy="22" rx="34" ry="7" />
			</svg>
		</div>
		<input ref={file} type="file" className="sr-only" aria-label="更换领航员" accept=".webp,.gif,.png,image/webp,image/gif,image/png" onChange={pick} />
		{custom && <button type="button" className="voyage-companion-reset" title="恢复默认领航员" aria-label="恢复默认领航员" onClick={reset}><Icon name="refresh" size={14} /></button>}
		<span className="sr-only" role="status">{notice}</span>
	</div>;
}

/** `onCollapse` is only wired for the narrow-screen dialog, where the title bar toggle is covered. */
export function VoyageRail({ metrics, onCollapse }: { metrics: VoyageMetrics; onCollapse?: () => void }) {
	const titleStatus = statusText(metrics);
	const mood = useCompanionMood(metrics);
	return <aside id="voyage-rail" className={`voyage-rail expanded voyage-${metrics.pressure} voyage-${metrics.activity}`} aria-label="Skiff 航行台">
		<div className="voyage-dashboard voyage-dashboard-orbit">
			<header className="voyage-dashboard-header voyage-rail-header"><h1 title={`Skiff 航行台 · ${titleStatus}`}><span className="voyage-title">Skiff 航行台</span></h1>
				{onCollapse && <IconButton type="button" className="voyage-rail-toggle voyage-collapse" onClick={onCollapse} aria-label="收起航行台"><Icon name="chevron" size={16} /></IconButton>}
			</header>
			<section className="voyage-stage-orbit" aria-label="领航员环绕舞台">
				<div className="voyage-orbit-scene">
					<VoyageBento metrics={metrics} />
					<section className="voyage-deck voyage-deck-companion" aria-label="领航员甲板">
						<Companion pose={mood.pose} press={mood.press} reduced={mood.reduced} />
					</section>
				</div>
			</section>
			{(metrics.timeline || metrics.activeTools.length > 0 || metrics.toolLog.length > 0) && <div className="voyage-orbit-log">
				<ToolCapsule metrics={metrics} /><ToolLog metrics={metrics} />
			</div>}
		</div>
	</aside>;
}
