import type { ChatMessage, Currency, ModelInfo } from "./types";
import { summarizeUsage } from "./usage";

export interface CostSummary {
	totals: Partial<Record<Currency, number>>;
	unconfigured: boolean;
}

/** Resolve historical messages by channel; never price them using another channel. */
export function summarizeCosts(messages: ChatMessage[], models: ModelInfo[], current?: ModelInfo): CostSummary {
	const result: CostSummary = { totals: {}, unconfigured: false };
	for (const message of messages) {
		if (message.role !== "assistant" || message.streaming) continue;
		if (!message.usage) { result.unconfigured = true; continue; }
		if (message.routeSnapshot) {
			const snapshot = message.routeSnapshot;
			const cacheReadPrice = snapshot.cacheReadCost ?? snapshot.inputCost;
			const cacheWritePrice = snapshot.cacheWriteCost ?? snapshot.inputCost;
			const prices = [snapshot.inputCost, snapshot.outputCost, cacheReadPrice, cacheWritePrice];
			if (prices.some((price) => !Number.isFinite(price) || price < 0) || prices.every((price) => price === 0)) { result.unconfigured = true; continue; }
			const usage = summarizeUsage([message]);
			const cost = usage.input / 1e6 * snapshot.inputCost + usage.cacheRead / 1e6 * cacheReadPrice + usage.cacheWrite / 1e6 * cacheWritePrice + usage.output / 1e6 * snapshot.outputCost;
			result.totals[snapshot.currency] = (result.totals[snapshot.currency] ?? 0) + cost;
			continue;
		}
		const matches = (model: ModelInfo) => (!message.provider || message.provider === model.provider) && (!message.model || message.model === model.id);
		const candidates = models.filter(matches);
		const model = message.provider ? candidates[0] ?? (current && matches(current) ? current : undefined)
			: candidates.length === 1 ? candidates[0] : !candidates.length && current && matches(current) ? current : undefined;
		const inputPrice = model?.cost?.input;
		const outputPrice = model?.cost?.output;
		if (inputPrice === undefined || outputPrice === undefined || !Number.isFinite(inputPrice) || !Number.isFinite(outputPrice) || inputPrice < 0 || outputPrice < 0 || (inputPrice === 0 && outputPrice === 0)) {
			result.unconfigured = true;
			continue;
		}
		const usage = summarizeUsage([message]);
		const currency = model?.currency ?? "CNY";
		const cost = usage.inputTotal / 1e6 * inputPrice + usage.output / 1e6 * outputPrice;
		result.totals[currency] = (result.totals[currency] ?? 0) + cost;
	}
	return result;
}

export function formatCost(amount: number, currency: Currency): string {
	const symbol = currency === "USD" ? "$" : "¥";
	if (amount >= 0.01 || amount === 0) return symbol + amount.toFixed(2);
	// Convert significant digits back to fixed notation so tiny costs stay
	// readable and never round to a string such as $0.0000.
	const rounded = Number(amount.toPrecision(4));
	const decimals = Math.max(0, 3 - Math.floor(Math.log10(rounded)));
	return symbol + rounded.toFixed(Math.min(100, decimals)).replace(/0+$/, "");
}

export function formatCosts(summary?: CostSummary): string {
	if (!summary || summary.unconfigured) return "—";
	const parts = (["CNY", "USD"] as const).flatMap((currency) => summary.totals[currency] === undefined ? [] : [formatCost(summary.totals[currency], currency)]);
	return parts.join(" + ") || "—";
}

export function costTooltip(summary?: CostSummary): string {
	if (summary?.unconfigured) return "未配置单价";
	return summary && Object.keys(summary.totals).length ? "按模型单价本地计算；不同币种分别累计，不做汇率换算" : "暂无费用数据";
}
