export type ConversationStatus = "needsConfirmation" | "failed" | "running" | "idle";
export const statusLabels: Record<ConversationStatus, string> = { needsConfirmation: "需要确认", failed: "失败", running: "运行中", idle: "空闲" };
export const statusSymbols: Record<ConversationStatus, string> = { needsConfirmation: "?", failed: "!", running: "▶", idle: "○" };
export function conversationStatus(state: { needsConfirmation?: boolean; error?: string; running?: boolean }): ConversationStatus {
	return state.needsConfirmation ? "needsConfirmation" : state.error ? "failed" : state.running ? "running" : "idle";
}
export function backgroundSessions(statuses: ReadonlyMap<string, ConversationStatus>, activeId?: string) {
	const rank: Record<ConversationStatus, number> = { needsConfirmation: 0, failed: 1, running: 2, idle: 3 };
	return [...statuses].filter(([id, status]) => id !== activeId && status !== "idle").sort((a, b) => rank[a[1]] - rank[b[1]]);
}
