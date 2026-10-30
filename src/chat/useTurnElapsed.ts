import { useEffect, useState } from "react";
import { formatElapsedSeconds } from "./usage";

/** Only the live turn ticks, using the session's actual run start rather than mount time. */
export function useTurnElapsed(active: boolean, startedAt?: number): string {
	const [now, setNow] = useState(Date.now);
	const validStart = startedAt !== undefined && Number.isFinite(startedAt);
	useEffect(() => {
		if (!active || !validStart) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active, startedAt, validStart]);
	return validStart ? `用时 ${formatElapsedSeconds(Math.max(0, Math.max(now, Date.now()) - startedAt) / 1000)}` : "用时统计中";
}
