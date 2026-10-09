
export function offerPrice(offer: { currency?: string; inputCost?: number; outputCost?: number }) {
	const price = (value?: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${offer.currency === "USD" ? "$" : "¥"}${value}` : "待配置";
	return `${offer.currency ?? "币种待配置"} · 输入 ${price(offer.inputCost)} · 输出 ${price(offer.outputCost)} / 每百万 token`;
}
export const offerAccount = (account?: string | null) => `扣费账户：${account?.trim() || "未标注"}`;
