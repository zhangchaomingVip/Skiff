import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../chat/types";
import { formatCompletedAt, formatTokens, summarizeUsage } from "../chat/usage";
import { Icon } from "./Icon";
import { costTooltip, formatCosts, summarizeCosts } from "../chat/cost";
import { useModelFamily } from "../chat/familyContext";
import { Popover } from "./ui";

/** Usage shown once at the end of each completed turn: tokens, cost and completion time. */
export function TurnUsage({ message, messages }: { message: ChatMessage; messages?: ChatMessage[] }) {
	const { pricingModels, models, current } = useModelFamily();
	const usage = useMemo(() => summarizeUsage(messages ?? [message]), [messages, message]);
	const cost = useMemo(() => summarizeCosts(messages ?? [message], pricingModels ?? models ?? [], current), [messages, message, pricingModels, models, current]);
	const newTokens = usage.input + usage.cacheWrite + usage.output;
	const [open, setOpen] = useState(false);
	const trigger = useRef<HTMLButtonElement>(null);
	const pinned = useRef(false);
	const dismissTimer = useRef<ReturnType<typeof setTimeout>>();
	const panelId = useId();
	const cancelDismiss = () => clearTimeout(dismissTimer.current);
	const close = () => { cancelDismiss(); pinned.current = false; setOpen(false); };
	useEffect(() => () => clearTimeout(dismissTimer.current), []);
	return <>
		<div className="usage-details" onPointerEnter={(event) => { if (event.pointerType === "mouse") { cancelDismiss(); setOpen(true); } }} onPointerLeave={() => {
			if (!pinned.current) dismissTimer.current = setTimeout(close, 150);
		}}>
			<button type="button" ref={trigger} className="usage-trigger" aria-label={`本轮 Token 消耗明细，新增 ${formatTokens(newTokens)}，总计 ${formatTokens(usage.total)}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => {
				cancelDismiss(); pinned.current = !pinned.current; setOpen(pinned.current);
			}}><span className="usage-new"><Icon name="arrow" size={12} />{formatTokens(newTokens)}</span><span className="usage-total">/ {formatTokens(usage.total)}</span></button>
			{open && <Popover anchor={trigger} onClose={close} id={panelId} className="usage-popover" aria-label="本轮 Token 消耗明细">
				<div className="usage-heading"><strong>本轮 Token 消耗</strong><span>新增 <b className="usage-new">{formatTokens(newTokens)}</b></span></div>
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
				<p className="menu-hint">新增 = 缓存未命中 + 缓存写入 + 输出。推理 Token 已包含在输出中。费用按提供商配置的单价本地计算。</p>
			</Popover>}
		</div>
		<span className="usage-cost" title={costTooltip(cost)}>{formatCosts(cost)}</span>
		{message.timestamp !== undefined && <span className="usage-time" title="本轮完成时间"><Icon name="clock" size={13} />{formatCompletedAt(message.timestamp)}</span>}
	</>;
}
