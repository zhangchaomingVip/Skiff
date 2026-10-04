import { useEffect, useMemo, useRef } from "react";
import type { ChatMessage } from "../chat/types";
import { formatCompletedAt, summarizeUsage } from "../chat/usage";
import { Icon } from "./Icon";
import { costTooltip, formatCosts, summarizeCosts } from "../chat/cost";
import { useModelFamily } from "../chat/familyContext";

const number = (value?: number) => value === undefined ? "未提供" : value.toLocaleString();

/** Fixed usage shown once at the end of the conversation: tokens, cost and duration. */
export function TurnUsage({ message, messages }: { message: ChatMessage; messages?: ChatMessage[] }) {
	const { pricingModels, models, current } = useModelFamily();
	const usage = useMemo(() => summarizeUsage(messages ?? [message]), [messages, message]);
	const cost = useMemo(() => summarizeCosts(messages ?? [message], pricingModels ?? models ?? [], current), [messages, message, pricingModels, models, current]);
	const root = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		const dismiss = (event: PointerEvent) => { if (root.current?.open && !root.current.contains(event.target as Node)) root.current.open = false; };
		const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && root.current?.open) { root.current.open = false; root.current.querySelector("summary")?.focus(); } };
		document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
		return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
	}, []);
	return <>
		<details className="usage-details" ref={root}>
			<summary aria-label="本轮 Token 消耗明细"><Icon name="tokens" size={13} /> Tokens: {number(usage.total)} <Icon name="info" size={13} /></summary>
			<div className="usage-popover">
				<div className="usage-heading"><strong>最后一轮 Token 消耗</strong><span>总计 <b>{number(usage.total)}</b></span></div>
				<dl><div className="usage-row"><dt><i className="swatch input" />输入</dt><dd>{number(usage.inputTotal)}</dd></div>
					<div className="usage-row sub"><dt><i className="swatch hit" />缓存命中</dt><dd>{number(usage.cacheRead)}</dd></div>
					<div className="usage-row sub"><dt><i className="swatch miss" />缓存未命中</dt><dd>{number(usage.input)}</dd></div>
					<div className="usage-row sub"><dt><i className="swatch write" />缓存写入</dt><dd>{number(usage.cacheWrite)}</dd></div>
					<div className="usage-row output-row"><dt><i className="swatch output" />输出</dt><dd>{number(usage.output)}</dd></div>
					<div className="usage-row sub"><dt>思考过程</dt><dd>{number(usage.reasoning)}</dd></div>
					<div className="usage-row sub"><dt>回复内容</dt><dd>{number(usage.answer)}</dd></div>
				</dl>
				<div className="usage-rate"><span>缓存命中率</span><b>{(usage.hitRate * 100).toFixed(1)}%</b></div>
				<div className="cache-bar" aria-label={`缓存命中率 ${(usage.hitRate * 100).toFixed(1)}%`}><i className="hit" style={{ width: `${usage.hitRate * 100}%` }} /><i className="write" style={{ width: `${usage.inputTotal ? usage.cacheWrite / usage.inputTotal * 100 : 0}%` }} /><i className="miss" style={{ flex: 1 }} /></div>
				<div className="cache-legend"><span><i className="swatch hit" />命中</span><span><i className="swatch write" />写入</span><span><i className="swatch miss" />未命中</span></div>
				<p className="menu-hint">本轮用量，来自 pi。推理 Token 已包含在输出中。费用按提供商配置的单价本地计算。</p>
			</div>
		</details>
		<span className="usage-cost" title={costTooltip(cost)}>{formatCosts(cost)}</span>
		{message.timestamp !== undefined && <span className="usage-time" title="本轮完成时间"><Icon name="clock" size={13} />{formatCompletedAt(message.timestamp)}</span>}
	</>;
}
