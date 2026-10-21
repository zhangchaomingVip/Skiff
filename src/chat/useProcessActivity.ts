import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { advanceProcessClock, processActivity, processElapsedLabel, type ProcessClock } from "./processStatus";
import type { TurnProcessGroup } from "./turnProcess";

/** Only active rows own a timer; new progress clears the stalled indication immediately. */
export function useProcessActivity(group: TurnProcessGroup, active: boolean): string {
	const clock = useRef<ProcessClock>();
	const [now, setNow] = useState(Date.now);
	const activity = useMemo(() => active ? processActivity(group) : undefined, [group, active]);
	const observed = activity ? advanceProcessClock(clock.current, activity, Date.now()) : undefined;
	useLayoutEffect(() => { clock.current = observed; }, [observed]);
	useEffect(() => {
		if (!active) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [active, group.id]);
	return active ? processElapsedLabel(observed, Math.max(now, Date.now())) : "";
}
