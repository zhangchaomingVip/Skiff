import type { ChatMessage, RouteSnapshot } from "./types";
import type { Conversation } from "./workspace";
import { splitAttachments } from "./textAttachments";

export function deriveTitle(messages: readonly ChatMessage[]): string {
	const first = messages.find((message) => message.role === "user");
	const text = first?.blocks.filter((block) => block.kind === "text").map((block) => splitAttachments(block.text).text).join(" ").replace(/\s+/gu, " ").trim();
	return text ? Array.from(text).slice(0, 32).join("") : first?.blocks.some((block) => block.kind === "image") ? "图片聊天" : "新聊天";
}

export function conversationRoute(chat: Conversation): RouteSnapshot | undefined { return [...(chat.routeSnapshots ?? [])].reverse().find((snapshot) => snapshot !== null) ?? undefined; }
export function conversationLabel(chat: Conversation): string {
	return chat.title;
}

export function conversationTime(chat: Conversation, now = Date.now()): string {
	const date = new Date(chat.createdAt ?? chat.updatedAt);
	const today = new Date(now);
	const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
	if (date.toDateString() === today.toDateString()) return time;
	const day = `${date.getMonth() + 1}/${date.getDate()}`;
	return day;
}

export function conversationTooltip(chat: Conversation): string {
	const route = conversationRoute(chat);
	return [conversationLabel(chat), ...(chat.createdAt === undefined ? [] : [`创建于 ${new Date(chat.createdAt).toLocaleString("zh-CN")}`]), `更新于 ${new Date(chat.updatedAt).toLocaleString("zh-CN")}`, route ? `${route.familyName} · ${route.relayName} · ${route.modelId} · 账户${route.billingAccountId?.trim() || "未标注"}` : "线路待更新"].join("\n");
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
