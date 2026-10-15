import type { ChatMessage, RouteSnapshot } from "./types";
import type { Conversation } from "./workspace";
import { splitAttachments } from "./textAttachments";

export function deriveTitle(messages: readonly ChatMessage[]): string {
	const first = messages.find((message) => message.role === "user");
	const text = first?.blocks.filter((block) => block.kind === "text").map((block) => splitAttachments(block.text).text).join(" ").replace(/\s+/gu, " ").trim();
	return text ? Array.from(text).slice(0, 32).join("") : first?.blocks.some((block) => block.kind === "image") ? "图片聊天" : "新聊天";
}

export function conversationRoute(chat: Conversation): RouteSnapshot | undefined { return [...(chat.routeSnapshots ?? [])].reverse().find((snapshot) => snapshot !== null) ?? undefined; }
export function conversationLabel(chat: Conversation, peers: readonly Conversation[]): string {
	if (chat.customTitle) return chat.title;
	const snapshot = conversationRoute(chat);
	const alias = snapshot ? snapshot.alias?.trim() : chat.modelAlias?.trim();
	const base = `${Array.from(chat.title).slice(0, 32).join("")}${alias ? ` · ${alias}` : ""}`;
	const duplicates = peers.filter((other) => !other.customTitle && other.projectId === chat.projectId && other.title === chat.title && ((conversationRoute(other) ? conversationRoute(other)?.alias?.trim() : other.modelAlias?.trim()) || "") === (alias || ""));
	if (duplicates.length < 2) return base;
	// The stable ID also disambiguates identical creation timestamps.
	const created = chat.createdAt === undefined ? "" : `${new Date(chat.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} `;
	return `${base} · ${created}${chat.id.slice(-6)}`;
}
export function conversationTooltip(chat: Conversation, peers: readonly Conversation[]): string {
	const route = conversationRoute(chat);
	return [conversationLabel(chat, peers), route ? `${route.familyName} · ${route.relayName} · ${route.modelId} · 账户${route.billingAccountId?.trim() || "未标注"}` : "线路待更新"].join("\n");
}

export function calendarGroup(timestamp: number, now = Date.now()): string {
	const date = new Date(timestamp), today = new Date(now);
	// UTC day numbers of local calendar dates avoid 23/25 hour DST days.
	const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86400000;
	const days = day(today) - day(date);
	if (days <= 0) return "今天";
	if (days === 1) return "昨天";
	if (days <= 30) return `${date.toLocaleDateString("zh-CN", { weekday: "long" })} ${date.getMonth() + 1}/${date.getDate()}`;
	return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}
