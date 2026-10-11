import { IconButton } from "./ui";
import { Icon } from "./Icon";
import { gaugePosition, type VoyagePhase } from "../chat/sailing";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { formatDuration, formatTokens } from "../chat/usage";
import { toolStatusLabel, toolTargetText, type VoyageTimeline, type VoyageTool } from "../chat/voyageTimeline";
import { toolKind } from "../chat/toolRuns";
import { TOOL_ICONS } from "./toolIcons";

const GAUGE_LENGTH = 283;
const number = (value: number) => formatTokens(Math.round(value));
const contextLabel = (ratio: number, context?: number) => context === undefined ? "0.0%" : `${(ratio * 100).toFixed(1)}%`;

export function Boat({ className = "", position }: { className?: string; position?: number }) {
	return <svg className={className} style={position === undefined ? undefined : { left: `${position}%` }} viewBox="-34 -13 65 29" aria-hidden="true"><path d="M-30 2 L6 2 L22 -6 Q25.5 -8 24.5 -3.5 Q18 12 -14 12 Q-30 12 -30 2 Z" fill="currentColor" opacity=".7" /><path d="M-8 2 L-4 -8 L8 -8 L12 2 Z" fill="var(--accent)" /></svg>;
}

function statusText(metrics: VoyageMetrics): string {
	return metrics.streaming ? "航行中" : "已停止";
}

function Gauge({ metrics }: { metrics: VoyageMetrics }) {
	const phaseTimer = metrics.streaming && (metrics.phase === "thinking" || metrics.phase === "tool");
	const position = gaugePosition(metrics.speed);
	const angle = -90 + position * 180;
	const phaseLabel = metrics.phase === "thinking" ? "思考中" : "工具执行中";
	const gaugeNumber = phaseTimer ? formatDuration(metrics.statusDurationMs ?? 0) : metrics.speed.toFixed(1);
	const speedUnit = metrics.speedEstimated ? "tok/s · 估算" : "tok/s · 实测";
	return <div className="voyage-gauge-scene"><svg className="voyage-gauge-svg" viewBox="0 0 260 180" role="img" aria-label={phaseTimer ? `${phaseLabel}，已用时 ${gaugeNumber}` : `船速 ${gaugeNumber} token 每秒`}>
		<g className="voyage-wave-move voyage-wave" opacity=".15"><path d="M0 155 Q12 151 24 155 T48 155 T72 155 T96 155 T120 155 T144 155 T168 155 T192 155 T216 155 T240 155 T264 155" fill="none" stroke="var(--accent)" strokeWidth="1.5" /><path d="M0 162 Q12 158 24 162 T48 162 T72 162 T96 162 T120 162 T144 162 T168 162 T192 162 T216 162 T240 162 T264 162" fill="none" stroke="var(--accent)" strokeWidth="1.5" /></g>
		<path d="M40 130 A90 90 0 0 1 220 130" className="voyage-gauge-track" /><path d="M40 130 A90 90 0 0 1 220 130" className={`voyage-gauge-fill ${phaseTimer ? `timer-${metrics.phase}` : ""}`} strokeDasharray={phaseTimer ? undefined : `${(GAUGE_LENGTH * position).toFixed(1)} ${GAUGE_LENGTH}`} />
		<g className="voyage-gauge-ticks" stroke="var(--secondary)" strokeWidth="1.2" opacity=".5"><line x1="45" y1="125" x2="45" y2="118" /><line x1="75" y1="75" x2="78" y2="82" /><line x1="110" y1="45" x2="110" y2="52" /><line x1="150" y1="45" x2="150" y2="52" /><line x1="185" y1="75" x2="182" y2="82" /><line x1="215" y1="125" x2="215" y2="118" /></g>
		<text x="42" y="115" className="voyage-gauge-limit" textAnchor="end">0</text><text x="130" y="35" className="voyage-gauge-limit" textAnchor="middle">150</text><text x="218" y="115" className="voyage-gauge-limit" textAnchor="start">300+</text><text x="130" y="85" className="voyage-gauge-label" textAnchor="middle">{phaseTimer ? phaseLabel : "船速 · 输出"}</text><text x="130" y="115" className="voyage-gauge-number" textAnchor="middle">{gaugeNumber}</text><text x="130" y="128" className="voyage-gauge-unit" textAnchor="middle">{phaseTimer ? "本阶段用时" : speedUnit}</text>
		{!phaseTimer && <g className="voyage-gauge-needle" style={{ transform: `rotate(${angle}deg)` }}><line x1="130" y1="130" x2="130" y2="50" /><path d="M130 50 L126 58 L134 58 Z" fill="var(--text)" /></g>}<circle cx="130" cy="130" r="7" className="voyage-gauge-hub" /><circle cx="130" cy="130" r="3.5" fill="var(--accent)" />
		<path className="voyage-wake" d="M75 145 L95 145 M75 150 L95 150" fill="none" stroke="var(--accent)" strokeWidth="1" opacity=".4" /><g className="voyage-float" opacity="0"><circle cx="55" cy="11" r="2" fill="var(--accent)" /></g><g className="voyage-boat-bob voyage-scene-boat"><path className="voyage-wake-dash" d="M75 145 L95 145 M75 150 L95 150" fill="none" stroke="var(--accent)" strokeWidth="1" opacity=".4" /><path d="M95 143 L115 143 L120 139 Q122 137 121 141 Q117 150 100 150 Q92 150 92 145 Z" fill="var(--text)" opacity=".8" /><path d="M103 143 L106 133 L113 133 L115 143 Z" fill="var(--accent)" /></g>
	</svg></div>;
}

