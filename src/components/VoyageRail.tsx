import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { IconButton } from "./ui";
import { Icon, type IconName } from "./Icon";
import { gaugePosition, type VoyagePhase } from "../chat/sailing";
import { sparkGeometry } from "../chat/sparkline";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { formatDuration, formatTokens } from "../chat/usage";
import { costTooltip, formatCosts, type CostSummary } from "../chat/cost";
import { toolStatusLabel, toolTargetText, type VoyageTimeline, type VoyageTool } from "../chat/voyageTimeline";
import { toolKind } from "../chat/toolRuns";
import { TOOL_ICONS } from "./toolIcons";
import { companionPose, latestToolFailed, POSE_MOOD, type CompanionPose } from "../chat/companionPose";
import { playCompanionVoice, type CompanionVoice } from "../chat/companionSound";
import { DECK_SIZE_MIN, readCompanion, readCompanionSound, readDeckMode, readDeckSize, saveCompanion, saveCompanionSound, saveDeckMode, saveDeckSize, type DeckMode } from "../chat/voyageDeck";

const GAUGE_LENGTH = 283;
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
/** A pressed chip keeps the stage for a moment; live progress then wins it back. */
const MANUAL_POSE_MS = 4000;
/** The squashed frown lasts about three stomps. */
const SQUASH_MS = 3000;
const POSE_CHIPS: { pose: CompanionPose; label: string; short: string; icon: IconName; voice: CompanionVoice }[] = [
	{ pose: "idle", label: "转圈待机", short: "待机", icon: "refresh", voice: "poke" },
	{ pose: "eat", label: "投喂小鱼", short: "投喂", icon: "tokens", voice: "eat" },
	{ pose: "happy", label: "开心鼓励", short: "鼓励", icon: "spark", voice: "happy" },
];
const DECK_OPTIONS: { mode: DeckMode; label: string; icon: IconName }[] = [
	{ mode: "companion", label: "领航员", icon: "sailboat" },
	{ mode: "billing", label: "账单明细", icon: "tokens" },
	{ mode: "blank", label: "纯净星空", icon: "spark" },
];

const number = (value: number) => formatTokens(Math.round(value));

function statusText(metrics: VoyageMetrics): string {
	return metrics.status;
}

