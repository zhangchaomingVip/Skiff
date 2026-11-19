import { useEffect, useMemo, useState } from "react";
import type { RuntimeOffer } from "../chat/modelFamilies";
import { cacheHitRate, collectStatistics, groupStatistics, kindLabels, rangeStart, readSessionStatistics, showCost, statisticsTargets, statisticsTrend, summarizeStatistics, totalTokens, type GroupBy, type RecordKind, type StatisticsProjection, type StatisticsRange, type Totals, type UsageRecord } from "../chat/sessionStatistics";
import { formatTokens } from "../chat/usage";
import type { Conversation, Project } from "../chat/workspace";
import { Icon } from "./Icon";
import { Button, SegmentedControl } from "./ui";
import "./session-statistics.css";

export type SessionStatisticsProps = { chats: readonly Conversation[]; projects: readonly Project[]; offers: readonly RuntimeOffer[]; };
const number = new Intl.NumberFormat("zh-CN");
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const views = [{ value: "records", label: "记录明细" }, { value: "project", label: "按项目" }, { value: "provider", label: "按提供商" }, { value: "model", label: "按模型" }] as const;
const metrics = [{ value: "tokens", label: "Tokens" }, { value: "request", label: "请求" }, { value: "image", label: "图片" }, { value: "video", label: "视频" }] as const;
const dimensions = { project: "项目", provider: "提供商", model: "模型" };
const statuses: Record<string, string> = { error: "失败", aborted: "已停止", length: "达到长度上限", toolUse: "调用工具", stop: "完成" };
const pageSize = 25;
type Metric = typeof metrics[number]["value"];
const costNote = (totals: Totals) => [totals.unpriced ? `${number.format(totals.unpriced)} 次未定价` : "", totals.estimates ? `${number.format(totals.estimates)} 次按现价估算` : ""].filter(Boolean).join(" · ");