const PHASE_LEGEND: { phase: VoyagePhase; label: string }[] = [{ phase: "response", label: "航行" }, { phase: "thinking", label: "思考" }, { phase: "tool", label: "工具" }];

function PhaseBar({ timeline }: { timeline: VoyageTimeline }) {
	const total = Math.max(1, timeline.durationMs);
	const totals: Record<VoyagePhase, number> = { response: timeline.segments.filter((item) => item.phase === "response").reduce((sum, item) => sum + (item.endedAt ?? timeline.at) - item.startedAt, 0), thinking: timeline.thinkingMs, tool: timeline.toolMs };
	return <div className="voyage-phase-section"><div className="voyage-phase-bar" aria-hidden="true">{timeline.segments.map((segment, index) => <span key={index} className={`phase-${segment.phase}`} style={{ width: `${Math.max(0, ((segment.endedAt ?? timeline.at) - segment.startedAt) / total * 100)}%` }} />)}</div><div className="voyage-phase-legend">{PHASE_LEGEND.map(({ phase, label }) => <div key={phase} className={timeline.endedAt === undefined && timeline.phase === phase ? "current" : ""}><div className="voyage-phase-label"><i className={`phase-${phase}`} />{label}</div><div className="voyage-phase-value">{formatDuration(totals[phase])}</div></div>)}</div></div>;
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

function ToolWaterfall({ metrics }: { metrics: VoyageMetrics }) {
	if (!metrics.activeTools.length && !metrics.toolLog.length) return null;
	const active = metrics.activeTools.length;
	const failures = metrics.toolLog.filter((tool) => tool.status !== "completed").length;
	const logSummary = `航海日志 · ${metrics.toolLog.length} 项已入日志${failures ? `（${failures} 次失败）` : ""}`;
	return <section className="voyage-tools" aria-label="工具航迹"><div className="voyage-tools-header"><strong>工具航迹</strong><span>{active ? `${active} 执行中` : "空闲"}</span></div><span className="voyage-tool-announcement" role="status" aria-live="polite">{metrics.activeTools.map((tool) => `${tool.name}，执行中`).join("；") || "工具已入日志"}</span>{active > 0 && <ol className="voyage-tool-stream voyage-tool-active" aria-label="活动工具" aria-live="off" tabIndex={0}>{[...metrics.activeTools].reverse().map((tool) => <ToolTraceRow key={tool.id} tool={tool} />)}</ol>}{metrics.toolLog.length > 0 && <details className="voyage-tool-log"><summary>{logSummary}</summary><ol className="voyage-tool-stream" aria-label="工具完成日志" aria-live="polite" aria-relevant="additions" tabIndex={0}>{metrics.toolLog.map((tool) => <ToolTraceRow key={tool.id} tool={tool} />)}</ol></details>}</section>;
}

export function SpeedStats({ metrics }: { metrics: VoyageMetrics }) {
	return <dl className="voyage-speed-stats"><div><dt>本轮平均</dt><dd>{metrics.averageSpeed?.toFixed(1) ?? "—"}<small> tok/s</small></dd></div><div><dt>本轮最高</dt><dd>{metrics.peakSpeed?.toFixed(1) ?? "—"}<small> tok/s</small></dd></div></dl>;
}

export function VoyageRail({ metrics, expanded, onToggle }: { metrics: VoyageMetrics; expanded: boolean; onToggle: () => void }) {
	const progress = Math.min(1, Math.max(0, metrics.ratio));
	const titleStatus = statusText(metrics);
	const limit = metrics.limit ?? metrics.timeline?.contextLimit;
	const context = metrics.context;
	return <aside id="voyage-rail" className={`voyage-rail ${expanded ? "expanded" : "collapsed"} voyage-${metrics.pressure} voyage-${metrics.activity}`} aria-label="Skiff 航行台">{expanded ? <div className="voyage-dashboard"><header className="voyage-dashboard-header voyage-rail-header"><h1>⛵ Skiff 航行台</h1><div className="voyage-status-pill voyage-pill"><span className={`voyage-status-dot ${metrics.streaming ? "running" : "stopped"}`} />{titleStatus}</div></header><Gauge metrics={metrics} /><SpeedStats metrics={metrics} />{metrics.timeline && <PhaseBar timeline={metrics.timeline} />}<ToolWaterfall metrics={metrics} /><section className="voyage-progress-section"><div className="voyage-progress-header"><strong>航程 · 上下文</strong><span>{contextLabel(metrics.ratio, context)}</span></div><div className="voyage-progress-track-wrapper"><div className="voyage-progress-track"><span style={{ transform: `scaleX(${progress})` }} /></div><Boat className="voyage-progress-boat" position={progress * 100} /></div><div className="voyage-progress-caption"><strong>{context === undefined ? "0" : number(context)}</strong> / <span>{limit === undefined ? "—" : number(limit)}</span> tok{metrics.contextEstimated && <small title="包含按本地消息估算的读数；同次航行保留最大值"> · 估算</small>}</div></section><section className="voyage-turn"><strong>本次航行记录</strong><dl><div><dt>本轮耗时</dt><dd>{metrics.turn.durationMs === undefined ? "—" : formatDuration(metrics.turn.durationMs)}</dd></div><div><dt>输入 tokens</dt><dd>{metrics.turn.input === undefined ? "—" : number(metrics.turn.input)}</dd></div><div><dt>思考 tokens</dt><dd>{metrics.turn.reasoning === undefined ? "—" : number(metrics.turn.reasoning)}</dd></div><div><dt>输出 tokens</dt><dd>{metrics.turn.output === undefined ? "—" : number(metrics.turn.output)}</dd></div></dl></section><IconButton type="button" className="voyage-rail-toggle voyage-collapse" onClick={onToggle} aria-label="收起航行台" aria-expanded="true"><Icon name="chevron" size={16} /></IconButton></div> : <div className="voyage-collapsed-content"><IconButton type="button" className="voyage-rail-toggle collapsed-toggle" onClick={onToggle} aria-label="展开航行台" aria-expanded="false"><Icon name="chevron" size={16} /></IconButton><span className={`voyage-status-dot ${metrics.phase}`} title={titleStatus} /><strong>{metrics.streaming && metrics.phase !== "response" ? formatDuration(metrics.statusDurationMs ?? 0) : metrics.speed.toFixed(1)}</strong><small>{metrics.streaming && metrics.phase !== "response" ? "本阶段" : "tok/s"}</small></div>}</aside>;
}
