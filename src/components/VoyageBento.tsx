import { useId, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { gaugePosition } from "../chat/sailing";
import { formatTokens } from "../chat/usage";
import { costTooltip, formatCosts } from "../chat/cost";
import { formatLatency, smoothTokenPath } from "../chat/voyageBento";

const tokens = (value?: number) => value === undefined ? "—" : formatTokens(Math.round(value));

function WeatherCard({ name, icon, label, value, unit, summary, hint, tone = "", children }: {
	name: string; icon: IconName; label: string; value: string; unit?: string; summary: string; hint: string; tone?: string; children: ReactNode;
}) {
	const tooltip = useId();
	return <section className={`voyage-weather-card voyage-weather-${name} ${tone}`} aria-label={label} aria-describedby={tooltip} tabIndex={0}>
		<h2><Icon name={icon} size={12} /><span>{label}</span></h2>
		<div className="voyage-weather-reading"><strong>{value}</strong>{unit && <small>{unit}</small>}</div>
		<div className="voyage-weather-viz" aria-hidden="true">{children}</div>
		<p className="voyage-weather-summary">{summary.split(" · ").map((part, index) => <span key={index}>{index > 0 ? " · " : ""}{part}</span>)}</p>
		<span id={tooltip} className="voyage-weather-tooltip" role="tooltip">{hint}</span>
	</section>;
}

export function VoyageBento({ metrics }: { metrics: VoyageMetrics }) {
	const gradient = useId();
	const speed = metrics.streaming ? metrics.speed : metrics.averageSpeed;
	const position = gaugePosition(speed ?? 0);
	const speedHint = `${metrics.streaming ? "实时航速（按可见文字估算）" : `本轮平均解码速度${metrics.averageEstimated ? "（估算）" : ""}`}；峰值 ${metrics.peakSpeed === undefined ? "—" : `${metrics.peakSpeed.toFixed(1)} tok/s`}；刻度 0–300 tok/s`;
	const speedSummary = metrics.streaming && metrics.ttftMs === undefined ? "等待模型首字响应..." : metrics.ttftMs === undefined ? "首字与解码耗时暂无记录" : `首字 ${formatLatency(metrics.ttftMs)} · 纯吐字 ${formatLatency(metrics.decodeMs)}`;
	const shape = smoothTokenPath(metrics.tokenTrail ?? []);
	const { turn } = metrics;
	const newTokens = turn.newInput === undefined && turn.output === undefined && turn.total === undefined ? undefined : (turn.newInput ?? 0) + Math.max(0, (turn.output ?? (metrics.streaming ? (turn.total ?? 0) - (turn.input ?? 0) : 0)) - (turn.reasoning ?? 0));
	const tokenHint = `会话累计 ${tokens(metrics.sessionTokens)} Token；本轮预估费用 ${formatCosts(turn.cost, 6)}；会话预估费用 ${formatCosts(metrics.sessionCost, 6)}；${costTooltip(turn.cost)}${metrics.streaming ? "；生成中用量为估算，完成后以实际用量校准" : ""}；新增含非缓存输入与回答，不重复计入思考`;
	const contextKnown = metrics.context !== undefined && metrics.limit !== undefined;
	const contextRatio = Math.max(0, Math.min(1, metrics.ratio));
	const contextWarning = contextKnown && metrics.ratio > .8;
	const contextSummary = !contextKnown ? "等待上下文用量数据" : contextWarning ? `已消耗 ${(metrics.ratio * 100).toFixed(0)}% · 建议开启新话题` : `${tokens(metrics.context)} / ${tokens(metrics.limit)} · ${metrics.ratio < .5 ? "空间极其充裕" : "空间充裕"}`;
	const hit = turn.input !== undefined && turn.input > 0 && turn.hitRate !== undefined ? Math.max(0, Math.min(1, turn.hitRate)) : undefined;
	const cacheSummary = hit === undefined ? "等待本轮缓存数据" : hit === 0 ? "本次全量传输 · 未命中缓存" : `${metrics.cacheSavings === undefined ? "已复用上下文" : `节省约 ${Math.round(metrics.cacheSavings * 100)}% 费用`} · 复用 ${tokens(turn.cacheRead)}`;
	return <div className="voyage-weather-grid" role="group" aria-label="航行数据看板">
		<WeatherCard name="speed" icon="gauge" label="输出航速" value={speed === undefined ? "—" : speed.toFixed(1)} unit="tok/s" summary={speedSummary} hint={speedHint}>
			<svg className="voyage-weather-gauge" viewBox="0 -20 112 56">
				<path className="voyage-weather-arc" d="M10 31 A46 46 0 0 1 102 31" pathLength="100" />
				<g className="voyage-weather-ticks">{Array.from({ length: 13 }, (_, index) => <line key={index} x1="56" y1="-15" x2="56" y2={index % 3 === 0 ? "-10" : "-12"} transform={`rotate(${-90 + index * 15} 56 31)`} />)}</g>
				<g className="voyage-weather-needle" style={{ transform: `rotate(${-90 + position * 180}deg)` }}><path d="M56 31 L56 -6" /><circle cx="56" cy="-6" r="2.5" /></g>
				<circle className="voyage-weather-hub" cx="56" cy="31" r="3" />
			</svg>
		</WeatherCard>
		<WeatherCard name="tokens" icon="tokens" label="本轮消耗" value={tokens(turn.total)} summary={`思考 ${tokens(turn.reasoning)} · 新增 ${tokens(newTokens)}`} hint={tokenHint}>
			<svg className="voyage-weather-spark" viewBox="0 0 100 32" preserveAspectRatio="none">
				<defs><linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="32"><stop offset="0" stopColor="var(--voyage-sky)" stopOpacity=".25" /><stop offset="1" stopColor="var(--voyage-sky)" stopOpacity="0" /></linearGradient></defs>
				{shape.area && <path className="voyage-weather-spark-area" d={shape.area} fill={`url(#${gradient})`} />}
				{shape.line ? <path className="voyage-weather-spark-line" d={shape.line} vectorEffect="non-scaling-stroke" /> : <path className="voyage-weather-spark-empty" d="M0 29 H100" vectorEffect="non-scaling-stroke" />}
			</svg>
		</WeatherCard>
		<WeatherCard name="context" icon="layers" label="上下文容量" value={contextKnown ? `${(metrics.ratio * 100).toFixed(1)}%` : "—"} summary={contextSummary} tone={contextWarning ? "is-warning" : ""} hint={`${metrics.contextEstimated ? "估算" : "实测"}上下文 ${tokens(metrics.context)} / ${tokens(metrics.limit)} Token；超过 80% 时建议开启新话题`}>
			<div className={`voyage-weather-context-bar${contextKnown ? "" : " is-unknown"}`}><i style={{ "--context-position": `${contextRatio * 100}%` } as CSSProperties} /></div>
		</WeatherCard>
		<WeatherCard name="cache" icon="refresh" label="缓存命中" value={hit === undefined ? "—" : `${(hit * 100).toFixed(1)}%`} summary={cacheSummary} tone={hit === undefined || hit === 0 ? "is-quiet" : hit > .7 ? "is-saving" : ""} hint={`缓存读取 ${tokens(turn.cacheRead)} / 输入 ${tokens(turn.input)} Token；${metrics.cacheSavings === undefined ? "暂无可用缓存折扣定价，费用节省未估算" : "节省比例按本轮费用与缓存读取按原价计费的费用对比计算"}`}>
			<div className="voyage-weather-cache-bar"><i style={{ width: `${(hit ?? 0) * 100}%` }} /></div>
		</WeatherCard>
	</div>;
}
