import type { ChatMessage } from "../chat/types";
import { Markdown } from "./Markdown";
import { ToolCallBlock } from "./ToolCallBlock";

/** One chat bubble: user or assistant, with text/thinking/tool blocks. */
export function MessageItem({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const label = isUser ? "You" : message.model ? `pi · ${message.model}` : "pi";

	return (
		<div className={`msg ${isUser ? "user" : "assistant"}`}>
			<div className="msg-role">{label}</div>
			<div className="msg-body">
				{message.blocks.length === 0 && message.streaming ? <span className="typing">thinking…</span> : null}
				{message.blocks.map((block, index) => {
					if (block.kind === "text") return <Markdown key={index} text={block.text} />;
					if (block.kind === "thinking") {
						return (
							<details key={index} className="thinking">
								<summary>thinking</summary>
								<pre>{block.text}</pre>
							</details>
						);
					}
					if (block.kind === "tool") {
						return <ToolCallBlock key={index} name={block.name} argsText={block.argsText} done={block.done} />;
					}
					return (
						<details key={index} className={`tool-result ${block.isError ? "err" : ""}`}>
							<summary>{block.name} result</summary>
							<pre>{block.text}</pre>
						</details>
					);
				})}
			</div>
		</div>
	);
}