function Gauge({ metrics }: { metrics: VoyageMetrics }) {
	const phaseTimer = metrics.streaming && (metrics.phase === "thinking" || metrics.phase === "tool");
	const average = metrics.averageSpeed;
	// A finished turn freezes the needle on its average instead of dropping to a dead zero.
	const settled = !metrics.streaming && average !== undefined;
	const reading = metrics.streaming ? metrics.speed : average ?? 0;
	const position = gaugePosition(reading);
	const angle = -90 + position * 180;
	const phaseLabel = metrics.phase === "thinking" ? "思考中" : "工具执行中";
	const gaugeNumber = phaseTimer ? formatDuration(metrics.statusDurationMs ?? 0) : settled ? average.toFixed(1) : metrics.streaming ? metrics.speed.toFixed(1) : "—";
	const label = phaseTimer ? phaseLabel : metrics.streaming ? "船速 · 输出" : settled ? "船速" : "等待启航";
	const unit = phaseTimer ? "本阶段用时" : settled ? "tok/s · 本轮均速" : metrics.streaming ? metrics.speedEstimated ? "tok/s · 估算" : "tok/s · 实测" : "tok/s";
	const readingDetail = phaseTimer ? `${phaseLabel}，已用时 ${gaugeNumber}` : settled ? `本轮均速 ${gaugeNumber} tok/s${metrics.peakSpeed === undefined ? "" : `，峰值 ${metrics.peakSpeed.toFixed(1)}`}` : metrics.streaming ? `船速 ${gaugeNumber} token 每秒` : "等待启航";
	return <section className="voyage-card voyage-card-dial" role="group" aria-label="今日航速">
		<div className="voyage-gauge-scene"><svg className="voyage-gauge-svg" viewBox="-6 0 278 180" role="img" aria-label={readingDetail}>
		<defs><linearGradient id="voyage-speed-gradient" gradientUnits="userSpaceOnUse" x1="40" y1="130" x2="220" y2="130"><stop offset="0" stopColor="var(--accent)" /><stop offset=".45" stopColor="var(--color-success)" /><stop offset=".78" stopColor="var(--color-warning)" /><stop offset="1" stopColor="var(--danger)" /></linearGradient></defs>
		<g className="voyage-wave-move voyage-wave" opacity=".15"><path d="M0 155 Q12 151 24 155 T48 155 T72 155 T96 155 T120 155 T144 155 T168 155 T192 155 T216 155 T240 155 T264 155" fill="none" stroke="var(--accent)" strokeWidth="1.5" /><path d="M0 162 Q12 158 24 162 T48 162 T72 162 T96 162 T120 162 T144 162 T168 162 T192 162 T216 162 T240 162 T264 162" fill="none" stroke="var(--accent)" strokeWidth="1.5" /></g>
		<path d="M40 130 A90 90 0 0 1 220 130" className="voyage-gauge-rainbow" stroke="url(#voyage-speed-gradient)" strokeOpacity=".34" />
		<path d="M40 130 A90 90 0 0 1 220 130" className="voyage-gauge-track" /><path d="M40 130 A90 90 0 0 1 220 130" className={`voyage-gauge-fill ${phaseTimer ? `timer-${metrics.phase}` : ""}`} strokeDasharray={phaseTimer ? undefined : `${(GAUGE_LENGTH * position).toFixed(1)} ${GAUGE_LENGTH}`} />
		<g className="voyage-gauge-ticks" stroke="var(--gauge-track)" strokeWidth="1.2"><line x1="45" y1="125" x2="45" y2="118" /><line x1="75" y1="75" x2="78" y2="82" /><line x1="110" y1="45" x2="110" y2="52" /><line x1="150" y1="45" x2="150" y2="52" /><line x1="185" y1="75" x2="182" y2="82" /><line x1="215" y1="125" x2="215" y2="118" /></g>
		{!phaseTimer && <g className="voyage-gauge-needle" style={{ transform: `rotate(${angle}deg)` }}><line x1="130" y1="130" x2="130" y2="50" /><path d="M130 50 L126 58 L134 58 Z" fill="var(--accent)" /></g>}<circle cx="130" cy="130" r="7" className="voyage-gauge-hub" /><circle cx="130" cy="130" r="3.5" fill="var(--accent)" />
		<g className="voyage-scene-layout" transform="translate(22 12)"><g className="voyage-scene-boat"><path className="voyage-wake-dash" d="M75 145 L95 145 M75 150 L95 150" fill="none" stroke="var(--accent)" strokeWidth="1" opacity=".4" /><path d="M95 143 L115 143 L120 139 Q122 137 121 141 Q117 150 100 150 Q92 150 92 145 Z" fill="var(--text)" /><path d="M103 143 L106 133 L113 133 L115 143 Z" fill="var(--accent)" /></g></g>
	</svg><div className="voyage-gauge-readout" title={readingDetail}><span className="voyage-gauge-label">{label}</span><strong className="voyage-gauge-number">{gaugeNumber}</strong><small className="voyage-gauge-unit">{unit}</small></div></div>
		<Sparkline trail={metrics.speedTrail} />
	</section>;
}

/** The trailing speed curve: a filled area under a hairline, frozen when the run stops. */
function Sparkline({ trail }: { trail: number[] }) {
	const shape = sparkGeometry(trail);
	return <svg className="voyage-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
		<defs><linearGradient id="voyage-spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".38" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient></defs>
		<line className="voyage-spark-base" x1="0" y1="24" x2="100" y2="24" />
		{shape.area && <path className="voyage-spark-area" d={shape.area} fill="url(#voyage-spark-fill)" />}
		{shape.line && <polyline className="voyage-spark-line" points={shape.line} vectorEffect="non-scaling-stroke" />}
		{shape.last && <circle className="voyage-spark-dot" cx={shape.last.x} cy={shape.last.y} r="1.4" vectorEffect="non-scaling-stroke" />}
	</svg>;
}

type DialTone = "normal" | "warning" | "critical" | "supply" | "quiet";

