import type { ChatMessage } from "../chat/types";
import { Markdown } from "./Markdown";
import { ToolCallBlock } from "./ToolCallBlock";

/** One chat bubble: user or assistant, with text/thinking/tool blocks. */
export function MessageItem({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const label = isUser ? "你" : "Skiff";

	return (
		<div className={`msg ${isUser ? "user" : "assistant"}`}>
			<div className="msg-role">{label}</div>
			<div className="msg-body">
				{message.blocks.length === 0 && message.streaming ? <span className="typing">正在思考…</span> : null}
				{message.blocks.map((block, index) => {
					if (block.kind === "text") return <Markdown key={index} text={block.text} />;
					if (block.kind === "image") return <img key={index} className="message-image" src={`data:${block.mimeType};base64,${block.data}`} alt="用户上传的图片" loading="lazy" />;
					if (block.kind === "thinking") {
						return (
							<details key={index} className="thinking">
								<summary>思考过程</summary>
								<pre>{block.text}</pre>
							</details>
						);
					}
					if (block.kind === "tool") {
						return <ToolCallBlock key={index} name={block.name} argsText={block.argsText} done={block.done} />;
					}
					return (
						<details key={index} className={`tool-result ${block.isError ? "err" : ""}`}>
							<summary>{block.name} · 执行结果</summary>
							<pre>{block.text}</pre>
						</details>
					);
				})}
			</div>
			{!isUser && message.usage && <div className="message-usage">{message.usage.totalTokens?.toLocaleString() ?? 0} tokens{typeof message.usage.cost?.total === "number" ? ` · $${message.usage.cost.total.toFixed(4)}` : ""}</div>}
		</div>
	);
}
