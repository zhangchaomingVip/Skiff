import type { VoyageActivity, VoyagePhase } from "./sailing";
import type { ToolStatus, VoyageTool } from "./voyageTimeline";

/** The five animated poses shipped in `public/companion/`. */
export type CompanionPose = "idle" | "happy" | "eat" | "sleep" | "angry";

/** Everything a pose reacts to; `VoyageMetrics` satisfies this shape. */
export interface PoseSignals {
	streaming: boolean;
	phase: VoyagePhase;
	activity: VoyageActivity;
	ratio: number;
	activeTools: number;
	failedTool: boolean;
	hitRate?: number;
}

/** Context above this share is an overload warning, matching the dial's red zone. */
export const POSE_OVERLOAD = .9;
/** A warm cache is worth a happy hop once the turn has ended. */
export const POSE_CACHE_HIT = .7;

const FAILURES: ReadonlySet<ToolStatus> = new Set<ToolStatus>(["failed", "timeout", "missing"]);

/** The newest logged tool decides the mood: one failure is enough to frown. */
export function latestToolFailed(tools: readonly VoyageTool[]): boolean {
	let latest: VoyageTool | undefined;
	for (const tool of tools) if (!latest || (tool.completionOrder ?? 0) >= (latest.completionOrder ?? 0)) latest = tool;
	return latest !== undefined && FAILURES.has(latest.status);
}

/**
 * Auto pose. Overload and a failed tool outrank progress; a tool call means
 * eating context; reasoning and the wait for the first token are a nap; only
 * flowing reply text is a happy sail.
 */
export function companionPose({ streaming, phase, activity, ratio, activeTools, failedTool, hitRate }: PoseSignals): CompanionPose {
	if (ratio >= POSE_OVERLOAD || failedTool) return "angry";
	if (streaming) {
		if (phase === "tool" || activeTools > 0) return "eat";
		if (phase === "thinking" || activity !== "sailing") return "sleep";
		return "happy";
	}
	return hitRate !== undefined && hitRate >= POSE_CACHE_HIT ? "happy" : "idle";
}

export const POSE_MOOD: Record<CompanionPose, string> = {
	idle: "待机 · 顺风巡航",
	happy: "开心 · 顺风巡航",
	eat: "专注 · 吞噬数据",
	sleep: "打盹 · 等待响应",
	angry: "生气 · 急需补给",
};