/** A white inset block inside the frosted tray: colored dot, big reading, soft bar. */
function Dial({ name, tone = "normal", ratio, value, label, icon, caption, hint }: { name: "context" | "cache"; tone?: DialTone; ratio: number; value: string; label: string; icon: IconName; caption: ReactNode; hint: string }) {
	const filled = `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`;
	return <div className={`voyage-dial voyage-dial-${name} voyage-dial-${tone}`} role="group" aria-label={hint}>
		<div className="voyage-dial-head"><span className="voyage-dial-icon" aria-hidden="true"><Icon name={icon} size={11} /></span><span className="voyage-dial-label">{label}</span></div>
		<strong className="voyage-dial-value">{value}</strong>
		<span className="voyage-dial-meter" aria-hidden="true"><i style={{ width: filled }} /></span>
		<span className="voyage-dial-caption">{caption}</span>
	</div>;
}

function ContextDial({ metrics }: { metrics: VoyageMetrics }) {
	const context = metrics.context;
	const ratio = context === undefined ? 0 : Math.min(1, Math.max(0, metrics.ratio));
	const tone: DialTone = context === undefined ? "quiet" : ratio > .9 ? "critical" : ratio > .75 ? "warning" : "normal";
	const capacity = metrics.limit === undefined ? "—" : number(metrics.limit);
	const caption = context === undefined ? `— / ${capacity}` : `${number(context)} / ${capacity}`;
	const percentage = context === undefined ? "—" : `${(metrics.ratio * 100).toFixed(1)}%`;
	return <Dial name="context" tone={tone} ratio={ratio} value={percentage} label="鲸鱼能量" icon="anchor" caption={caption} hint={`${metrics.contextEstimated ? "估算" : "实测"}上下文占用${context === undefined ? "" : ` ${percentage}`}，${caption} token`} />;
}

function CacheDial({ metrics }: { metrics: VoyageMetrics }) {
	const { turn } = metrics;
	const hitRate = turn.input !== undefined && turn.input > 0 ? turn.hitRate : undefined;
	const total = turn.total ?? (turn.input === undefined && turn.output === undefined ? undefined : (turn.input ?? 0) + (turn.output ?? 0));
	const ratio = hitRate === undefined ? 0 : Math.min(1, Math.max(0, hitRate));
	// A cold cache is not a warning: only a real hit rate earns color.
	const tone: DialTone = hitRate === undefined || hitRate <= 0 ? "quiet" : hitRate >= .7 ? "supply" : "normal";
	const value = hitRate === undefined ? total === undefined ? "—" : number(total) : `${(ratio * 100).toFixed(1)}%`;
	const priced = formatCosts(metrics.sessionCost, 4) !== "—";
	const caption = priced ? <CostButton className="voyage-dial-cost" cost={metrics.sessionCost} label="会话费用" /> : turn.newInput === undefined ? "暂无费用" : `+${number(turn.newInput)} 新增`;
	const hint = hitRate === undefined ? "本轮缓存命中率暂无数据" : `本轮缓存命中率 ${(ratio * 100).toFixed(1)}%，命中越多重复上下文越省`;
	return <Dial name="cache" tone={tone} ratio={ratio} value={value} label="亲密补给" icon="heart" caption={caption} hint={hint} />;
}

const PHASE_LEGEND: { phase: VoyagePhase; label: string }[] = [{ phase: "response", label: "航行" }, { phase: "thinking", label: "思考" }, { phase: "tool", label: "工具" }];

