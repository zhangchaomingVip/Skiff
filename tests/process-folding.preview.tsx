import { StrictMode, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageList } from "../src/components/MessageList";
import { reduce } from "../src/chat/reducer";
import { initialSessionState, type SessionState } from "../src/chat/types";
import type { RpcEvent } from "../src/rpc/RpcClient";
import { Button } from "../src/components/ui";
import "../src/tokens.css";
import "../src/index.css";
import "../src/components/ui.css";
import "./process-folding.css";

document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
const thinking = "先检查现有行为，再核对边界情况。".repeat(80);
const firstReply = "第一段正文先给出结论：过程默认收起，回答始终可见。";
const secondReply = "第二段正文解释结果：行内工具执行完成，轮首计数保持不变。";
const model = { provider: "mock", id: "mock", name: "流式渲染回归" };
const start: SessionState = reduce({ ...initialSessionState, messages: [{ id: "user", role: "user", blocks: [{ kind: "text", text: "验证两阶段过程折叠、流式计数和手动展开状态。" }] }], isStreaming: true, activeRun: { turnId: "turn:user", startedAt: Date.now() } }, { type: "message_start", message: { role: "assistant" } });
const noop = () => {};

function Harness() {
	const [state, send] = useReducer((state: SessionState, events: RpcEvent[]) => events.reduce((value, event) => reduce(value, event), state), start);
	const [stage, setStage] = useState(0);
	const delta = (type: string, contentIndex: number, extra = {}): RpcEvent => ({ type: "message_update", assistantMessageEvent: { type, contentIndex, ...extra } });
	const finishInline = (isError: boolean) => {
		send([
			{ type: "message_end", message: { role: "toolResult", toolCallId: "inline", name: "bash", content: isError ? "示例失败输出" : "行内工具完成", isError } },
			{ type: "message_start", message: { role: "assistant" } }, delta("text_delta", 0, { delta: secondReply }),
		]);
		setStage(5);
	};
	return <main className="process-folding-harness">
		<nav aria-label="流式事件控制">
			<Button disabled={stage !== 0} onClick={() => { send([delta("thinking_start", 0), delta("thinking_delta", 0, { delta: thinking })]); setStage(1); }}>追加思考</Button>
			<Button disabled={stage !== 1} onClick={() => {
				send([
					delta("thinking_end", 0), delta("toolcall_start", 1, { id: "one", toolName: "bash" }), delta("toolcall_delta", 1, { delta: '{"command":"pwd"}' }), delta("toolcall_end", 1),
					delta("toolcall_start", 2, { id: "two", toolName: "bash" }), delta("toolcall_delta", 2, { delta: '{"command":"node --version"}' }), delta("toolcall_end", 2),
					{ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking }, { type: "toolCall", id: "one", name: "bash", arguments: { command: "pwd" } }, { type: "toolCall", id: "two", name: "bash", arguments: { command: "node --version" } }] } },
					{ type: "message_end", message: { role: "toolResult", toolCallId: "two", name: "bash", content: "v24" } },
					{ type: "message_end", message: { role: "toolResult", toolCallId: "one", name: "bash", content: "D:/workspace/Skiff" } },
				]); setStage(2);
			}}>完成工具组</Button>
			<Button disabled={stage !== 2} onClick={() => { send([{ type: "message_start", message: { role: "assistant" } }, delta("text_start", 0), delta("text_delta", 0, { delta: firstReply })]); setStage(3); }}>开始正文</Button>
			<Button disabled={stage !== 3} onClick={() => {
				send([delta("text_end", 0), delta("thinking_start", 1), delta("thinking_delta", 1, { delta: "需要检查正文中的一个细节。" }), delta("toolcall_start", 2, { id: "inline", toolName: "bash" }), delta("toolcall_delta", 2, { delta: '{"command":"npm test"}' }), delta("toolcall_end", 2),
					{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: firstReply }, { type: "thinking", thinking: "需要检查正文中的一个细节。" }, { type: "toolCall", id: "inline", name: "bash", arguments: { command: "npm test" } }] } },
				]); setStage(4);
			}}>正文中调用工具</Button>
			<Button disabled={stage !== 4} onClick={() => finishInline(false)}>完成行内工具</Button>
			<Button disabled={stage !== 4} onClick={() => finishInline(true)}>行内工具失败</Button>
			<Button disabled={stage !== 5} onClick={() => {
				send([{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: secondReply }], stopReason: "stop", usage: { input: 100, output: 20, totalTokens: 120 } } }, { type: "agent_settled" }]); setStage(6);
			}}>完成本轮</Button>
			<Button disabled={stage !== 5} onClick={() => {
				send([{ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: secondReply }], stopReason: "error" } }, { type: "agent_settled" }]); setStage(6);
			}}>本轮运行失败</Button>
			<output aria-label="流式阶段">阶段 {stage}</output>
		</nav>
		<section className="chat"><MessageList messages={state.messages} running={state.isStreaming} activeTurnId={state.activeRun?.turnId} models={[model]} model={model} onSuggestion={noop} followSignal={0} /></section>
	</main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Harness /></StrictMode>);
