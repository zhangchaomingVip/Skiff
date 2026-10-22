import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../chat/types";
import { completedAtTooltip, formatCompletedAt, formatTokens, summarizeUsage } from "../chat/usage";
import { costTooltip, formatCosts, summarizeCosts } from "../chat/cost";
import { useModelFamily } from "../chat/familyContext";
import { Popover } from "./ui";
import { Icon } from "./Icon";

/** Quiet completion footer; historical route, usage and exact costs stay in details. */
export function TurnUsage({ message, messages }: { message: ChatMessage; messages?: ChatMessage[] }) {
	const { pricingModels, models, current } = useModelFamily();
	const usage = useMemo(() => summarizeUsage(messages ?? [message]), [messages, message]);
	const cost = useMemo(() => summarizeCosts(messages ?? [message], pricingModels ?? models ?? [], current), [messages, message, pricingModels, models, current]);
	const newInput = usage.input + usage.cacheWrite;
	const hasUsage = (messages ?? [message]).some((entry) => !!entry.usage);
	const routeMessage = message.routeSnapshot || message.model || message.provider ? message : [...(messages ?? [])].reverse().find((entry) => entry.routeSnapshot || entry.model || entry.provider) ?? message;
	const snapshot = routeMessage.routeSnapshot;
	const info = (pricingModels ?? models ?? []).find((model) => model.id === routeMessage.model && (!routeMessage.provider || model.provider === routeMessage.provider));
	// Missing historical identity must stay unknown even when a model is selected.
	const routeModel = info;
	const modelName = snapshot?.modelId ?? routeModel?.modelId ?? routeMessage.model ?? routeModel?.id ?? "未知模型";
	const relayName = snapshot?.relayName ?? routeModel?.providerName ?? routeMessage.provider ?? routeModel?.provider ?? "未知渠道";
	const account = snapshot ? snapshot.billingAccountId : routeModel?.billingAccountId;
	const preciseCost = formatCosts(cost, 6);
	const [open, setOpen] = useState(false);
	const [inlineExpanded, setInlineExpanded] = useState(false);
	const inlineId = useId();
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
		<div className="usage-tokens">
			<div className="usage-details">
				{hasUsage && <button type="button" className="usage-toggle" aria-expanded={inlineExpanded} aria-controls={inlineId} onClick={() => { setOpen(false); setInlineExpanded((value) => !value); }}>用量<Icon name="chevron" size={12} /></button>}
				{hasUsage && inlineExpanded && <span className="usage-inline" id={inlineId}>
					<span title={`输入 Token ${usage.inputTotal.toLocaleString("zh-CN")}，新增 ${newInput.toLocaleString("zh-CN")}`}>↓ {formatTokens(usage.inputTotal)}{newInput > 0 && newInput < usage.inputTotal && <span className="usage-new">(+{formatTokens(newInput)})</span>}</span>
					<span title="缓存命中率" role="img" aria-label={`缓存命中率 ${Math.round(usage.hitRate * 100)}%`}><Icon name="target" size={13} />{Math.round(usage.hitRate * 100)}%</span>
					<span title={`输出 Token ${usage.output.toLocaleString("zh-CN")}`}>↑ {formatTokens(usage.output)}</span>
					<span title={costTooltip(cost)}>{preciseCost === "—" ? costTooltip(cost) : formatCosts(cost, 5)}</span>
				</span>}
				{(!hasUsage || inlineExpanded) && <button type="button" ref={trigger} className="usage-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}>{hasUsage ? "详情" : "消息详情"}</button>}
				{open && <Popover anchor={trigger} onClose={close} id={panelId} className="usage-popover" aria-label={hasUsage ? "本轮 Token 消耗明细" : "消息详情"}>
					<div className="usage-route-details">
						<button type="button" className="usage-model" title={`完整线路：${relayName} · ${modelName} · ${account?.trim() ? `账户${account.trim()}` : "未知账户"}`} aria-label={`复制模型名 ${modelName}`} onClick={() => void copy(modelName, "模型名")}><span className="usage-model-label">{relayName} · {modelName}</span></button>
					</div>
					{!hasUsage && <p className="menu-hint">用量未记录</p>}
					{hasUsage && <>
					<button type="button" className="usage-cost" title={preciseCost === "—" ? costTooltip(cost) : `精确费用 ${preciseCost}（按 6 位原始值）`} aria-label={preciseCost === "—" ? costTooltip(cost) : "复制费用"} disabled={preciseCost === "—"} onClick={() => void copy(preciseCost, "费用")}>{preciseCost === "—" ? costTooltip(cost) : formatCosts(cost, 5)}</button>
					<div className="usage-heading"><strong>本轮 Token 消耗</strong><span>新增输入 <b className="usage-new">{formatTokens(newInput)}</b></span></div>
					<dl><div className="usage-row"><dt><i className="swatch input" />输入（发给模型）</dt><dd>{formatTokens(usage.inputTotal)}</dd></div>
						<div className="usage-row sub"><dt><i className="swatch hit" />缓存命中</dt><dd>{formatTokens(usage.cacheRead)}</dd></div>
						<div className="usage-row sub"><dt><i className="swatch miss" />缓存未命中（新增）</dt><dd>{formatTokens(usage.input)}</dd></div>
						<div className="usage-row sub"><dt><i className="swatch write" />缓存写入</dt><dd>{formatTokens(usage.cacheWrite)}</dd></div>
						<div className="usage-row output-row"><dt><i className="swatch output" />输出（新生成）</dt><dd>{formatTokens(usage.output)}</dd></div>
						<div className="usage-row sub"><dt>思考过程</dt><dd>{formatTokens(usage.reasoning)}</dd></div>
						<div className="usage-row sub"><dt>回复内容</dt><dd>{formatTokens(usage.answer)}</dd></div>
						<div className="usage-row usage-total-row"><dt>总计</dt><dd>{formatTokens(usage.total)}</dd></div>
					</dl>
					<div className="usage-rate"><span>缓存命中率</span><b>{(usage.hitRate * 100).toFixed(1)}%</b></div>
					<div className="cache-bar" aria-label={`缓存命中率 ${(usage.hitRate * 100).toFixed(1)}%`}><i className="hit" style={{ width: `${usage.hitRate * 100}%` }} /><i className="write" style={{ width: `${usage.inputTotal ? usage.cacheWrite / usage.inputTotal * 100 : 0}%` }} /><i className="miss" style={{ flex: 1 }} /></div>
					<div className="cache-legend"><span><i className="swatch hit" />命中</span><span><i className="swatch write" />写入</span><span><i className="swatch miss" />未命中</span></div>
					<p className="menu-hint">新增输入 = 缓存未命中 + 缓存写入。推理 Token 已包含在输出中。费用按提供商配置的单价本地计算。</p>
					</>}
				</Popover>}
			</div>
		</div>
		{message.timestamp !== undefined && <time className="usage-time" dateTime={new Date(message.timestamp).toISOString()} title={completedAtTooltip(message.timestamp)}>{formatCompletedAt(message.timestamp)}</time>}
		<span className="sr-only" role="status">{copyStatus}</span>
	</div>;
}
