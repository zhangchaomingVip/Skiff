import { useContext } from "react";
import { LiveTurnContext } from "../chat/liveTurnContext";
import { formatDuration } from "../chat/usage";

/** Only this label consumes clock updates; message bodies remain memoized. */
export function TurnSummary({ turnId, durationMs, steps }: { turnId: string; durationMs?: number; steps: number }) {
	const liveTurn = useContext(LiveTurnContext);
	const duration = liveTurn?.turnId === turnId ? liveTurn.durationMs : durationMs;
	return <span className="turn-summary">{duration !== undefined ? `耗时 ${formatDuration(duration)}${steps > 0 ? " · " : ""}` : ""}{steps > 0 ? `${steps.toLocaleString("en-US")} 步` : ""}</span>;
}
