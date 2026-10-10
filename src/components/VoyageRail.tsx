import { IconButton } from "./ui";
import { Icon } from "./Icon";
import type { CSSProperties } from "react";
import { gaugePosition, type VoyageActivity } from "../chat/sailing";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { formatDuration, formatTokens } from "../chat/usage";
import { costTooltip, formatCosts } from "../chat/cost";

const number = (value: number) => formatTokens(Math.round(value));
const contextLabel = (ratio: number, context?: number) => context === undefined ? "—" : `${(ratio * 100).toFixed(1)}%`;
const GAUGE_RADIUS = 90;
const GAUGE_LENGTH = Math.PI * GAUGE_RADIUS;

function activityLabel(metrics: VoyageMetrics): string {
	if (!metrics.streaming || metrics.statusDurationMs === undefined) return metrics.status;
	return `${metrics.status} · ${formatDuration(metrics.statusDurationMs)}`;
}

export function Boat({ className = "", position, fishing = false }: { className?: string; position?: number; fishing?: boolean }) {
	return <svg className={className} style={position === undefined ? undefined : { left: `${position}%` }} viewBox={fishing ? "-34 -35 100 53" : "-34 -13 65 29"} aria-hidden="true">
		<path d="M-30 2 L6 2 L22 -6 Q25.5 -8 24.5 -3.5 Q18 12 -14 12 Q-30 12 -30 2 Z" fill="currentColor" />
		<path d="M-8 2 L-4 -8 L8 -8 L12 2 Z" fill="var(--accent)" />
		{fishing && <g className="voyage-fisher" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="0" cy="-22" r="3.5" fill="currentColor" stroke="none" />
			<path d="M-1 -17 L1 -9 L10 -9 L13 -2 M0 -16 L9 -12 L16 -16" />
			<path d="M13 -12 Q25 -32 40 -29" stroke="var(--accent)" />
			<path d="M40 -29 Q55 -17 55 8" strokeWidth=".8" />
			<g className="voyage-float"><path d="M55 6 v8" stroke="var(--accent)" /><ellipse cx="55" cy="11" rx="2" ry="3" fill="var(--accent)" stroke="none" /></g>
		</g>}
	</svg>;
}

function Speedometer({ speed }: { speed: number }) {
	const shownSpeed = speed;
	const position = gaugePosition(shownSpeed);
	const angle = -90 + position * 180;
	return <svg className="voyage-gauge" viewBox="0 0 220 142" role="img" aria-label={`船速约 ${shownSpeed.toFixed(1)} token 每秒`}>
		<path d="M20 115 A90 90 0 0 1 200 115" className="voyage-gauge-track" />
		<path d="M20 115 A90 90 0 0 1 200 115" className="voyage-gauge-fill" strokeDasharray={`${(GAUGE_LENGTH * position).toFixed(1)} ${GAUGE_LENGTH.toFixed(1)}`} />
		{Array.from({ length: 11 }, (_, index) => {
			const radians = Math.PI - index * Math.PI / 10;
			const inner = index % 2 === 0 ? 74 : 79;
			return <line key={index} x1={110 + Math.cos(radians) * inner} y1={115 - Math.sin(radians) * inner} x2={110 + Math.cos(radians) * 84} y2={115 - Math.sin(radians) * 84} className="voyage-gauge-tick" />;
		})}
		<text x="110" y="14" className="voyage-gauge-label">船速 · 输出</text>
		<text x="110" y="79" className="voyage-gauge-number">{shownSpeed.toFixed(1)}</text>
		<text x="110" y="94" className="voyage-gauge-unit">tok/s · 估算</text>
		<text x="32" y="131" className="voyage-gauge-limit">0</text>
		<text x="188" y="131" className="voyage-gauge-limit">300+</text>
		{shownSpeed > 0 && <g className="voyage-gauge-needle" style={{ transform: `rotate(${angle}deg)` }}><line x1="110" y1="124" x2="110" y2="31" /></g>}
		<circle cx="110" cy="115" r="6" className="voyage-gauge-hub" />
		<circle cx="110" cy="115" r="2.5" fill="var(--accent)" />
	</svg>;
}

function Sea({ speed, activity }: { speed: number; activity: VoyageActivity }) {
	const pace = Math.min(1, speed / 300);
	return <div className="voyage-sea" style={{ "--wave-duration": `${(3 - pace * 2.1).toFixed(2)}s`, "--wake-duration": `${(1.3 - pace * .9).toFixed(2)}s` } as CSSProperties} aria-hidden="true">
		<svg className="voyage-wake" viewBox="0 0 90 34"><path d="M85 15 C60 13 40 18 3 20 M75 8 C50 5 32 8 10 7" /></svg>
		<Boat className="voyage-scene-boat" fishing={activity === "fishing"} />
		<svg className="voyage-waves" viewBox="0 0 280 48" preserveAspectRatio="none"><g className="voyage-wave voyage-wave-one"><path d="M-48 12 Q-36 3 -24 12 T0 12 T24 12 T48 12 T72 12 T96 12 T120 12 T144 12 T168 12 T192 12 T216 12 T240 12 T264 12 T288 12" /></g><g className="voyage-wave voyage-wave-two"><path d="M-48 31 Q-36 22 -24 31 T0 31 T24 31 T48 31 T72 31 T96 31 T120 31 T144 31 T168 31 T192 31 T216 31 T240 31 T264 31 T288 31" /></g></svg>
	</div>;
}

