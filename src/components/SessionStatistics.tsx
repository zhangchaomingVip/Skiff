import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { RuntimeOffer } from "../chat/modelFamilies";
import { cacheHitRate, collectStatistics, groupStatistics, heatLevel, kindLabels, rangeStart, readSessionStatistics, showCost, statisticsCalendar, statisticsTargets, statisticsTrend, summarizeStatistics, totalTokens, type GroupBy, type StatisticsProjection, type StatisticsRange, type Totals, type UsageRecord } from "../chat/sessionStatistics";
import { formatTokens } from "../chat/usage";
import type { Conversation, Project } from "../chat/workspace";
import type { WorkspaceMode } from "../workbench/workspaceMode";
import { Icon } from "./Icon";
import { Button, SegmentedControl } from "./ui";
import "./session-statistics.css";

export type SessionStatisticsProps = {
	chats: readonly Conversation[];
	projects: readonly Project[];
	offers: readonly RuntimeOffer[];
	/** The workbench that opened the panel only picks the first scene; switching stays inside the page. */
	workspaceMode?: WorkspaceMode;
};
const number = new Intl.NumberFormat("zh-CN");
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const views = [{ value: "records", label: "记录明细" }, { value: "project", label: "按项目" }, { value: "provider", label: "按提供商" }, { value: "model", label: "按模型" }] as const;
const scenes = [{ value: "code", label: "💻 代码工程" }, { value: "design", label: "🎨 设计生成" }, { value: "all", label: "🌐 全部汇总" }] as const;
const metrics = [{ value: "tokens", label: "Tokens" }, { value: "request", label: "请求" }, { value: "image", label: "图片" }, { value: "video", label: "视频" }] as const;
const dimensions = { project: "项目", provider: "提供商", model: "模型" };
const statuses: Record<string, string> = { error: "失败", aborted: "已停止", length: "达到长度上限", toolUse: "调用工具", stop: "完成" };
const pageSize = 25;
type Metric = typeof metrics[number]["value"];
type Scene = typeof scenes[number]["value"];
const metricUnits: Record<Metric, string> = { tokens: "Tokens", request: "次请求", image: "张图片", video: "个视频" };
const sceneMetrics: Record<Scene, Metric[]> = { code: ["tokens", "request"], design: ["image", "video"], all: metrics.map(({ value }) => value) };
const inScene = (row: UsageRecord, scene: Scene) => scene === "all" || (scene === "design" ? row.kind !== "request" : row.kind === "request");
const costNote = (totals: Totals) => [totals.unpriced ? `${number.format(totals.unpriced)} 次未定价` : "", totals.estimates ? `${number.format(totals.estimates)} 次按现价估算` : ""].filter(Boolean).join(" · ");