function PhaseBar({ timeline }: { timeline: VoyageTimeline }) {
	const total = Math.max(1, timeline.durationMs);
	const totals: Record<VoyagePhase, number> = { response: timeline.segments.filter((item) => item.phase === "response").reduce((sum, item) => sum + (item.endedAt ?? timeline.at) - item.startedAt, 0), thinking: timeline.thinkingMs, tool: timeline.toolMs };
	return <div className="voyage-phase-section"><div className="voyage-phase-bar" aria-hidden="true">{timeline.segments.map((segment, index) => <span key={index} className={`phase-${segment.phase}`} style={{ width: `${Math.max(0, ((segment.endedAt ?? timeline.at) - segment.startedAt) / total * 100)}%` }} />)}</div><div className="voyage-phase-legend">{PHASE_LEGEND.map(({ phase, label }) => <div key={phase} className={`${timeline.endedAt === undefined && timeline.phase === phase ? "current" : ""}${totals[phase] === 0 ? " is-zero" : ""}`}><div className="voyage-phase-label"><i className={`phase-${phase}`} />{label}</div><div className="voyage-phase-value">{formatDuration(totals[phase])}</div></div>)}</div></div>;
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

function ToolLog({ metrics, open = false }: { metrics: VoyageMetrics; open?: boolean }) {
	const details = useRef<HTMLDetailsElement>(null);
	// The billing deck is an explicit request for the full record, so its log starts expanded.
	useEffect(() => { if (open && details.current) details.current.open = true; }, [open]);
	if (!metrics.toolLog.length) return null;
	const failures = metrics.toolLog.filter((tool) => tool.status !== "completed").length;
	const summary = `航海日志 · ${metrics.toolLog.length} 项已入日志${failures ? `（${failures} 次失败）` : ""}`;
	return <details ref={details} className="voyage-tool-log"><summary>{summary}</summary><ol className="voyage-tool-stream" aria-label="工具完成日志" aria-live="polite" aria-relevant="additions" tabIndex={0}>{metrics.toolLog.map((tool) => <ToolTraceRow key={tool.id} tool={tool} />)}</ol></details>;
}

function CostButton({ cost, label, className }: { cost?: CostSummary; label: string; className: string }) {
	const amount = formatCosts(cost, 4);
	const precise = formatCosts(cost, 6);
	const [status, setStatus] = useState("");
	const timer = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => () => clearTimeout(timer.current), []);
	return <><button type="button" className={className} disabled={precise === "—"} title={precise === "—" ? costTooltip(cost) : `精确费用 ${precise}；${costTooltip(cost)}；点击复制`} aria-label={`复制${label}`} onClick={async () => {
		try { await navigator.clipboard.writeText(precise); setStatus(`${label}已复制`); }
		catch { setStatus("复制失败"); }
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setStatus(""), 2000);
	}}>{amount}</button><span className="sr-only" role="status">{status}</span></>;
}