export function VoyageRail({ metrics, expanded, onToggle }: { metrics: VoyageMetrics; expanded: boolean; onToggle: () => void }) {
	const progress = Math.min(100, metrics.ratio * 100);
	const remaining = metrics.context === undefined || metrics.limit === undefined ? "剩余额度待首次回复后计算" : `剩余 ${number(Math.max(0, metrics.limit - metrics.context))} tokens`;
	return <aside id="voyage-rail" className={`voyage-rail ${expanded ? "expanded" : "collapsed"} voyage-${metrics.pressure} voyage-${metrics.activity}`} aria-label="Skiff 航行台">
		{expanded ? <>
			<div className="voyage-rail-header"><strong>Skiff 航行台</strong><IconButton type="button" className="voyage-rail-toggle" onClick={onToggle} aria-label="收起航行台" aria-expanded="true"><Icon name="chevron" size={16} /></IconButton></div>
			<span className="voyage-pill"><span className="voyage-status-dot" />{activityLabel(metrics)}</span>
			<div className="voyage-instrument"><Speedometer speed={metrics.speed} /><SpeedStats metrics={metrics} /><Sea speed={metrics.speed} activity={metrics.activity} /></div>
			{metrics.reminder && <p className="voyage-context-reminder"><Icon name="info" /><span>{metrics.reminder}</span></p>}
			<div className="voyage-mileage"><div className="voyage-mileage-title"><strong>航程 · 当前上下文</strong><span>{contextLabel(metrics.ratio, metrics.context)}</span></div><div className="voyage-mileage-route" title={remaining}><span className="voyage-anchor" aria-hidden="true"><Icon name="anchor" size={16} /></span><div className="voyage-mileage-track"><span style={{ transform: `scaleX(${progress / 100})` }} /><Boat className="voyage-mileage-boat" position={progress} /></div><span className="voyage-flag" aria-hidden="true"><Icon name="flag" size={16} /></span></div><div className="voyage-mileage-caption"><strong>{metrics.context === undefined ? "—" : number(metrics.context)}</strong><span> / {metrics.limit ? number(metrics.limit) : "—"} tok</span></div><p className="voyage-meter-note">已航行 {metrics.context === undefined ? "—" : number(metrics.context)} m · 1 tok = 1 m</p></div>
			{metrics.context !== undefined && <dl className="voyage-breakdown"><div><dt>系统提示词与工具定义</dt><dd>~{number(metrics.overhead ?? 0)}</dd></div><div><dt>对话消息</dt><dd>~{number(metrics.conversation ?? 0)}</dd></div></dl>}
			<div className="voyage-turn"><strong>本次航行记录</strong><dl><div><dt>本轮耗时</dt><dd>{metrics.turn.durationMs === undefined ? "—" : formatDuration(metrics.turn.durationMs)}</dd></div><div><dt>输出 tokens</dt><dd>{metrics.turn.output === undefined ? "—" : number(metrics.turn.output)}</dd></div><div><dt>费用</dt><dd title={costTooltip(metrics.turn.cost)}>{formatCosts(metrics.turn.cost)}</dd></div><div><dt>会话累计</dt><dd title={costTooltip(metrics.sessionCost)}>{formatCosts(metrics.sessionCost)}</dd></div></dl></div>
			<p className="voyage-note">船速与最高速度按思考及回复文字估算；平均速度包含等待与工具执行时间。{metrics.streaming ? "航程在本轮完成后更新。" : ""}</p>
		</> : <>
			<IconButton type="button" className="voyage-rail-toggle collapsed-toggle" onClick={onToggle} aria-label="展开航行台" aria-expanded="false"><Icon name="chevron" size={16} /></IconButton>
			<span className="voyage-status-dot" title={metrics.status} />
			<strong className="voyage-collapsed-speed" title={`${metrics.speed.toFixed(1)} tok/s`}>{metrics.speed.toFixed(1)}</strong>
			<small>tok/s</small>
		</>}
	</aside>;
}

export function SpeedStats({ metrics }: { metrics: VoyageMetrics }) {
	return <dl className="voyage-speed-stats">
		<div><dt>本轮平均{metrics.averageEstimated ? " · 估算" : ""}</dt><dd>{metrics.averageSpeed?.toFixed(1) ?? "—"}<small> tok/s</small></dd></div>
		<div><dt>本轮最高 · 估算</dt><dd>{metrics.peakSpeed?.toFixed(1) ?? "—"}<small> tok/s</small></dd></div>
	</dl>;
}