export function SessionStatistics({ chats, projects, offers }: SessionStatisticsProps) {
	const targets = JSON.stringify(statisticsTargets(chats, projects));
	const [snapshot, setSnapshot] = useState<{ data: StatisticsProjection; at: number }>();
	const [error, setError] = useState(false);
	const [loading, setLoading] = useState(true);
	const [revision, setRevision] = useState(0);
	const [range, setRange] = useState<StatisticsRange>("30");
	const [project, setProject] = useState("");
	const [provider, setProvider] = useState("");
	const [kind, setKind] = useState<RecordKind | "">("");
	const [view, setView] = useState<typeof views[number]["value"]>("records");
	const [metric, setMetric] = useState<Metric>("tokens");
	const [page, setPage] = useState(0);
	useEffect(() => {
		let current = true;
		setError(false); setLoading(true);
		void readSessionStatistics(JSON.parse(targets)).then((data) => {
			if (current) setSnapshot({ data, at: Date.now() });
		}, () => { if (current) setError(true); }).finally(() => { if (current) setLoading(false); });
		return () => { current = false; };
	}, [targets, revision]);
	useEffect(() => { setPage(0); }, [range, project, provider, kind, view]);

	const rows = useMemo(() => snapshot ? collectStatistics(snapshot.data, chats, projects, offers) : [], [snapshot, chats, projects, offers]);
	const projectsList = useMemo(() => groupStatistics(rows, "project"), [rows]);
	const providersList = useMemo(() => groupStatistics(rows, "provider"), [rows]);
	const chosenProject = projectsList.some((option) => option.key === project) ? project : "";
	const chosenProvider = providersList.some((option) => option.key === provider) ? provider : "";
	const now = snapshot?.at ?? Date.now();
	const start = rangeStart(range, now);
	const filtered = useMemo(() => rows.filter((row) => (start === undefined || (row.at !== undefined && row.at >= start && row.at <= now))
		&& (!chosenProject || row.project.key === chosenProject) && (!chosenProvider || row.provider.key === chosenProvider) && (!kind || row.kind === kind)), [rows, start, now, chosenProject, chosenProvider, kind]);
	const totals = useMemo(() => summarizeStatistics(filtered), [filtered]);
	const groups = useMemo(() => view === "records" ? [] : groupStatistics(filtered, view), [filtered, view]);
	const hit = cacheHitRate(totals.tokens);
	const incomplete = snapshot && (snapshot.data.skippedSessions > 0 || snapshot.data.skippedMedia > 0);
	const listingCount = view === "records" ? filtered.length : groups.length;
	const pageCount = Math.ceil(listingCount / pageSize);
	const shownPage = Math.min(page, Math.max(0, pageCount - 1));
	const from = shownPage * pageSize;
	const to = Math.min(from + pageSize, listingCount);
	const displayCount = (count: number) => snapshot ? number.format(count) : "—";
	const clearFilters = () => { setRange("all"); setProject(""); setProvider(""); setKind(""); };
	const onKind = (next: RecordKind | "") => { setKind(next); setMetric(next === "image" || next === "video" ? next : "tokens"); };

	return <section className="settings-page statistics-page" aria-labelledby="statistics-title" aria-busy={loading}>
		<div className="statistics-heading"><div><h2 id="statistics-title">会话统计</h2><p>查看本机工作区的模型用量和生成记录，包含已归档会话。</p></div>
			<Button variant="secondary" size="compact" disabled={loading} onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" size={14} />刷新</Button></div>
		<div className="statistics-filters">
			<label>时间范围<select aria-label="时间范围" value={range} onChange={(event) => setRange(event.target.value as StatisticsRange)}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="all">全部时间</option></select></label>
			<label>项目<select aria-label="项目" value={chosenProject} onChange={(event) => setProject(event.target.value)}><option value="">全部项目</option>{projectsList.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label>
			<label>提供商<select aria-label="提供商" value={chosenProvider} onChange={(event) => setProvider(event.target.value)}><option value="">全部提供商</option>{providersList.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}</select></label>
			<label>类型<select aria-label="类型" value={kind} onChange={(event) => onKind(event.target.value as RecordKind | "")}><option value="">全部类型</option>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
		</div>
		{loading && <p className="statistics-notice" role="status">正在读取本地记录…</p>}
		{error && <p className="statistics-notice" role="alert">无法读取会话统计。{snapshot ? "正在显示上次成功加载的数据。" : ""}请点击刷新重试。</p>}
		{incomplete && <p className="statistics-notice" role="status">部分记录未能读取：{snapshot.data.skippedSessions} 个会话、{snapshot.data.skippedMedia} 条生成记录。下方仅显示已读取的数据。</p>}
		<div className="statistics-card">
			<dl className="statistics-kpis" aria-label="统计概览">
				<Stat label="会话请求" value={displayCount(totals.request)} detail="本地会话日志" />
				<Stat label="消耗 Tokens" value={totals.usageRows ? formatTokens(totalTokens(totals.tokens)) : "—"} detail={totals.usageRows ? `${number.format(totalTokens(totals.tokens))} Tokens` : "无用量数据"} />
				<Stat label="缓存命中率" value={hit === undefined ? "—" : percent.format(hit)} detail="缓存读取 ÷ 总输入" />
				<Stat label="已知费用" value={showCost(totals.cost)} detail={costNote(totals) || "按模型单价计算"} />
				<Stat label="生成图片" value={displayCount(totals.image)} detail="已完成 · 张" />
				<Stat label="生成视频" value={displayCount(totals.video)} detail="已完成 · 个" />
			</dl>
			{snapshot && <Trend rows={filtered} range={range} now={now} metric={metric} onMetric={setMetric} />}
		</div>
		<div className="statistics-card statistics-log">
			<div className="statistics-log-heading"><SegmentedControl label="明细维度" options={[...views]} value={view} onChange={setView} /><span className="statistics-caption">{snapshot ? `${number.format(listingCount)} ${view === "records" ? "条记录" : "组"}` : ""}</span></div>
			{snapshot && !listingCount && <div className="statistics-empty"><p>{rows.length ? "当前筛选没有记录。" : "暂无会话或生成记录。"}</p>{!!rows.length && <Button variant="ghost" size="compact" onClick={clearFilters}>清除筛选</Button>}</div>}
			{listingCount > 0 && <div className="statistics-scroll" role="region" aria-label="统计明细表格" tabIndex={0}>
				{view === "records" ? <RequestTable rows={filtered.slice(from, to)} /> : <GroupTable groups={groups.slice(from, to)} by={view} onFilter={view === "project" ? setProject : view === "provider" ? setProvider : undefined} />}
			</div>}
			{pageCount > 1 && <div className="statistics-pager"><span className="statistics-caption">第 {shownPage + 1} / {pageCount} 页 · {number.format(from + 1)}–{number.format(to)}</span><Button size="compact" disabled={shownPage === 0} onClick={() => setPage(shownPage - 1)}>上一页</Button><Button size="compact" disabled={shownPage + 1 >= pageCount} onClick={() => setPage(shownPage + 1)}>下一页</Button></div>}
		</div>
		<p className="statistics-footnote">请求数以日志中保存的模型响应为准，含失败与中止，不等同于上游重试次数。Tokens 含新增输入、输出、缓存读写。费用不含未定价请求，不合并不同币种，也不是账单。生成记录只计成功的任务，不含本地导入或失败任务，也不计 Tokens 或费用。</p>
	</section>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
	return <div className="statistics-stat"><dt>{label}</dt><dd>{value}</dd><small>{detail}</small></div>;
}

function Trend({ rows, range, now, metric, onMetric }: { rows: UsageRecord[]; range: StatisticsRange; now: number; metric: Metric; onMetric: (metric: Metric) => void }) {
	const { monthly, points } = useMemo(() => statisticsTrend(rows, range, now), [rows, range, now]);
	const values = points.map(({ totals }) => metric === "tokens" ? totalTokens(totals.tokens) : totals[metric]);
	const [hover, setHover] = useState<number>();
	const maximum = values.reduce((max, value) => Math.max(max, value), 0);
	const label = metrics.find(({ value }) => value === metric)!.label;
	const index = Math.min(hover ?? points.length - 1, points.length - 1);
	const describe = (position: number) => `${points[position]?.label ?? ""} · ${number.format(values[position] ?? 0)} ${label}`;
	const step = Math.max(1, Math.ceil((points.length - 1) / 5));
	const labels = points.filter((_, position) => position === 0 || position === points.length - 1 || (position % step === 0 && points.length - position > step / 2));
	return <div className="statistics-trend">
		<div className="statistics-trend-heading"><h3>{label}趋势 · {monthly ? "按月" : "按天"}</h3><SegmentedControl label="趋势指标" options={[...metrics]} value={metric} onChange={onMetric} /></div>
		{maximum > 0 ? <div className="statistics-chart"><div className="statistics-scale" aria-hidden="true"><span>{formatTokens(maximum)}</span><span>{formatTokens(Math.round(maximum / 2))}</span><span>0</span></div>
			<div className="statistics-plot">
				<svg viewBox={`0 0 ${points.length * 10} 100`} preserveAspectRatio="none" role="img" aria-label={`${label}趋势；聚焦后用左右方向键查看每个时段`} tabIndex={0} onPointerLeave={() => setHover(undefined)} onKeyDown={(event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault(); setHover(Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))));
				}}>
					{points.map(({ key }, position) => { const height = values[position] ? Math.max(1, 100 * values[position] / maximum) : 0; return <g key={key} onPointerEnter={() => setHover(position)} data-active={position === index}>
						<title>{describe(position)}</title><rect className="statistics-chart-hit" x={position * 10} width="10" height="100" /><rect className="statistics-chart-bar" x={position * 10 + 1} y={100 - height} width="8" height={height} rx="1" />
					</g>; })}
				</svg>
				<div className="statistics-chart-dates" aria-hidden="true">{labels.map(({ key, label }) => <span key={key}>{label}</span>)}</div>
			</div><p className="statistics-caption statistics-chart-value" aria-live="polite">{describe(index)}</p>
		</div> : <p className="statistics-empty">所选范围内没有可绘制的{label}数据。</p>}
	</div>;
}