function TurnRecord({ metrics }: { metrics: VoyageMetrics }) {
	const { turn } = metrics;
	const total = turn.total ?? (turn.input === undefined && turn.output === undefined ? undefined : (turn.input ?? 0) + (turn.output ?? 0));
	const hitRate = turn.input !== undefined && turn.input > 0 ? turn.hitRate : undefined;
	const hitTone = hitRate === undefined ? undefined : hitRate >= 0.9 ? "hit-high" : hitRate < 0.7 ? "hit-low" : undefined;
	const hasBilling = formatCosts(turn.cost, 4) !== "—" || formatCosts(metrics.sessionCost, 4) !== "—";
	const unconfigured = turn.cost?.unconfigured || metrics.sessionCost.unconfigured;
	return <section className="voyage-turn" aria-label="本次航行记录">
		<div className="voyage-turn-header"><strong>本次航行记录</strong><span>{total === undefined ? "—" : `${number(total)} tok`}</span></div>
		<dl className="voyage-turn-metrics">
			<div><dt title="本轮所有请求的输入，含缓存读取与写入">累计输入</dt><dd>{turn.input === undefined ? "—" : number(turn.input)}</dd></div>
			<div><dt>新增 / 缓存</dt><dd>{turn.newInput === undefined && hitRate === undefined ? "—" : <><span className="voyage-turn-new" title="新增输入，含缓存写入">{turn.newInput === undefined ? "—" : `+${number(turn.newInput)}`}</span><span aria-hidden="true"> · </span><span className={hitTone} title="缓存命中率">{hitRate === undefined ? "—" : `${(hitRate * 100).toFixed(1)}%`}</span></>}</dd></div>
			{turn.reasoning !== undefined && turn.reasoning > 0 && <div><dt>思考</dt><dd>{number(turn.reasoning)}</dd></div>}
			<div><dt>输出</dt><dd>{turn.output === undefined ? "—" : number(turn.output)}</dd></div>
			{!metrics.timeline && turn.durationMs !== undefined && <div><dt>本轮耗时</dt><dd>{formatDuration(turn.durationMs)}</dd></div>}
		</dl>
		<dl className="voyage-turn-billing">{hasBilling ? <>
			<div><dt>本轮费用</dt><dd><CostButton className="voyage-turn-cost" cost={turn.cost} label="本轮费用" /></dd></div>
			<div><dt>会话累计</dt><dd><strong><CostButton className="voyage-turn-cost" cost={metrics.sessionCost} label="会话累计费用" /></strong></dd></div>
		</> : <div><dt>计费</dt><dd className="voyage-turn-unpriced">{unconfigured ? "未配置定价" : "暂无费用数据"}</dd></div>}</dl>
	</section>;
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

/** One mood drives both the banner and the stage: live progress wins over a
 *  pressed chip, and the reduced-motion preference wins over both. */
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
	const [sound, setSound] = useState(() => readCompanionSound());
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
	const speak = (voice: CompanionVoice) => { if (sound) playCompanionVoice(voice); };
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
		speak("poke");
		setTapped(true);
		window.clearTimeout(tapTimer.current);
		tapTimer.current = window.setTimeout(() => setTapped(false), TAP_MS);
		if (reduced) return;
		art.current?.animate([{ transform: "scale(1)" }, { transform: "translateY(-6px) scale(1.05, .95)" }, { transform: "scale(.98, 1.02)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.3, 1.5, .45, 1)" });
	};
	const squash = () => {
		speak("squash");
		// A double click ends the poke frame before the frown lands.
		window.clearTimeout(tapTimer.current);
		setTapped(false);
		if (!reduced) art.current?.animate([{ transform: "scale(1.18, .72)" }, { transform: "scale(.94, 1.1)" }, { transform: "scale(1.03, .98)" }, { transform: "scale(1)" }], { duration: 620, easing: "cubic-bezier(.4, 1.8, .5, 1)" });
		press("angry", SQUASH_MS);
		announce("领航员被捏扁了，正在跺脚");
	};
	const prompt = (target: CompanionPose, label: string, voice: CompanionVoice) => {
		speak(voice);
		press(target, MANUAL_POSE_MS);
		announce(`${label} · ${POSE_MOOD[target]}`);
	};
	const toggleSound = () => {
		const next = !sound;
		setSound(next);
		saveCompanionSound(next);
		if (next) playCompanionVoice("happy");
		announce(next ? "互动音效已开启" : "互动音效已关闭");
	};
	return <div className={`voyage-companion pose-${pose}`}>
		<div className="voyage-companion-stage" aria-label={`领航员，${pose === "still" ? "静止" : POSE_MOOD[pose]}，右键更换`} title="单击互动，双击捏扁，右键更换领航员" onContextMenu={(event) => { event.preventDefault(); file.current?.click(); }} onClick={poke} onDoubleClick={squash}>
			<svg className="voyage-stage-decor" viewBox="0 0 200 200" aria-hidden="true">
				<g className="voyage-drift-a"><circle cx="38" cy="96" r="3.6" /><circle cx="54" cy="76" r="2" /></g>
				<g className="voyage-drift-b"><circle cx="164" cy="62" r="2.6" /><circle cx="152" cy="84" r="1.6" /></g>
				<path className="voyage-drift-c" d="M150 118c8-7 18-6 22-2-4 6-14 9-22 2Zm0 0-6-5v10Z" />
				<path className="voyage-sparkle-a" d="m64 44 2.4 6.2 6.2 2.4-6.2 2.4L64 61.2l-2.4-6.2L55.4 52.6l6.2-2.4Z" />
				<path className="voyage-sparkle-b" d="m142 150 1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8Z" />
			</svg>
			{shownNow ? <img ref={art} className="voyage-companion-art" src={shownNow} alt="" draggable={false} onError={() => setMissing((list) => list.includes(shownNow) ? list : [...list, shownNow])} /> : <span className="voyage-companion-ghost" aria-hidden="true" />}
			{pose === "sleep" && <span className="voyage-companion-bubble" aria-hidden="true">z z</span>}
			<svg className="voyage-companion-pedestal" viewBox="0 0 160 44" aria-hidden="true">
				<ellipse className="voyage-pedestal-glow" cx="80" cy="22" rx="50" ry="14" />
				<ellipse className="voyage-pedestal-ring" cx="80" cy="22" rx="58" ry="12" />
				<ellipse className="voyage-pedestal-ripple" cx="80" cy="22" rx="34" ry="7" />
			</svg>
		</div>
		<div className="voyage-companion-actions" role="group" aria-label="领航员互动">
			{POSE_CHIPS.map(({ pose: target, label, short, icon, voice }) => <button key={target} type="button" className={`voyage-companion-chip chip-${target}${pose === target ? " is-active" : ""}`} title={`${label} · ${POSE_MOOD[target]}`} onClick={() => prompt(target, label, voice)}><span className="voyage-chip-dot" aria-hidden="true"><Icon name={icon} size={11} /></span>{short}</button>)}
			<button type="button" className="voyage-companion-chip voyage-companion-sound" aria-pressed={sound} aria-label={sound ? "关闭互动音效" : "开启互动音效"} title={sound ? "关闭互动音效" : "开启互动音效"} onClick={toggleSound}><span className="voyage-chip-dot" aria-hidden="true"><Icon name={sound ? "sound" : "mute"} size={11} /></span></button>
		</div>
		<input ref={file} type="file" className="sr-only" aria-label="更换领航员" accept=".webp,.gif,.png,image/webp,image/gif,image/png" onChange={pick} />
		{custom && <button type="button" className="voyage-companion-reset" title="恢复默认领航员" aria-label="恢复默认领航员" onClick={reset}><Icon name="refresh" size={14} /></button>}
		<span className="sr-only" role="status">{notice}</span>
	</div>;
}

