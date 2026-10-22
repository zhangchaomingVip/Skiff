import { useEffect, useRef, useState } from "react";
import type { TurnProcessGroup } from "./turnProcess";
import { latestThinkingLabel } from "./processStepLabel";

/** Throttle live prose, with one pending timer regardless of the token arrival rate. */
export function useThinkingPreview(group: TurnProcessGroup, active: boolean): string | undefined {
	const entry = group.entries[group.entries.length - 1];
	const identity = `${group.id}:${entry?.messageId}:${entry?.key}`;
	const candidate = active ? latestThinkingLabel(group) : undefined;
	const latest = useRef(candidate);
	latest.current = candidate;
	const [preview, setPreview] = useState({ identity, value: candidate });
	const timer = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => {
		setPreview({ identity, value: candidate });
		return () => { clearTimeout(timer.current); timer.current = undefined; };
	}, [identity, active]);
	useEffect(() => {
		if (!active || timer.current !== undefined) return;
		timer.current = setTimeout(() => { timer.current = undefined; setPreview({ identity, value: latest.current }); }, 400);
	}, [candidate, active, identity]);
	return active ? preview.identity === identity ? preview.value : candidate : undefined;
}