export function SessionStatistics({ chats, projects, offers, workspaceMode }: SessionStatisticsProps) {
	const targets = JSON.stringify(statisticsTargets(chats, projects));
	const [snapshot, setSnapshot] = useState<{ data: StatisticsProjection; at: number }>();
	const [error, setError] = useState(false);
	const [loading, setLoading] = useState(true);
	const [revision, setRevision] = useState(0);
	const [range, setRange] = useState<StatisticsRange>("30");
	const [project, setProject] = useState("");
	const [provider, setProvider] = useState("");
	const [view, setView] = useState<typeof views[number]["value"]>("records");
	const [scene, setScene] = useState<Scene>(() => workspaceMode === "design" ? "design" : workspaceMode === "code" ? "code" : "all");
	const [metric, setMetric] = useState<Metric>(() => workspaceMode === "design" ? "image" : "tokens");
	const [page, setPage] = useState(0);
	useEffect(() => {
		let current = true;
		setError(false); setLoading(true);
		void readSessionStatistics(JSON.parse(targets)).then((data) => {
			if (current) setSnapshot({ data, at: Date.now() });
		}, () => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
		return () => { current = false; };
	}, [targets, revision]);
	useEffect(() => { setPage(0); }, [range, project, provider, view, scene]);

	const rows = useMemo(() => snapshot ? collectStatistics(snapshot.data, chats, projects, offers) : [], [snapshot, chats, projects, offers]);
	// Code counts model requests, design counts finished media jobs, and all keeps the full log.
	const sceneRows = useMemo(() => rows.filter((row) => inScene(row, scene)), [rows, scene]);
	const projectsList = useMemo(() => groupStatistics(sceneRows, "project"), [sceneRows]);
	const providersList = useMemo(() => groupStatistics(sceneRows, "provider"), [sceneRows]);
	const chosenProject = projectsList.some((option) => option.key === project) ? project : "";
	const chosenProvider = providersList.some((option) => option.key === provider) ? provider : "";
	const availableMetrics = metrics.filter(({ value }) => sceneMetrics[scene].includes(value));
	const now = snapshot?.at ?? Date.now();
	const start = rangeStart(range, now);
	// The calendar is a fixed year overview, so it only follows the subject filters, not the time range.
	const scoped = useMemo(() => sceneRows.filter((row) => (!chosenProject || row.project.key === chosenProject)
		&& (!chosenProvider || row.provider.key === chosenProvider)), [sceneRows, chosenProject, chosenProvider]);
	const filtered = useMemo(() => scoped.filter((row) => start === undefined || (row.at !== undefined && row.at >= start && row.at <= now)), [scoped, start, now]);
	const totals = useMemo(() => summarizeStatistics(filtered), [filtered]);
	const groups = useMemo(() => view === "records" ? [] : groupStatistics(filtered, view), [filtered, view]);
	const hit = cacheHitRate(totals.tokens);
	const skipped = snapshot ? [snapshot.data.skippedSessions ? `${number.format(snapshot.data.skippedSessions)} 个会话` : "", snapshot.data.skippedMedia ? `${number.format(snapshot.data.skippedMedia)} 条生成记录` : ""].filter(Boolean).join("、") : "";
	const listingCount = view === "records" ? filtered.length : groups.length;
	const pageCount = Math.ceil(listingCount / pageSize);
	const shownPage = Math.min(page, Math.max(0, pageCount - 1));
	const from = shownPage * pageSize;
	const to = Math.min(from + pageSize, listingCount);
	const usageTotal = totalTokens(totals.tokens);
	const hasMediaCost = Object.keys(totals.cost).length > 0;
	const displayCount = (count: number) => snapshot ? number.format(count) : "—";
	const clearFilters = () => { setRange("all"); setProject(""); setProvider(""); };
	const selectScene = (next: Scene) => { setScene(next); setMetric(next === "design" ? "image" : "tokens"); };
	const stats = scene === "design" ? [
		{ label: "生成图片", value: displayCount(totals.image) },
		{ label: "生成视频", value: displayCount(totals.video) },
		hasMediaCost
			? { label: "生成费用", value: showCost(totals.cost) }
			: { label: "生成任务", value: displayCount(totals.image + totals.video) },
	] : [
		{ label: "会话请求", value: displayCount(totals.request) },
		{ label: "消耗 Tokens", value: totals.usageRows ? formatTokens(usageTotal) : "—" },
		{ label: "已知费用", value: showCost(totals.cost) },
		{ label: "缓存命中率", value: hit === undefined ? "—" : percent.format(hit) },
		...(scene === "all" ? [
			{ label: "生成图片", value: displayCount(totals.image) },
			{ label: "生成视频", value: displayCount(totals.video) },
		] : []),
	];
	const emptyState = !rows.length ? "暂无会话或生成记录。"
		: !sceneRows.length ? (scene === "design" ? "还没有图片或视频生成记录。" : "还没有会话请求记录。")
		: "当前筛选没有记录。";

	return <section className="settings-page statistics-page" aria-labelledby="statistics-title" aria-busy={loading}>
		<header className="statistics-header">
			<div className="statistics-heading"><h2 id="statistics-title">会话统计</h2>
				<Button variant="secondary" size="compact" disabled={loading} onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" size={14} />刷新</Button></div>
			<div className="statistics-modes"><SegmentedControl label="统计模式" options={[...scenes]} value={scene} onChange={selectScene} /></div>
		</header>
		<div className="statistics-filters">
			<select aria-label="时间范围" value={range} onChange={(event) => setRange(event.target.value as StatisticsRange)}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="all">全部时间</option></select>
			<select aria-label="项目" value={chosenProject} onChange={(event) => setProject(event.target.value)}><option value="">全部项目</option>{projectsList.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select>
			<select aria-label="提供商" value={chosenProvider} onChange={(event) => setProvider(event.target.value)}><option value="">全部提供商</option>{providersList.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select>
		</div>
		{loading && <p className="statistics-notice" role="status">正在读取本地记录…</p>}
		{error && <p className="statistics-notice" role="alert">无法读取会话统计。{snapshot ? "正在显示上次成功加载的数据。" : ""}请点击刷新重试。</p>}
		<div className="statistics-card">
			<dl className="statistics-kpis" data-count={stats.length} aria-label="统计概览">
				{stats.map((stat) => <Stat key={stat.label} label={stat.label} value={stat.value} />)}
			</dl>
			{snapshot && <Trend rows={filtered} range={range} now={now} metric={metric} options={availableMetrics} onMetric={setMetric} />}
			{snapshot && <CalendarHeatmap rows={scoped} now={now} metric={metric} options={availableMetrics} onMetric={setMetric} />}
			</div>
		<div className="statistics-card statistics-log">
			<div className="statistics-log-heading"><SegmentedControl label="明细维度" options={[...views]} value={view} onChange={setView} /><span className="statistics-caption">{snapshot ? `${number.format(listingCount)} ${view === "records" ? "条记录" : "组"}` : ""}</span></div>
			{snapshot && !listingCount && <div className="statistics-empty"><p>{emptyState}</p>{!!sceneRows.length && <Button variant="ghost" size="compact" onClick={clearFilters}>清除筛选</Button>}</div>}
			{listingCount > 0 && <div className="statistics-scroll" role="region" aria-label="统计明细表格" tabIndex={0}>
				{view === "records"
					? scene === "design" ? <MediaTable rows={filtered.slice(from, to)} /> : <RequestTable rows={filtered.slice(from, to)} scene={scene} />
					: <GroupTable groups={groups.slice(from, to)} by={view} scene={scene} onFilter={view === "project" ? setProject : view === "provider" ? setProvider : undefined} />}
			</div>}
			{pageCount > 1 && <div className="statistics-pager"><span className="statistics-caption">第 {shownPage + 1} / {pageCount} 页 · {number.format(from + 1)}–{number.format(to)}</span><Button size="compact" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>上一页</Button><Button size="compact" disabled={shownPage + 1 >= pageCount} onClick={() => setPage(shownPage + 1)}>下一页</Button></div>}
		</div>
		<p className="statistics-footnote">{(scene === "design"
			? "生成记录只计成功的任务，不含本地导入或失败任务。记录来自本机生成任务，不带 Tokens 或会话费用，也不合并不同币种。"
			: scene === "code"
				? "请求数以日志中保存的模型响应为准，含失败与中止，不等同于上游重试次数。Tokens 含新增输入、输出、缓存读写。费用不含未定价请求，不合并不同币种，也不是账单。"
				: "请求数以日志中保存的模型响应为准，含失败与中止，不等同于上游重试次数。Tokens 含新增输入、输出、缓存读写。费用不含未定价请求，不合并不同币种，也不是账单。生成记录只计成功的任务，不含本地导入或失败任务，也不计 Tokens 或费用。") + (skipped ? `另有 ${skipped}未能读取。` : "")}</p>
	</section>;
}

function Stat({ label, value }: { label: string; value: string }) {
	return <div className="statistics-stat"><dt>{label}</dt><dd>{value}</dd></div>;
}

const dateLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" });
const weekdayLabel = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
const fullDay = (at: number) => `${dateLabel.format(at)} ${weekdayLabel.format(at)}`;
const heatWeekdays = ["周一", "周三", "周五", "周日"];
const heatLevels = [1, 2, 3, 4];

/** Re-render on container resize so a clamped tooltip keeps following the layout. */
function useResizeTick(element: RefObject<HTMLElement | null>) {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const node = element.current;
		if (!node) return;
		const observer = new ResizeObserver(() => setTick((value) => value + 1));
		observer.observe(node);
		return () => observer.disconnect();
	}, [element]);
	return tick;
}

function Trend({ rows, range, now, metric, options, onMetric }: { rows: UsageRecord[]; range: StatisticsRange; now: number; metric: Metric; options: { value: Metric; label: string }[]; onMetric: (metric: Metric) => void }) {
	const { monthly, points } = useMemo(() => statisticsTrend(rows, range, now), [rows, range, now]);
	const values = points.map(({ totals }) => metric === "tokens" ? totalTokens(totals.tokens) : totals[metric]);
	const [hover, setHover] = useState<number>();
	const rootRef = useRef<HTMLDivElement>(null);
	const plotRef = useRef<HTMLDivElement>(null);
	const tipRef = useRef<HTMLDivElement>(null);
	const [tipX, setTipX] = useState(0);
	// Observe the stable root: the plot itself unmounts while a filter has no data.
	const resizeTick = useResizeTick(rootRef);
	const maximum = values.reduce((max, value) => Math.max(max, value), 0);
	const middle = Math.round(maximum / 2);
	const label = metrics.find(({ value }) => value === metric)!.label;
	const scale = (value: number) => metric === "tokens" ? formatTokens(value) : number.format(value);
	const index = Math.min(hover ?? points.length - 1, points.length - 1);
	const describe = (position: number) => `${points[position]?.label ?? ""} · ${number.format(values[position] ?? 0)} ${metricUnits[metric]}`;
	const step = Math.max(1, Math.ceil((points.length - 1) / 5));
	const labels = points.filter((_, position) => position === 0 || position === points.length - 1 || (position % step === 0 && points.length - position > step / 2));
	const barHeight = (position: number) => values[position] ? Math.max(1, (100 * values[position]) / maximum) : 0;
	const tipLeft = Math.min(94, Math.max(6, ((index + 0.5) / points.length) * 100));
	// A keyboard-focused bubble must not push the settings pane into a horizontal scroll.
	useLayoutEffect(() => {
		const plot = plotRef.current, tip = tipRef.current;
		if (!plot || !tip) { setTipX(0); return; }
		const bounds = plot.getBoundingClientRect();
		const width = tip.offsetWidth;
		const natural = bounds.left + (bounds.width * tipLeft) / 100 - width / 2;
		const next = Math.min(Math.max(natural, bounds.left + 2), bounds.right - 2 - width) - natural;
		setTipX((previous) => Math.abs(previous - next) < 0.5 ? previous : next);
	}, [tipLeft, hover, points.length, resizeTick]);
	return <div ref={rootRef} className="statistics-trend">
		<div className="statistics-trend-heading"><h3>{label}趋势 · {monthly ? "按月" : "按天"}</h3><SegmentedControl label="趋势指标" options={[...options]} value={metric} onChange={onMetric} /></div>
		{maximum > 0 ? <div className="statistics-chart"><div className="statistics-scale" aria-hidden="true"><span>{scale(maximum)}</span><span>{middle > 0 && middle !== maximum ? scale(middle) : ""}</span><span>0</span></div>
			<div className="statistics-plot">
				<div ref={plotRef} className="statistics-plot-chart">
					<svg viewBox={`0 0 ${points.length * 10} 100`} preserveAspectRatio="none" role="img" aria-label={`${label}趋势；聚焦后用左右方向键查看每个时段`} tabIndex={0} onPointerLeave={() => setHover(undefined)} onKeyDown={(event) => {
						if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
						event.preventDefault(); setHover(Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
					}}>
						{points.map(({ key }, position) => { const height = barHeight(position); return <g key={key} onPointerEnter={() => setHover(position)} data-active={position === index}>
							<title>{describe(position)}</title><rect className="statistics-chart-hit" x={position * 10} width="10" height="100" /><rect className="statistics-chart-bar" x={position * 10 + 1} y={100 - height} width="8" height={height} rx="1" />
						</g>; })}
					</svg>
					{hover !== undefined && <div ref={tipRef} className="statistics-tooltip" style={{ left: `${tipLeft}%`, top: `calc(${100 - barHeight(index)}% - 6px)`, "--tip-x": `${tipX}px` } as CSSProperties}>{describe(index)}</div>}
				</div>
				<div className="statistics-chart-dates" aria-hidden="true">{labels.map(({ key, label }) => <span key={key}>{label}</span>)}</div>
			</div><p className="statistics-caption statistics-chart-value" aria-live="polite">{describe(index)}</p>
		</div> : <p className="statistics-empty">所选范围内没有可绘制的{label}数据。</p>}
	</div>;
}

function CalendarHeatmap({ rows, now, metric, options, onMetric }: { rows: UsageRecord[]; now: number; metric: Metric; options: { value: Metric; label: string }[]; onMetric: (metric: Metric) => void }) {
	const { days, weeks, maximum } = useMemo(() => statisticsCalendar(rows, now, metric), [rows, now, metric]);
	const [hover, setHover] = useState<number>();
	const [shift, setShift] = useState(0);
	const heatRef = useRef<HTMLDivElement>(null);
	const tipRef = useRef<HTMLDivElement>(null);
	const resizeTick = useResizeTick(heatRef);
	const label = metrics.find(({ value }) => value === metric)!.label;
	const day = hover === undefined ? undefined : days[hover];
	const metricDetail = (totals: Totals) => {
		const primary = metric === "tokens" ? `${formatTokens(totalTokens(totals.tokens))} Tokens`
			: metric === "request" ? `${number.format(totals.request)} 次请求`
			: metric === "image" ? `${number.format(totals.image)} 张图片` : `${number.format(totals.video)} 个视频`;
		const parts = [primary];
		// A media day reads better when the other kind is shown next to the selected one.
		if (metric === "image" && totals.video) parts.push(`${number.format(totals.video)} 个视频`);
		if (metric === "video" && totals.image) parts.push(`${number.format(totals.image)} 张图片`);
		if (metric !== "request" && totals.request) parts.push(`${number.format(totals.request)} 次请求`);
		// Media records carry no price, so only the request metrics surface a cost here.
		if ((metric === "tokens" || metric === "request") && Object.keys(totals.cost).length) parts.push(showCost(totals.cost));
		return parts.join(" · ");
	};
	const monthLabels = useMemo(() => {
		const starts = new Map<number, number>();
		for (const item of days) if (!starts.has(item.week)) starts.set(item.week, item.at);
		const labels: { key: string; column: number; span: number; text: string }[] = [];
		let month = -1;
		for (let week = 0; week < weeks; week++) {
			const at = starts.get(week);
			if (at === undefined) continue;
			const date = new Date(at);
			const index = date.getFullYear() * 12 + date.getMonth();
			if (index === month) continue;
			month = index;
			// Skip a label that would collide with the previous one; its span simply absorbs the month.
			const last = labels[labels.length - 1];
			if (last && week + 2 - last.column < 3) continue;
			labels.push({ key: String(index), column: week + 2, span: 1, text: `${date.getMonth() + 1}月` });
		}
		for (const [index, item] of labels.entries()) item.span = (labels[index + 1]?.column ?? weeks + 2) - item.column;
		return labels;
	}, [days, weeks]);
	// The tooltip is a child of the hovered cell, so it tracks that cell; nudge it back inside the grid at the edges.
	useLayoutEffect(() => {
		const heat = heatRef.current, tip = tipRef.current, cell = tip?.parentElement;
		if (!heat || !tip || !cell) { setShift(0); return; }
		const heatRect = heat.getBoundingClientRect();
		const cellRect = cell.getBoundingClientRect();
		const width = tip.offsetWidth;
		const natural = cellRect.left + cellRect.width / 2 - width / 2;
		const next = Math.min(Math.max(natural, heatRect.left + 2), heatRect.right - 2 - width) - natural;
		setShift((previous) => Math.abs(previous - next) < 0.5 ? previous : next);
	}, [hover, days, resizeTick]);
	return <div className="statistics-trend statistics-calendar">
		<div className="statistics-trend-heading"><h3>{label}活跃日历</h3><SegmentedControl label="日历指标" options={[...options]} value={metric} onChange={onMetric} /></div>
		<div ref={heatRef} className="statistics-heatmap" role="img" aria-label={`${label}每日活跃度日历，最近 53 周；聚焦后用方向键查看每一天`} tabIndex={0} onPointerLeave={() => setHover(undefined)} onKeyDown={(event) => {
			if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
			event.preventDefault();
			const delta = event.key === "ArrowLeft" ? -7 : event.key === "ArrowRight" ? 7 : event.key === "ArrowUp" ? -1 : 1;
			setHover(Math.max(0, Math.min(days.length - 1, (hover ?? days.length - 1) + delta)));
		}} style={{ "--statistics-weeks": weeks } as CSSProperties}>
			{monthLabels.map((item) => <span key={item.key} className="statistics-heatmap-month" style={{ gridColumn: `${item.column} / span ${item.span}` }} aria-hidden="true">{item.text}</span>)}
			{heatWeekdays.map((text, index) => <span key={text} className="statistics-heatmap-weekday" style={{ gridRow: index * 2 + 2 }} aria-hidden="true">{text}</span>)}
			{days.map((item, position) => <div key={item.key} className="statistics-heatmap-cell" style={{ gridColumn: item.week + 2, gridRow: item.weekday + 2 }} data-level={heatLevel(item.value, maximum)} data-active={position === hover} onPointerEnter={() => setHover(position)}>
				{position === hover && <div ref={tipRef} className="statistics-heatmap-tip" style={{ "--tip-shift": `${shift}px` } as CSSProperties}>
					<strong>{fullDay(item.at)}</strong><span>{metricDetail(item.totals)}</span>
				</div>}
			</div>)}
		</div>
		<div className="statistics-heatmap-foot"><p className="statistics-sr-only" aria-live="polite">{day ? `${fullDay(day.at)} · ${metricDetail(day.totals)}` : ""}</p><span className="statistics-heatmap-legend" aria-hidden="true">少{heatLevels.map((level) => <i key={level} data-level={level} />)}多</span></div>
	</div>;
}

function RequestTable({ rows, scene }: { rows: UsageRecord[]; scene: Scene }) {
	return <table className="statistics-table"><caption className="statistics-sr-only">{scene === "all" ? "模型请求和生成记录" : "模型请求记录"}</caption><thead><tr>{[scene === "all" ? "时间 / 类型" : "时间 / 状态", "项目 / 会话", "提供商 / 模型", "新增输入", "输出", "缓存读 / 写", "费用"].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>
		{rows.map((row) => {
			// In the code scene every row is a model request, so the type label only adds noise.
			const detail = row.kind === "request"
				? [scene === "all" ? kindLabels.request : "", row.status ? statuses[row.status] : ""].filter(Boolean).join(" · ")
				: kindLabels[row.kind];
			return <tr key={row.id}><td>{row.at === undefined ? "未知时间" : dateTime.format(row.at)}{detail && <small>{detail}</small>}</td>
				<td>{row.project.label}{row.chatTitle && <small>{row.chatTitle}</small>}</td><td>{row.provider.label}<small>{row.model.label}</small></td>
				<td>{row.tokens ? number.format(row.tokens.input) : "—"}</td><td>{row.tokens ? number.format(row.tokens.output) : "—"}</td><td>{row.tokens ? `${number.format(row.tokens.cacheRead)} / ${number.format(row.tokens.cacheWrite)}` : "—"}</td>
				<td>{row.kind !== "request" ? "—" : row.cost ? showCost(row.cost) : "未定价"}{row.cost && row.estimated && <small>按现价估算</small>}</td></tr>;
		})}
	</tbody></table>;
}

/** Media jobs have no token accounting, so the design scene gets its own columns. */
function MediaTable({ rows }: { rows: UsageRecord[] }) {
	return <table className="statistics-table"><caption className="statistics-sr-only">图片和视频生成记录</caption><thead><tr>{["时间 / 类型", "项目", "服务", "模型", "状态"].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>
		{rows.map((row) => <tr key={row.id}>
			<td>{row.at === undefined ? "未知时间" : dateTime.format(row.at)}<small>{kindLabels[row.kind]}</small></td>
			<td>{row.project.label}</td><td>{row.provider.label}</td><td>{row.model.label}</td><td>已完成</td></tr>)}
	</tbody></table>;
}

const groupColumns: Record<Scene, string[]> = {
	code: ["请求", "Tokens", "缓存命中率", "已知费用"],
	design: ["图片", "视频", "合计"],
	all: ["请求", "Tokens", "缓存命中率", "已知费用", "图片", "视频"],
};

function GroupTable({ groups, by, scene, onFilter }: { groups: ReturnType<typeof groupStatistics>; by: GroupBy; scene: Scene; onFilter?: (key: string) => void }) {
	return <table className="statistics-table"><caption className="statistics-sr-only">按{dimensions[by]}汇总</caption><thead><tr>{[dimensions[by], ...groupColumns[scene]].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>
		{groups.map(({ key, label, totals }) => { const hit = cacheHitRate(totals.tokens); return <tr key={key}>
			<th scope="row">{onFilter ? <Button className="statistics-group-link" variant="ghost" size="compact" aria-label={`筛选${dimensions[by]}：${label}`} onClick={() => onFilter(key)}>{label}</Button> : label}</th>
			{scene !== "design" && <>
				<td>{number.format(totals.request)}</td><td>{totals.usageRows ? number.format(totalTokens(totals.tokens)) : "—"}</td><td>{hit === undefined ? "—" : percent.format(hit)}</td><td>{showCost(totals.cost)}{costNote(totals) && <small>{costNote(totals)}</small>}</td>
			</>}
			{scene !== "code" && <>
				<td>{number.format(totals.image)}</td><td>{number.format(totals.video)}</td>{scene === "design" && <td>{number.format(totals.image + totals.video)}</td>}
			</>}
		</tr>; })}
	</tbody></table>;
}