function RequestTable({ rows }: { rows: UsageRecord[] }) {
	return <table className="statistics-table"><caption className="statistics-sr-only">模型请求和生成记录</caption><thead><tr>{["时间 / 类型", "项目 / 会话", "提供商 / 模型", "新增输入", "输出", "缓存读 / 写", "费用"].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>
		{rows.map((row) => <tr key={row.id}><td>{row.at === undefined ? "未知时间" : dateTime.format(row.at)}<small>{kindLabels[row.kind]}{row.kind === "request" && row.status && statuses[row.status] ? ` · ${statuses[row.status]}` : ""}</small></td>
			<td>{row.project.label}{row.chatTitle && <small>{row.chatTitle}</small>}</td><td>{row.provider.label}<small>{row.model.label}</small></td>
			<td>{row.tokens ? number.format(row.tokens.input) : "—"}</td><td>{row.tokens ? number.format(row.tokens.output) : "—"}</td><td>{row.tokens ? `${number.format(row.tokens.cacheRead)} / ${number.format(row.tokens.cacheWrite)}` : "—"}</td>
			<td>{row.kind !== "request" ? "—" : row.cost ? showCost(row.cost) : "未定价"}{row.cost && row.estimated && <small>按现价估算</small>}</td></tr>)}
	</tbody></table>;
}

function GroupTable({ groups, by, onFilter }: { groups: ReturnType<typeof groupStatistics>; by: GroupBy; onFilter?: (key: string) => void }) {
	return <table className="statistics-table"><caption className="statistics-sr-only">按{dimensions[by]}汇总</caption><thead><tr>{[dimensions[by], "请求", "Tokens", "缓存命中率", "已知费用", "图片", "视频"].map((name) => <th key={name} scope="col">{name}</th>)}</tr></thead><tbody>
		{groups.map(({ key, label, totals }) => { const hit = cacheHitRate(totals.tokens); return <tr key={key}>
			<th scope="row">{onFilter ? <Button className="statistics-group-link" variant="ghost" size="compact" aria-label={`筛选${dimensions[by]}：${label}`} onClick={() => onFilter(key)}>{label}</Button> : label}</th>
			<td>{number.format(totals.request)}</td><td>{totals.usageRows ? number.format(totalTokens(totals.tokens)) : "—"}</td><td>{hit === undefined ? "—" : percent.format(hit)}</td><td>{showCost(totals.cost)}{costNote(totals) && <small>{costNote(totals)}</small>}</td><td>{number.format(totals.image)}</td><td>{number.format(totals.video)}</td></tr>; })}
	</tbody></table>;
}
