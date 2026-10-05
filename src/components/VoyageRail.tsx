import type { CSSProperties } from "react";
import { gaugePosition } from "../chat/sailing";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { formatDuration } from "../chat/usage";
import { costTooltip, formatCosts } from "../chat/cost";

const number = (value: number) => Math.round(value).toLocaleString("zh-CN");
const contextLabel = (ratio: number, context?: number) => context === undefined ? "—" : ratio >= 1 ? `超出 ${ratio.toFixed(1)}×` : `${(ratio * 100).toFixed(1)}%`;
const GAUGE_RADIUS = 90;
const GAUGE_LENGTH = Math.PI * GAUGE_RADIUS;

export function Boat({ className = "", position }: { className?: string; position?: number }) {
	return <svg className={className} style={position === undefined ? undefined : { left: `${position}%` }} viewBox="-34 -13 65 29" aria-hidden="true">
		<path d="M-30 2 L6 2 L22 -6 Q25.5 -8 24.5 -3.5 Q18 12 -14 12 Q-30 12 -30 2 Z" fill="currentColor" />
		<path d="M-8 2 L-4 -8 L8 -8 L12 2 Z" fill="var(--accent)" />
	</svg>;
}

function Speedometer({ speed }: { speed: number }) {
	const shownSpeed = speed < 5 ? 0 : speed;
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
		<text x="110" y="79" className="voyage-gauge-number">{shownSpeed ? shownSpeed.toFixed(1) : "0"}</text>
		<text x="110" y="94" className="voyage-gauge-unit">tok/s · 估算</text>
		<text x="32" y="131" className="voyage-gauge-limit">0</text>
		<text x="188" y="131" className="voyage-gauge-limit">300+</text>
		{shownSpeed >= 5 && <g className="voyage-gauge-needle" style={{ transform: `rotate(${angle}deg)` }}><line x1="110" y1="124" x2="110" y2="31" /></g>}
		<circle cx="110" cy="115" r="6" className="voyage-gauge-hub" />
		<circle cx="110" cy="115" r="2.5" fill="var(--accent)" />
	</svg>;
}

function Sea({ speed }: { speed: number }) {
	const pace = Math.min(1, speed / 300);
	return <div className="voyage-sea" style={{ "--wave-duration": `${(3 - pace * 2.1).toFixed(2)}s`, "--wake-duration": `${(1.3 - pace * .9).toFixed(2)}s` } as CSSProperties} aria-hidden="true">
		<svg className="voyage-wake" viewBox="0 0 90 34"><path d="M85 15 C60 13 40 18 3 20 M75 8 C50 5 32 8 10 7" /></svg>
		<Boat className="voyage-scene-boat" />
		<svg className="voyage-waves" viewBox="0 0 280 48" preserveAspectRatio="none"><g className="voyage-wave voyage-wave-one"><path d="M-48 12 Q-36 3 -24 12 T0 12 T24 12 T48 12 T72 12 T96 12 T120 12 T144 12 T168 12 T192 12 T216 12 T240 12 T264 12 T288 12" /></g><g className="voyage-wave voyage-wave-two"><path d="M-48 31 Q-36 22 -24 31 T0 31 T24 31 T48 31 T72 31 T96 31 T120 31 T144 31 T168 31 T192 31 T216 31 T240 31 T264 31 T288 31" /></g></svg>
	</div>;
}

export function VoyageRail({ metrics, expanded, onToggle }: { metrics: VoyageMetrics; expanded: boolean; onToggle: () => void }) {
	const progress = Math.min(100, metrics.ratio * 100);
	const remaining = metrics.context === undefined || metrics.limit === undefined ? "剩余额度待首次回复后计算" : `剩余 ${number(Math.max(0, metrics.limit - metrics.context))} tokens`;
	return <aside id="voyage-rail" className={`voyage-rail ${expanded ? "expanded" : "collapsed"} voyage-${metrics.pressure} ${metrics.streaming ? "voyage-running" : ""} ${metrics.arrived ? "voyage-arrived" : ""}`} aria-label="Skiff 航行台">
		{expanded ? <>
			<div className="voyage-rail-header"><strong>Skiff 航行台</strong><button type="button" className="voyage-rail-toggle" onClick={onToggle} aria-label="收起航行台" aria-expanded="true">›</button></div>
			<span className="voyage-pill"><span className="voyage-status-dot" />{metrics.status}</span>
			<div className="voyage-instrument"><Speedometer speed={metrics.speed} /><Sea speed={metrics.speed} /></div>
			<div className="voyage-mileage"><div className="voyage-mileage-title"><strong>航程 · 当前上下文</strong><span>{contextLabel(metrics.ratio, metrics.context)}</span></div><div className="voyage-mileage-route" title={remaining}><span className="voyage-anchor" aria-hidden="true">⚓</span><div className="voyage-mileage-track"><span style={{ transform: `scaleX(${progress / 100})` }} /><Boat className="voyage-mileage-boat" position={progress} /></div><span className="voyage-flag" aria-hidden="true">⚑</span></div><div className="voyage-mileage-caption"><strong>{metrics.context === undefined ? "—" : number(metrics.context)}</strong><span> / {metrics.limit ? number(metrics.limit) : "—"} tok</span></div><p className="voyage-meter-note">已航行 {metrics.context === undefined ? "—" : number(metrics.context)} m · 1 tok = 1 m</p></div>
			{metrics.context !== undefined && <dl className="voyage-breakdown"><div><dt>系统提示词与工具定义</dt><dd>~{number(metrics.overhead ?? 0)}</dd></div><div><dt>对话消息</dt><dd>~{number(metrics.conversation ?? 0)}</dd></div></dl>}
			<div className="voyage-turn"><strong>本次航行记录</strong><dl><div><dt>本轮耗时</dt><dd>{metrics.turn.durationMs === undefined ? "—" : formatDuration(metrics.turn.durationMs)}</dd></div><div><dt>输出 tokens</dt><dd>{metrics.turn.output === undefined ? "—" : number(metrics.turn.output)}</dd></div><div><dt>费用</dt><dd title={costTooltip(metrics.turn.cost)}>{formatCosts(metrics.turn.cost)}</dd></div><div><dt>会话累计</dt><dd title={costTooltip(metrics.sessionCost)}>{formatCosts(metrics.sessionCost)}</dd></div></dl></div>
			<p className="voyage-note">船速按正在输出的文本估算，停泊归零。{metrics.streaming ? "航程在本轮完成后更新。" : ""}</p>
		</> : <>
			<button type="button" className="voyage-rail-toggle collapsed-toggle" onClick={onToggle} aria-label="展开航行台" aria-expanded="false">‹</button>
			<span className="voyage-status-dot" title={metrics.status} />
			<strong className="voyage-collapsed-speed" title={`${metrics.speed.toFixed(1)} tok/s`}>{metrics.speed ? metrics.speed.toFixed(1) : "0"}</strong>
			<small>tok/s</small>
		</>}
	</aside>;
}
