import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";
import { IconButton, Popover } from "./ui";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { gaugePosition } from "../chat/sailing";
import { formatDuration, formatTokens } from "../chat/usage";
import { costTooltip, formatCosts } from "../chat/cost";
import { formatLatency, turnInputPath } from "../chat/voyageBento";

const tokens = (value?: number) => value === undefined ? "—" : formatTokens(Math.round(value));
const exact = (value?: number) => value === undefined ? "—" : Math.round(value).toLocaleString("zh-CN");
const elapsed = (value?: number) => value === undefined ? "—" : formatDuration(value);
const rate = (value?: number) => value === undefined ? "—" : `${value.toFixed(1)} tok/s`;

function Ledger({ rows }: { rows: [string, ReactNode][] }) {
	return <dl className="voyage-telemetry-ledger">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function WeatherRing({ value, cache = false }: { value?: number; cache?: boolean }) {
	const gradient = useId();
	const progress = value !== undefined && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) * 100 : undefined;
	return <svg className={`voyage-weather-ring${progress === undefined ? " is-unknown" : ""}`} viewBox="0 0 32 32" width="32" height="32">
		{cache && <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="var(--voyage-cache-reading)" /><stop offset="1" stopColor="var(--voyage-mint)" /></linearGradient></defs>}
		<circle className="voyage-weather-ring-track" cx="16" cy="16" r="12" />
		{progress !== undefined && progress > 0 && <circle className="voyage-weather-ring-active" cx="16" cy="16" r="12" pathLength="100" stroke={cache ? `url(#${gradient})` : "currentColor"} strokeLinecap="round" strokeDasharray={`${progress} 100`} transform="rotate(-90 16 16)" />}
	</svg>;
}

function TokenTrend({ values }: { values: (number | undefined)[] }) {
	const gradient = useId();
	const shape = turnInputPath(values);
	return <svg className="voyage-weather-spark" viewBox="0 0 100 32" preserveAspectRatio="none">
		<defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--voyage-sky)" stopOpacity=".25" /><stop offset="1" stopColor="var(--voyage-sky)" stopOpacity="0" /></linearGradient></defs>
		{shape.area && <path className="voyage-weather-spark-area" d={shape.area} fill={`url(#${gradient})`} />}
		{shape.line ? <path className="voyage-weather-spark-line" d={shape.line} vectorEffect="non-scaling-stroke" /> : <path className="voyage-weather-spark-empty" d={`M4 ${values.length === 1 && shape.points.length ? 16 : 29} H96`} vectorEffect="non-scaling-stroke" />}
		{shape.markers.map((point) => <circle key={point.turn} className="voyage-weather-spark-point" cx={point.x} cy={point.y} r="1.8" />)}
	</svg>;
}

function WeatherCard({ name, icon, label, value, unit, summary, tone = "", children, details, detailTitle }: {
	name: string; icon: IconName; label: string; value: string; unit?: string; summary: [string, string]; tone?: string; children: ReactNode; details: ReactNode; detailTitle: string;
}) {
	const panelId = useId();
	const anchor = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const close = () => setOpen(false);
	return <section className={`voyage-weather-card voyage-weather-${name} ${tone}${open ? " is-open" : ""}`} aria-label={label}>
		<h2><Icon name={icon} size={12} /><span>{label}</span></h2>
		<div className="voyage-weather-reading"><strong>{value}</strong>{unit && <small>{unit}</small>}</div>
		<div className="voyage-weather-viz" aria-hidden="true">{children}</div>
		<p className="voyage-weather-summary">{summary.map((part, index) => <span key={index}>{part}</span>)}</p>
		<button ref={anchor} type="button" className="voyage-weather-trigger" aria-label={`${label}明细`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}><span className="sr-only">查看{label}明细</span></button>
		{open && createPortal(<Popover anchor={anchor} onClose={close} id={panelId} className="voyage-telemetry-popover" aria-label={detailTitle}>
			<header className="voyage-telemetry-head"><h3>{detailTitle}</h3><IconButton size="compact" variant="ghost" aria-label="关闭指标明细" onClick={close}><Icon name="close" size={14} /></IconButton></header>
			{details}
		</Popover>, anchor.current?.closest("dialog") ?? document.body)}
	</section>;
}