/** Split handle on the deck divider: pulling up grows the deck and the cluster scrolls. */
function DeckHandle({ getValue, getMax, onResize, onCommit, onReset }: { getValue: () => number; getMax: () => number; onResize: (size: number) => void; onCommit: (size: number) => void; onReset: () => void }) {
	const [dragging, setDragging] = useState(false);
	const drag = useRef<{ pointerId: number; startY: number; startValue: number; currentValue: number }>();
	const callbacks = useRef({ getValue, getMax, onResize, onCommit });
	callbacks.current = { getValue, getMax, onResize, onCommit };
	const clamp = (next: number) => Math.max(DECK_SIZE_MIN, Math.min(callbacks.current.getMax(), Math.round(next)));
	const finish = useCallback(() => {
		const active = drag.current;
		if (!active) return;
		drag.current = undefined;
		setDragging(false);
		callbacks.current.onCommit(active.currentValue);
	}, []);
	useEffect(() => {
		if (!dragging) return;
		window.addEventListener("blur", finish);
		return () => window.removeEventListener("blur", finish);
	}, [dragging, finish]);
	useEffect(() => () => finish(), [finish]);
	const move = (clientY: number) => {
		const active = drag.current;
		if (!active) return;
		const next = clamp(active.startValue - (clientY - active.startY));
		active.currentValue = next;
		callbacks.current.onResize(next);
	};
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const current = clamp(callbacks.current.getValue());
		const next = event.key === "Home" ? DECK_SIZE_MIN : event.key === "End" ? clamp(callbacks.current.getMax()) : clamp(current + (event.key === "ArrowUp" ? 16 : -16));
		callbacks.current.onResize(next);
		callbacks.current.onCommit(next);
	};
	return <div className={`voyage-deck-handle${dragging ? " dragging" : ""}`} role="separator" aria-orientation="horizontal" aria-label="调整仪表与甲板的高度" aria-valuemin={DECK_SIZE_MIN} aria-valuemax={Math.round(getMax())} aria-valuenow={Math.round(getValue())} tabIndex={0}
		onPointerDown={(event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			const startValue = clamp(callbacks.current.getValue());
			drag.current = { pointerId: event.pointerId, startY: event.clientY, startValue, currentValue: startValue };
			event.currentTarget.setPointerCapture(event.pointerId);
			setDragging(true);
		}}
		onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) move(event.clientY); }}
		onPointerUp={(event) => { if (drag.current?.pointerId === event.pointerId) { move(event.clientY); finish(); } }}
		onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={onKeyDown} onDoubleClick={onReset} />;
}

