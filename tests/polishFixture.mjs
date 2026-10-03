
export const polishText = [
	"## 聊天页面优化\n\n现在可以更清晰地阅读回复、检查工具输出和继续迭代。",
	"### 本次调整\n\n1. **Markdown** 支持嵌套列表\n   - 段落、引用和任务列表\n   - 代码复制与折叠\n2. 工具调用与结果配对\n\n> 工具出错时，会保留命令和输出供排查。",
	"| 能力 | 状态 |\n| --- | --- |\n| 流式回复 | 已支持 |\n| 图片与文本附件 | 已支持 |\n\n- [x] 代码复制\n- [ ] 下一轮检查\n\n---",
	"```typescript\n// 发送新消息后跟随到底部\nconst send = async (text: string) => {\n\tconst accepted = await onSend(text);\n\tif (accepted) scrollToBottom();\n};\n```",
	"### 长代码示例\n\n```text\n" + Array.from({ length: 32 }, (_, i) => `line ${i + 1}: scroll and keyboard behavior`).join("\n") + "\n```",
].join("\n\n");

export function seedPolishPreview(storage, long = false) {
	const messages = long ? Array.from({ length: 150 }, (_, index) => [
		{ role: "user", content: `检查第 ${index + 1} 个模块` },
		{ role: "assistant", content: [{ type: "text", text: `### 模块 ${index + 1}\n\n已检查模块边界。\n\n- 输入验证\n- 错误处理\n- 清理资源` }] },
	]).flat() : [
		{ role: "user", content: [{ type: "text", text: "优化聊天页面，并验证工具结果。" }, { type: "image", mimeType: "image/png", data: "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" }] },
		{ role: "assistant", content: [
			{ type: "thinking", thinking: "先检查现有交互，再验证边界情况。" },
			{ type: "thinking", thinking: "工具调用与结果需要按调用 ID 配对，否则流式输出时乱序返回的结果会贴到错误的卡片上。先把 toolCall 与 toolResult 合并成一张卡片，再按阅读 / 编辑 / 命令分类折叠成一行，避免连续调用刷屏。" },
			{ type: "toolCall", id: "read", name: "read", arguments: { path: "src/App.tsx" } },
			{ type: "toolCall", id: "glob", name: "glob", arguments: { pattern: "src/**/*.tsx" } },
			{ type: "toolCall", id: "bash", name: "bash", arguments: { command: "npm run check" } },
			{ type: "toolCall", id: "edit", name: "edit", arguments: { path: "src/App.tsx", oldText: "const width = 800;", newText: "const width = 900;" } },
		] },
		{ role: "toolResult", toolCallId: "bash", toolName: "bash", isError: true, content: [{ type: "text", text: "npm error Missing script: check\n请运行 npm run build" }] },
		{ role: "toolResult", toolCallId: "read", toolName: "read", content: [{ type: "text", text: "export default function App() { /* ... */ }" }] },
		{ role: "toolResult", toolCallId: "glob", toolName: "glob", content: [{ type: "text", text: "src/App.tsx\nsrc/components/MessageItem.tsx" }] },
		{ role: "toolResult", toolCallId: "edit", toolName: "edit", content: [{ type: "text", text: "Successfully replaced text." }], details: { diff: "- 1 const width = 800;\n+ 1 const width = 900;" } },
		{ role: "assistant", model: "configured-model", provider: "configured-provider", content: [{ type: "text", text: polishText }], usage: { input: 90000, cacheRead: 760000, cacheWrite: 0, output: 6000, totalTokens: 856000, cost: { total: .12 } }, durationMs: 46000, timestamp: Date.now() },
	];
	storage.setItem("skiff.test.sessions", JSON.stringify({ "polish-preview.jsonl": messages }));
	storage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "preview-project", name: "Skiff", path: "D:\\workspace\\Skiff" }], chats: [{ id: "preview-chat", projectId: "preview-project", title: long ? "长会话 · 300 条消息" : "聊天页面优化", hasMessages: true, sessionFile: "polish-preview.jsonl", updatedAt: Date.now() }], activeId: "preview-chat" }));
}
