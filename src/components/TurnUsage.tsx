import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../chat/types";
import { completedAtTooltip, formatCompletedAt, formatTokens, summarizeUsage } from "../chat/usage";
import { costTooltip, formatCosts, summarizeCosts } from "../chat/cost";
import { useModelFamily } from "../chat/familyContext";
import { Popover } from "./ui";
import { Icon } from "./Icon";

/** Quiet completion footer: copy, cost then usage sit on one row; usage opens a grouped panel. */
export function TurnUsage({ message, messages }: { message: ChatMessage; messages?: ChatMessage[] }) {
	const { pricingModels, models, current } = useModelFamily();
	const usage = useMemo(() => summarizeUsage(messages ?? [message]), [messages, message]);
	const cost = useMemo(() => summarizeCosts(messages ?? [message], pricingModels ?? models ?? [], current), [messages, message, pricingModels, models, current]);
	const newInput = usage.input + usage.cacheWrite;
	const hasUsage = (messages ?? [message]).some((entry) => !!entry.usage);
	const routeMessage = message.routeSnapshot || message.model || message.provider ? message : [...(messages ?? [message])].reverse().find((entry) => entry.routeSnapshot || entry.model || entry.provider) ?? message;
	const snapshot = routeMessage.routeSnapshot;
	const info = (pricingModels ?? models ?? []).find((model) => model.id === routeMessage.model && (!routeMessage.provider || model.provider === routeMessage.provider));
	// Missing historical identity must stay unknown even when a model is selected.
	const routeModel = info;
	const modelName = snapshot?.modelId ?? routeModel?.modelId ?? routeMessage.model ?? routeModel?.id ?? "未知模型";
	const relayName = snapshot?.relayName ?? routeModel?.providerName ?? routeMessage.provider ?? routeModel?.provider ?? "未知渠道";
	const account = snapshot ? snapshot.billingAccountId : routeModel?.billingAccountId;
	const preciseCost = formatCosts(cost, 6);
	const amount = formatCosts(cost, 4);
	const hitRate = (usage.hitRate * 100).toFixed(1);
	const hitTone = usage.hitRate >= 0.9 ? "high" : usage.hitRate < 0.7 ? "low" : "";
	const [open, setOpen] = useState(false);
	const [copyStatus, setCopyStatus] = useState("");
	const trigger = useRef<HTMLButtonElement>(null);
	const copyTimer = useRef<ReturnType<typeof setTimeout>>();
	const panelId = useId();
	const close = () => setOpen(false);
	useEffect(() => () => clearTimeout(copyTimer.current), []);
	const copy = async (text: string, label: string) => {
		try { await navigator.clipboard.writeText(text); setCopyStatus(`${label}已复制`); }
		catch { setCopyStatus("复制失败"); }
		clearTimeout(copyTimer.current);
		copyTimer.current = setTimeout(() => setCopyStatus(""), 2000);
	};
	return <div className="turn-usage">
		{amount !== "—" && <span className="usage-amount" title={preciseCost === "—" ? costTooltip(cost) : `精确费用 ${preciseCost}`}>{amount}</span>}
		<button type="button" ref={trigger} className="usage-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}><Icon name="tokens" size={13} />{hasUsage ? `用量 ${formatTokens(usage.total)} tok` : "消息详情"}</button>
		{open && <Popover anchor={trigger} onClose={close} id={panelId} className="usage-popover" gap={4} aria-label={hasUsage ? "本轮 Token 消耗明细" : "消息详情"}>
			<section className="usage-group usage-turn">
				<p className="usage-group-head"><span>本轮用量</span><b>{hasUsage ? `${formatTokens(usage.total)} tok` : "未记录"}</b></p>
				{hasUsage && <dl className="usage-metrics">
					<div className="usage-metric sub"><dt>新增输入</dt><dd className="usage-new">+{formatTokens(newInput)}</dd></div>
					<div className="usage-metric sub"><dt>输出</dt><dd>{formatTokens(usage.output)}</dd></div>
					<div className="usage-metric sub"><dt>缓存命中</dt><dd className={hitTone ? `usage-hit-${hitTone}` : undefined}>{hitRate}%</dd></div>
				</dl>}
			</section>
			<section className="usage-group usage-system">
				<dl className="usage-metrics">
					<div className="usage-metric"><dt>模型名称</dt><dd><button type="button" className="usage-model" title={`完整线路：${relayName} · ${modelName} · ${account?.trim() ? `账户${account.trim()}` : "未知账户"}`} aria-label={`复制模型名 ${modelName}`} onClick={() => void copy(modelName, "模型名")}><span className="usage-model-label"><span className="usage-relay">{relayName}</span> · {modelName}</span></button></dd></div>
					<div className="usage-metric"><dt>预估费用</dt><dd><button type="button" className="usage-cost" title={preciseCost === "—" ? costTooltip(cost) : `精确费用 ${preciseCost}（按 6 位原始值）`} aria-label={preciseCost === "—" ? costTooltip(cost) : "复制费用"} disabled={preciseCost === "—"} onClick={() => void copy(preciseCost, "费用")}>{preciseCost === "—" ? costTooltip(cost) : amount}</button></dd></div>
				</dl>
			</section>
		</Popover>}
		{message.timestamp !== undefined && <time className="usage-time" dateTime={new Date(message.timestamp).toISOString()} title={completedAtTooltip(message.timestamp)}>{formatCompletedAt(message.timestamp)}</time>}
		<span className="sr-only" role="status">{copyStatus}</span>
	</div>;
}