/** `onCollapse` is only wired for the narrow-screen dialog, where the title bar toggle is covered. */
export function VoyageRail({ metrics, onCollapse }: { metrics: VoyageMetrics; onCollapse?: () => void }) {
	const [deck, setDeck] = useState<DeckMode>(() => readDeckMode());
	const [deckSize, setDeckSize] = useState<number | undefined>(() => readDeckSize());
	const dashboard = useRef<HTMLDivElement>(null);
	const deckSection = useRef<HTMLElement>(null);
	const selectDeck = (mode: DeckMode) => { setDeck(mode); saveDeckMode(mode); };
	// The compact cluster keeps ~150px, so the deck never swallows it and keeps a
	// little headroom for the keyboard resize above the natural fill height.
	const maxDeckSize = () => Math.max(DECK_SIZE_MIN, Math.round((dashboard.current?.clientHeight ?? 0) - 150));
	const currentDeckSize = () => deckSize ?? Math.round(deckSection.current?.getBoundingClientRect().height ?? DECK_SIZE_MIN);
	const commitDeckSize = (size: number) => saveDeckSize(size);
	const resetDeckSize = () => { setDeckSize(undefined); saveDeckSize(undefined); };
	useEffect(() => {
		const onResize = () => setDeckSize((size) => size === undefined ? size : Math.min(size, maxDeckSize()));
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);
	const titleStatus = statusText(metrics);
	const mood = useCompanionMood(metrics);
	// The banner keeps a compact mood word: the full caption lives in the stage tooltip.
	const moodPose: CompanionPose = mood.pose === "still" ? "idle" : mood.pose;
	const contextShare = metrics.context !== undefined && metrics.limit ? `${Math.round(metrics.ratio * 100)}% 上下文` : undefined;
	return <aside id="voyage-rail" className={`voyage-rail expanded voyage-${metrics.pressure} voyage-${metrics.activity}`} aria-label="Skiff 航行台">
		<div ref={dashboard} className={`voyage-dashboard${deckSize === undefined ? "" : " split"}`} style={deckSize === undefined ? undefined : { "--voyage-deck-size": `${deckSize}px` } as CSSProperties}>
			<header className="voyage-dashboard-header voyage-rail-header"><h1><span className="voyage-badge" aria-hidden="true"><Icon name="sailboat" size={12} /></span>Skiff 航行台</h1><div className="voyage-status-pill voyage-pill"><span className={`voyage-status-dot ${metrics.streaming ? "running" : "stopped"}`} />{titleStatus}</div></header>
			<div className="voyage-mood" data-pose={moodPose} title={`领航员心情：${POSE_MOOD[moodPose]}；${titleStatus}`}>
				<i className="voyage-mood-dot" aria-hidden="true" />
				<strong className="voyage-mood-text">{POSE_MOOD[moodPose]}</strong>
				{contextShare && <span className="voyage-mood-meta">{contextShare}</span>}
			</div>
			<div className="voyage-instruments">
				<div className="voyage-bento">
					<section className="voyage-card voyage-card-vitals" role="group" aria-label="领航员数据块">
						<div className="voyage-dials"><ContextDial metrics={metrics} /><CacheDial metrics={metrics} /></div>
					</section>
					<Gauge metrics={metrics} />
				</div>
				{metrics.timeline && <PhaseBar timeline={metrics.timeline} />}
				<ToolCapsule metrics={metrics} />
				{deck !== "billing" && <ToolLog metrics={metrics} />}
			</div>
			<section ref={deckSection} className={`voyage-deck voyage-deck-${deck}`} aria-label="领航员甲板">
				<DeckHandle getValue={currentDeckSize} getMax={maxDeckSize} onResize={setDeckSize} onCommit={commitDeckSize} onReset={resetDeckSize} />
				<div className="voyage-deck-switch" role="group" aria-label="甲板视图">
					{DECK_OPTIONS.map(({ mode, label, icon }) => <button key={mode} type="button" className={`voyage-deck-mode${deck === mode ? " is-active" : ""}`} aria-pressed={deck === mode} aria-label={label} title={label} onClick={() => selectDeck(mode)}><Icon name={icon} size={14} /></button>)}
				</div>
				{deck === "companion" && <Companion pose={mood.pose} press={mood.press} reduced={mood.reduced} />}
				{deck === "billing" && <div className="voyage-deck-bill"><TurnRecord metrics={metrics} /><ToolLog metrics={metrics} open /></div>}
			</section>
			{onCollapse && <IconButton type="button" className="voyage-rail-toggle voyage-collapse" onClick={onCollapse} aria-label="收起航行台"><Icon name="chevron" size={16} /></IconButton>}
		</div>
	</aside>;
}
