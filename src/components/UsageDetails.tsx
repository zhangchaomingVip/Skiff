import { useEffect, useRef } from "react";
import type { ChatMessage } from "../chat/types";
import { formatDuration, summarizeUsage } from "../chat/usage";
import { Icon } from "./Icon";

const number = (value?: number) => value === undefined ? "未提供" : value.toLocaleString();

export function UsageDetails({ messages, elapsedMs }: { messages: ChatMessage[]; elapsedMs: number }) {
	const usage = summarizeUsage(messages);
	const root = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		const dismiss = (event: PointerEvent) => { if (root.current?.open && !root.current.contains(event.target as Node)) root.current.open = false; };
		const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && root.current?.open) { root.current.open = false; root.current.querySelector("summary")?.focus(); } };
		document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
		return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
	}, []);
	return <div className="usage-toolbar">
		<details className="usage-details" ref={root}><summary aria-label="Token 消耗明细"><span className="usage-token-icon">◉</span> Tokens: {number(usage.total)} <span className="info-icon">ⓘ</span></summary>
			<div className="usage-popover">
				<div className="usage-heading"><strong>Token 消耗明细</strong><span>总计 <b>{number(usage.total)}</b></span></div>
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
				<p className="menu-hint">当前聊天累计用量，来自 pi。推理 Token 已包含在输出中。{usage.cost === undefined ? "" : ` pi 估算费用：$${usage.cost.toFixed(4)}（按模型配置单价）。`}</p>
			</div>
		</details>
		<span className="usage-time" title="累计生成与工具执行时间"><Icon name="clock" size={13} />耗时: {formatDuration(elapsedMs)}</span>
	</div>;
}
