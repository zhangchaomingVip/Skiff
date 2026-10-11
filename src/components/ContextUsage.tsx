import { Icon } from "./Icon";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { Boat, SpeedStats } from "./VoyageRail";
import { formatDuration, formatTokens } from "../chat/usage";

const number = (value: number) => formatTokens(Math.round(value));

/** Persistent status bar; its button controls the same rail state as the rail toggle. */
export function ContextUsage({ metrics, expanded, onToggle, notice }: { notice?: string; metrics: VoyageMetrics; expanded: boolean; onToggle: () => void }) {
	const progress = Math.min(100, metrics.ratio * 100);
	const distance = metrics.context === undefined ? "—" : number(metrics.context);
	const status = metrics.status;
	const working = metrics.streaming && metrics.phase !== "response";
	const activity = working && metrics.statusDurationMs !== undefined ? `${status} · ${formatDuration(metrics.statusDurationMs)}` : status;
	const remaining = metrics.context === undefined || metrics.limit === undefined ? "剩余额度待首次回复后计算" : `剩余 ${number(Math.max(0, metrics.limit - metrics.context))} tokens`;
	return <div className={`voyage voyage-${metrics.pressure} voyage-${metrics.activity}`}>
		{notice && <span className="model-status-notice" role="status">{notice}</span>}
		{metrics.reminder && <p className="voyage-context-reminder" role="status" aria-live="polite" aria-atomic="true"><Icon name="info" /><span>{metrics.reminder}</span></p>}
		<button type="button" className="voyage-summary" onClick={onToggle} aria-expanded={expanded} aria-controls="voyage-rail" aria-label={`切换航行台，${activity}${working ? "" : `，输出速度约 ${metrics.speed.toFixed(1)} token 每秒`}，当前上下文 ${distance} / ${metrics.limit ? number(metrics.limit) : "—"} token`}>
			{expanded ? <span className="voyage-compact-text">{activity}{working ? "" : ` · ${metrics.speed.toFixed(1)} tok/s`}</span> : <>
				<span className="voyage-status"><span className="voyage-status-dot" />{activity}</span>
				<span className="voyage-speed"><strong>{working ? formatDuration(metrics.statusDurationMs ?? 0) : metrics.speed.toFixed(1)}</strong><small>{working ? "本阶段" : "tok/s"}</small></span>
				<span className="voyage-route" title={remaining}><span className="voyage-anchor" aria-hidden="true"><Icon name="anchor" size={16} /></span><span className="voyage-track"><span className="voyage-track-fill" style={{ transform: `scaleX(${progress / 100})` }} /><Boat className="voyage-route-boat" position={progress} /></span><span className="voyage-flag" aria-hidden="true"><Icon name="flag" size={16} /></span></span>
				<span className="voyage-distance"><strong>{distance}</strong><small>{metrics.limit ? ` / ${number(metrics.limit)} tok` : " tok"}</small></span>
				<span className="voyage-expand" aria-hidden="true"><Icon name="chevron" size={16} /></span>
			</>}
		</button>
		{!expanded && <SpeedStats metrics={metrics} />}
	</div>;
}