export function VoyageBento({ metrics }: { metrics: VoyageMetrics }) {
	const { turn, telemetry } = metrics;
	const process = telemetry.turn;
	const usage = telemetry.usage;
	const { total, input: totalInput, output, reasoning, cacheRead, cacheWrite, newInput: fresh, cost } = turn;
	const savings = metrics.cacheSavings;
	const hit = totalInput !== undefined && totalInput > 0 && cacheRead !== undefined ? Math.max(0, Math.min(1, cacheRead / totalInput)) : undefined;
	const speed = metrics.streaming ? metrics.speed : metrics.averageSpeed;
	const position = gaugePosition(speed ?? 0);
	const avgTtft = telemetry.session.avgTtftMs;
	const speedSummary: [string, string] = [`首字 ${formatLatency(metrics.ttftMs)}`, `速率峰值 ${metrics.peakSpeed === undefined ? "—" : `${Math.round(metrics.peakSpeed)} tok/s`}`];
	const tokenSummary: [string, string] = [`输入 ${tokens(totalInput)} tok`, `输出 ${tokens(output)} tok`];
	const previousInput = telemetry.inputTrend[telemetry.inputTrend.length - 2];
	const currentInput = telemetry.inputTrend[telemetry.inputTrend.length - 1];
	const inputDelta = currentInput !== undefined && previousInput !== undefined ? currentInput - previousInput : undefined;
	const contextKnown = metrics.context !== undefined && metrics.limit !== undefined;
	const contextWarning = contextKnown && metrics.ratio > .8;
	const composition = telemetry.composition;
	const contextSummary: [string, string] = [`当前占用 ${tokens(metrics.context)} tok`, `窗口上限 ${tokens(metrics.limit)} tok`];
	const cacheSummary: [string, string] = [`缓存创建 ${tokens(cacheWrite)} tok`, `缓存读取 ${tokens(cacheRead)} tok`];
	const modelMs = metrics.timeline ? Math.max(0, metrics.timeline.durationMs - metrics.timeline.toolMs) : undefined;
	const toolMs = metrics.timeline?.toolMs;
	const durationMs = metrics.timeline?.durationMs;
	const timingShare = (ms?: number) => ms === undefined || !durationMs ? "—" : `${Math.round(ms / durationMs * 100)}%`;
	const compositionValue = (value?: number) => value === undefined ? "—" : `~${exact(value)} tok`;
	return <div className="voyage-telemetry">
		<div className="voyage-weather-grid" role="group" aria-label="航行数据看板">
			<WeatherCard name="speed" icon="gauge" label="推理速率" value={speed === undefined ? "—" : speed.toFixed(1)} unit="tok/s" summary={speedSummary} detailTitle="本轮耗时剖析" details={<>
				<Ledger rows={[["模型用时（思考 + 吐字）", elapsed(modelMs)], ["工具调用用时", elapsed(toolMs)], ["本轮首字", formatLatency(metrics.ttftMs)], ["已记录轮次首字均值", formatLatency(avgTtft)], ["本轮输出速度", rate(metrics.averageSpeed)], ["会话加权输出速度", rate(telemetry.session.averageSpeed)], ["本轮速率峰值", rate(metrics.peakSpeed)]]} />
				<p className="voyage-telemetry-note">速度仅计可见回答，排除思考与工具耗时；{metrics.averageEstimated || metrics.streaming ? "当前为估算。" : "已按用量校准。"}首字均值覆盖 {telemetry.session.latencyTurns} 轮；会话速度按 {telemetry.session.speedTurns} 轮解码时间加权。未记录项显示 —。</p>
			</>}>
				<svg className="voyage-weather-gauge" viewBox="0 -20 112 56">
					<path className="voyage-weather-arc" d="M10 31 A46 46 0 0 1 102 31" pathLength="100" />
					<g className="voyage-weather-ticks">{Array.from({ length: 13 }, (_, index) => <line key={index} x1="56" y1="-15" x2="56" y2={index % 3 === 0 ? "-10" : "-12"} transform={`rotate(${-90 + index * 15} 56 31)`} />)}</g>
					<g className="voyage-weather-needle" style={{ transform: `rotate(${-90 + position * 180}deg)` }}><path d="M56 31 L56 -6" /><circle cx="56" cy="-6" r="2.5" /></g>
					<circle className="voyage-weather-hub" cx="56" cy="31" r="3" />
				</svg>
			</WeatherCard>
			<WeatherCard name="tokens" icon="tokens" label="Token 用量" value={tokens(total)} unit="tok" summary={tokenSummary} detailTitle="本轮进程与用量" details={<>
				<Ledger rows={[["对话轮数 / Agent 步数", `${process.turns} / ${process.steps}`], ["用量已上报 / 总步数", `${process.reportedSteps} / ${process.steps}`], ["工具调用总数", exact(process.calls)], ["成功 / 失败 / 未完成", `${process.succeeded} / ${process.failed} / ${process.unresolved}`], ["本轮运行耗时", elapsed(process.durationMs)], ["非缓存输入（含写入）", exact(fresh)], ["本轮较上轮新增输入", inputDelta === undefined ? "—" : `${inputDelta > 0 ? "+" : ""}${exact(inputDelta)} tok`], ["缓存读取", exact(cacheRead)], ["输出（含思考）", exact(output)], ["其中思考", exact(reasoning)], ["Token 合计", exact(total)]]} />
				<div className="voyage-telemetry-subhead">本轮时间分配</div><div className="voyage-telemetry-timebar" aria-hidden="true"><i style={{ width: timingShare(modelMs) === "—" ? "0%" : timingShare(modelMs) }} /><i style={{ width: timingShare(toolMs) === "—" ? "0%" : timingShare(toolMs) }} /></div>
				<Ledger rows={[["模型 / 工具", `${timingShare(modelMs)} / ${timingShare(toolMs)}`]]} />
				<div className="voyage-telemetry-subhead">会话累计</div>
				<Ledger rows={[["对话轮数 / Agent 步数", `${telemetry.session.turns} / ${telemetry.session.steps}`], ["累计运行耗时", elapsed(telemetry.session.durationMs)], ["非缓存输入（含写入）", exact(telemetry.usageKnown ? usage.input + usage.cacheWrite : undefined)], ["输出（含思考）", exact(metrics.sessionTokens === undefined ? undefined : usage.output)], ["Token 合计", exact(metrics.sessionTokens)]]} />
				<p className="voyage-telemetry-note">走势为第 1 轮至当前轮的非缓存输入（含写入），按已上报请求累加；缺失轮次处断开，单轮显示光点。合计另含缓存读取与输出（含思考）。步数仅计可见请求；耗时覆盖 {process.timedTurns} 轮，排除空闲。{metrics.streaming ? "生成中用量为估算，结束后校准。" : process.reportedSteps < process.steps ? "用量仅含已上报请求。" : ""}</p>
			</>}>
				<TokenTrend values={telemetry.inputTrend} />
			</WeatherCard>
			<WeatherCard name="context" icon="layers" label="上下文窗口" value={contextKnown ? `${(metrics.ratio * 100).toFixed(1)}%` : "—"} summary={contextSummary} tone={contextWarning ? "is-warning" : ""} detailTitle="上下文构成估算" details={<>
				<Ledger rows={[["当前上下文 / 窗口", `${exact(metrics.context)} / ${exact(metrics.limit)}`], ["系统提示词", "未独立上报"], ["工具定义", "未独立上报"], ["系统、工具定义等开销", compositionValue(composition?.overhead)], ["对话文本（含思考）", compositionValue(composition?.conversation)], ["工具调用与结果", compositionValue(composition?.toolResults)]]} />
				<p className="voyage-telemetry-note">来源：{metrics.contextSource === "pi" ? "pi 上下文快照" : metrics.contextSource === "last-request" ? "最近模型请求" : metrics.contextSource === "local-estimate" ? "本地文本估算" : "暂无数据"}。构成按可见文本估算，其余计入系统、工具定义等开销。{composition?.scaled ? "压缩后按当前总量等比缩放。" : "图片等非文本内容可能计入开销。"}{contextWarning ? "已超过 80%，建议开启新话题。" : ""}</p>
			</>}>
				<WeatherRing value={contextKnown ? metrics.ratio : undefined} />
			</WeatherCard>
			<WeatherCard name="cache" icon="refresh" label="缓存" value={hit === undefined ? "—" : `${(hit * 100).toFixed(1)}%`} unit="命中" summary={cacheSummary} tone={hit === undefined || hit === 0 ? "is-quiet" : hit > .7 ? "is-saving" : ""} detailTitle="本轮缓存账单" details={<>
				<Ledger rows={[["输入总量（含缓存）", exact(totalInput)], ["缓存读取 / 复用", exact(cacheRead)], ["缓存创建", exact(cacheWrite)], ["非缓存输入（含写入）", exact(fresh)], ["缓存命中率", hit === undefined ? "—" : `${(hit * 100).toFixed(2)}%`], ["预估费用", formatCosts(cost, 6)], ["费用节省", savings === undefined ? "—" : `${(savings * 100).toFixed(2)}%`], ["会话累计费用", formatCosts(metrics.sessionCost, 6)]]} />
				<div className="voyage-telemetry-subhead">会话缓存</div>
				<Ledger rows={[["累计缓存读取", exact(telemetry.usageKnown ? usage.cacheRead : undefined)], ["累计命中率", telemetry.usageKnown && usage.inputTotal > 0 ? `${(usage.hitRate * 100).toFixed(2)}%` : "—"], ["累计费用节省", telemetry.sessionCacheSavings === undefined ? "—" : `${(telemetry.sessionCacheSavings * 100).toFixed(2)}%`]]} />
				<p className="voyage-telemetry-note">{costTooltip(cost)}。命中率 = 缓存读取 / 输入总量。节省对比缓存按原价计费的完整账单，含输出。{savings === undefined ? "定价不全、生成中或多币种时不估算节省。" : ""}</p>
			</>}>
				<WeatherRing value={hit} cache />
			</WeatherCard>
		</div>
	</div>;
}
