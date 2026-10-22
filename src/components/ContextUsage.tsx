import { Icon } from "./Icon";
import type { VoyageMetrics } from "../chat/useVoyageMetrics";

/** Show actionable notices without a persistent status bar below the composer. */
export function ContextUsage({ metrics, notice }: { notice?: string; metrics: VoyageMetrics }) {
	if (!notice && !metrics.reminder) return null;
	return <div className={`voyage voyage-${metrics.pressure} voyage-${metrics.activity}`}>
		{notice && <span className="model-status-notice" role="status">{notice}</span>}
		{metrics.reminder && <p className="voyage-context-reminder" role="status" aria-live="polite" aria-atomic="true"><Icon name="info" /><span>{metrics.reminder}</span></p>}
	</div>;
}
