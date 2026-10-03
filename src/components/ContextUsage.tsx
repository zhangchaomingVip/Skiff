import type { VoyageMetrics } from "../chat/useVoyageMetrics";
import { Boat } from "./VoyageRail";

const number = (value: number) => Math.round(value).toLocaleString("zh-CN");

/** Persistent status bar; its button controls the same rail state as the rail toggle. */
export function ContextUsage({ metrics, expanded, onToggle }: { metrics: VoyageMetrics; expanded: boolean; onToggle: () => void }) {
	const progress = Math.min(100, metrics.ratio * 100);
	const distance = metrics.context === undefined ? "—" : number(metrics.context);
	const status = metrics.arrived ? "已到港" : metrics.streaming ? "航行中" : "已停泊";
	const remaining = metrics.context === undefined || metrics.limit === undefined ? "剩余额度待首次回复后计算" : `剩余 ${number(Math.max(0, metrics.limit - metrics.context))} tokens`;
	return <div className={`voyage voyage-${metrics.pressure} ${metrics.streaming ? "voyage-running" : ""} ${metrics.arrived ? "voyage-arrived" : ""}`}>
		<button type="button" className="voyage-summary" onClick={onToggle} aria-expanded={expanded} aria-controls="voyage-rail" aria-label={`切换航行台，${metrics.status}，输出速度约 ${metrics.speed.toFixed(1)} token 每秒，当前上下文 ${distance} / ${metrics.limit ? number(metrics.limit) : "—"} token`}>
			{expanded ? <span className="voyage-compact-text">{status} · {metrics.speed ? metrics.speed.toFixed(1) : "0"} tok/s</span> : <>
				<span className="voyage-status"><span className="voyage-status-dot" />{status}</span>
				<span className="voyage-speed"><strong>{metrics.speed ? metrics.speed.toFixed(1) : "0"}</strong><small>tok/s</small></span>
				<span className="voyage-route" title={remaining}><span className="voyage-anchor" aria-hidden="true">⚓</span><span className="voyage-track"><span className="voyage-track-fill" style={{ transform: `scaleX(${progress / 100})` }} /><Boat className="voyage-route-boat" position={progress} /></span><span className="voyage-flag" aria-hidden="true">⚑</span></span>
				<span className="voyage-distance"><strong>{distance}</strong><small>{metrics.limit ? ` / ${number(metrics.limit)} tok` : " tok"}</small></span>
				<span className="voyage-expand" aria-hidden="true">‹</span>
			</>}
		</button>
	</div>;
}
