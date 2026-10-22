import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MessageList } from "../src/components/MessageList";
import { ModelFamilyContext } from "../src/chat/familyContext";
import { parseMessages } from "../src/chat/parse";
import "../src/tokens.css";
import "../src/index.css";
import "../src/components/ui.css";

const root = createRoot(document.getElementById("root"));
const noop = () => {};
const model = { provider: "mock", id: "mock", currency: "CNY", cost: { input: 1, output: 2 } };
window.turnUsageHarness = {
	render({ messages, models = [model], current = model, ...props }) {
		const parsed = parseMessages(messages).map((message) => ({ ...message, routeSnapshot: messages[Number(message.id.replace("history_", ""))]?.routeSnapshot }));
		root.render(React.createElement(StrictMode, null,
			React.createElement(ModelFamilyContext.Provider, { value: { models, current, familyOf: noop, manage: noop } },
				React.createElement(MessageList, {
					messages: parsed, running: false, models, model: current,
					onSuggestion: noop, followSignal: 0, ...props,
				})),
		));
	},
};

// Interactive fixtures for narration deduplication, thinking and settled summaries.
if (new URLSearchParams(location.search).get("fixture") === "process-summary") {
	document.documentElement.dataset.theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
	const narration = "目录里有三个文件，接下来逐个检查它们的内容，并核对项目说明、配置文件和现有测试，确认后续操作的范围与顺序。";
	const user = { role: "user", content: "检查项目文件并说明接下来的操作。" };
	const call = { type: "toolCall", id: "summary-read", name: "read", arguments: { path: "README.md" } };
	const assistant = { role: "assistant", content: [{ type: "text", text: `**${narration}**\n第二行旁白保留在正文中。` }, call] };
	const result = { role: "toolResult", toolCallId: call.id, name: "read", content: "文件内容已读取。" };
	const nextThinking = { role: "assistant", content: [{ type: "thinking", thinking: "继续核对" }] };
	const nextReply = { role: "assistant", content: "文件检查完成，继续核对下一项。" };
	const scenarios = {
		"初始等待": { messages: [user], running: true },
		"空消息等待": { messages: [user, { role: "assistant", content: [] }], running: true },
		"工具执行": { messages: [user, assistant], running: true },
		"旁白等待": { messages: [user, assistant, result], running: true },
		"继续思考": { messages: [user, assistant, result, nextThinking], running: true },
		"后续正文": { messages: [user, assistant, result, nextThinking, nextReply], running: true },
		"思考摘要": { messages: [user, { role: "assistant", content: [{ type: "thinking", thinking: `**${narration}**\n更多推理细节。` }, call] }], running: true },
		"思考内容": { messages: [user, { role: "assistant", content: [{ type: "thinking", thinking: `**${narration}**\n更多推理细节。` }] }], running: true },
		"多行思考": { messages: [user, { role: "assistant", content: [{ type: "thinking", thinking: "The user wants me to:\n1. Review the project files\n2. Then build a small project and verify it.\n\nIdeas:\n- Generate ASCII art\n- Create a small game" }] }], running: true },
		"短思考": { messages: [user, { role: "assistant", content: [{ type: "thinking", thinking: "核对配置" }] }], running: true },
		"完成": { messages: [user, assistant, result, { role: "assistant", content: "检查完成，项目说明和配置文件均可正常读取。", stopReason: "stop" }] },
		"纯正文": { messages: [user, { role: "assistant", content: "直接回答，无需工具或思考过程。", stopReason: "stop" }] },
		"空回复失败": { messages: [user, { role: "assistant", content: [], stopReason: "error" }], lastOutcome: { turnId: "turn:history_0", reason: "error" } },
	};
	function SummaryPreview() {
		const [scenario, setScenario] = React.useState("旁白等待");
		const { messages, running = false, ...props } = scenarios[scenario];
		return React.createElement("div", { style: { height: "100vh", display: "flex", flexDirection: "column" } },
			React.createElement("nav", { "aria-label": "摘要场景", style: { display: "flex", flexWrap: "wrap", gap: 8, padding: 12 } }, Object.keys(scenarios).map((name) => React.createElement("button", { key: name, className: "ui-button", "aria-pressed": scenario === name, onClick: () => setScenario(name) }, name))),
			React.createElement("section", { className: "chat", style: { minHeight: 0 } }, React.createElement(MessageList, { messages: parseMessages(messages), running, activeTurnId: "turn:history_0", models: [model], model, onSuggestion: noop, followSignal: 0, ...props })),
		);
	}
	root.render(React.createElement(StrictMode, null, React.createElement(SummaryPreview)));
}
