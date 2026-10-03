import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ModelInfo } from "../chat/types";
import { summarizeUsage } from "../chat/usage";

/** Rough token estimate: CJK counts as one unit, other non-space chars as a quarter. */
const estimateTokens = (text: string): number => {
	let units = 0;
	for (const char of text) {
		if (/\s/.test(char)) continue;
		units += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.25;
	}
	return Math.ceil(units);
};

const messageText = (message: ChatMessage): string => message.blocks.map((block) => block.kind === "text" ? block.text : "").join("");

/** Context-window pressure under the composer, with a best-effort breakdown. */
export function ContextUsage({ messages, model }: { messages: ChatMessage[]; model?: ModelInfo }) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
		const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
		document.addEventListener("pointerdown", dismiss);
		document.addEventListener("keydown", escape);
		return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
	}, [open]);

	const data = useMemo(() => {
		const assistants = messages.filter((message) => message.role === "assistant" && message.usage);
		const last = [...assistants].reverse().find((message) => !message.streaming);
		const limit = model?.contextWindow;
		if (!last?.usage || !limit || limit <= 0) return undefined;
		if ((last.model && last.model !== model?.id) || (last.provider && last.provider !== model?.provider)) return undefined;
		const context = summarizeUsage([last]).total;
		const first = assistants[0];
		const firstUser = messages.find((message) => message.role === "user");
		// The first request carries the system prompt + tool definitions + the first message.
		const firstUserTokens = firstUser ? estimateTokens(messageText(firstUser)) : 0;
		const estimatedOverhead = first ? Math.max(0, summarizeUsage([first]).inputTotal - firstUserTokens) : 0;
		const overhead = Math.min(context, estimatedOverhead);
		return { context, limit, ratio: context / limit, overhead, conversation: Math.max(0, context - overhead) };
	}, [messages, model]);

	if (!data) return null;
	const near = data.ratio >= .85;
	const width = (value: number) => `${data.context ? (value / data.context * 100) : 0}%`;
	return <div className="context-usage" ref={root}>
		<button type="button" className={`context-usage-bar ${near ? "near-limit" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`上下文占用 ${(data.ratio * 100).toFixed(0)}%，查看明细`}>
			<span className="context-usage-label">上下文</span>
			<progress value={Math.min(1, data.ratio)} max={1} aria-hidden="true" />
			<span className="context-usage-value">{(data.ratio * 100).toFixed(0)}% · {data.context.toLocaleString()} / {data.limit.toLocaleString()}</span>
		</button>
		{open && <div className="context-popover" role="dialog" aria-label="上下文占用明细">
			<div className="context-heading"><strong>上下文已用</strong><span>{(data.ratio * 100).toFixed(0)}% · ~{(data.context / 1000).toFixed(1)}K / {(data.limit / 1000).toFixed(0)}K</span></div>
			<div className={`context-segments ${near ? "near-limit" : ""}`}><i className="context-seg-overhead" style={{ width: width(data.overhead) }} /><i className="context-seg-conversation" style={{ flex: 1 }} /></div>
			<dl>
				<div className="usage-row"><dt><i className="swatch overhead" />系统提示词与工具定义</dt><dd>~{data.overhead.toLocaleString()}</dd></div>
				<div className="usage-row"><dt><i className="swatch conversation" />对话消息</dt><dd>~{data.conversation.toLocaleString()}</dd></div>
				<div className="usage-row"><dt>当前模型</dt><dd>{model?.name ?? model?.id}</dd></div>
			</dl>
			<p className="menu-hint">pi 未提供精确拆分：系统提示词与工具定义按首次请求输入减去首条消息估算，其余计入对话消息；实际以模型计费为准。{near ? "已接近窗口上限，建议新建聊天或压缩上下文。" : ""}</p>
		</div>}
	</div>;
}
