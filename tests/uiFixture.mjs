import { seedPolishPreview } from "./polishFixture.mjs";

export const fixtures = ["launcher", "single", "multi", "unknown", "empty", "loading", "error", "chat", "long", "settings", "settings-info", "picker", "voyage", "voyage-output", "voyage-thinking", "voyage-fishing", "voyage-tool", "voyage-moored", "voyage-high", "authorization", "sidebar", "archive", "visual", "tool-spacing", "process-rows"];

// This entry runs only on the separate preview origin. It never uses real pi.
export function preparePreview(target) {
	const params = new URLSearchParams(target.location.search);
	const fixture = params.get("fixture") || "launcher";
	const storage = target.localStorage;
	const preservedPreferences = params.get("persist") === "1" ? ["skiff.sidebar.width", "skiff.voyage.width", "skiff.sidebar.recent-expanded", "skiff.family-models.v1", "skiff.theme", "skiff.typography.v1", "skiff.test.metadata.v1", "skiff.settings.providers-view.v1"].map((key) => [key, storage.getItem(key)]).filter((entry) => entry[1] !== null) : [];
	for (let index = storage.length - 1; index >= 0; index--) {
		const key = storage.key(index);
		if (key?.startsWith("skiff.")) storage.removeItem(key);
	}
	for (const [key, value] of preservedPreferences) storage.setItem(key, value);
	const now = Date.parse("2026-10-09T04:00:00Z");
	if (params.get("static") === "1") {
		Date.now = () => now;
		document.documentElement.dataset.previewStatic = "true";
	}
	const theme = params.get("theme") || storage.getItem("skiff.theme") || "system";
	storage.setItem("skiff.theme", theme);
	document.documentElement.dataset.theme = theme === "system" ? target.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : theme;
	storage.setItem("skiff.sidebar.open", String(target.innerWidth > 760));
	if (fixture === "sidebar") {
		const projects = [
			{ id: "sidebar-skiff", name: "Skiff", path: "D:\\workspace\\Skiff" },
			{ id: "sidebar-aiagent", name: "aiagent", path: "D:\\workspace\\aiagent" },
			{ id: "sidebar-empty", name: "cc-switch", path: "D:\\workspace\\cc-switch" },
		];
		const titles = ["固定模型配置弹窗尺寸", "实现009 UI系统加固需求", "澄清006范围与字段权威", "对比Skiff与cc-switch页面", "回应问候"];
		const chats = projects.flatMap((project, projectIndex) => Array.from({ length: [22, 6, 0][projectIndex] }, (_, index) => ({
			id: `${project.id}-chat-${index}`, projectId: project.id,
			title: projectIndex === 0 && index < titles.length ? titles[index] : `${project.name} 任务 ${index + 1}`,
			customTitle: true, sessionFile: `${project.id}-chat-${index}.jsonl`,
			hasMessages: true, updatedAt: now - (projectIndex * 30 + index) * 60000,
		})));
		storage.setItem("skiff.test.sessions", JSON.stringify(Object.fromEntries(chats.map((chat) => [chat.sessionFile, [{ role: "user", content: chat.title }, { role: "assistant", content: "预览任务已完成。" }]]))));
		storage.setItem("skiff.sidebar.collapsed", JSON.stringify(projects.map((project) => project.id)));
		storage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects, chats, activeId: chats[0].id }));
	} else if (fixture === "archive") {
		const project = { id: "archive-project", name: "Skiff Archive", path: "D:\\workspace\\Skiff" };
		const otherProject = { id: "archive-other", name: "Other Project", path: "D:\\workspace\\aiagent" };
		const chats = [
			{ id: "archive-active", projectId: project.id, title: "当前会话", sessionFile: "archive-active.jsonl", hasMessages: true, updatedAt: now - 5000 },
			{ id: "archive-candidate", projectId: project.id, title: "同项目候选", sessionFile: "archive-candidate.jsonl", hasMessages: true, updatedAt: now - 2000 },
			{ id: "archive-other-chat", projectId: otherProject.id, title: "其他项目会话", sessionFile: "archive-other.jsonl", hasMessages: true, updatedAt: now - 3000 },
			{ id: "archive-record", projectId: project.id, title: "已归档会话", sessionFile: "archive-record.jsonl", hasMessages: true, updatedAt: now - 4000, archivedAt: now - 300 },
			{ id: "archive-empty", projectId: project.id, title: "空白归档", hasMessages: false, updatedAt: now - 5000, archivedAt: now - 200 },
			{ id: "archive-missing", projectId: otherProject.id, title: "缺失文件归档", sessionFile: "missing-archive.jsonl", hasMessages: true, updatedAt: now - 6000, archivedAt: now - 100 },
		];
		const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
		const assistant = (text) => ({ role: "assistant", provider: "skiff-relay-r1-deepseek", model: "deepseek-chat", content: [{ type: "thinking", thinking: "检查历史上下文" }, { type: "toolCall", id: "archive-tool", name: "read", arguments: { path: "README.md" } }, { type: "toolResult", toolCallId: "archive-tool", name: "read", content: "工具输出" }, { type: "text", text }] });
		storage.setItem("skiff.test.sessions", JSON.stringify({
			"archive-active.jsonl": [user("当前会话"), assistant("当前回答")],
			"archive-candidate.jsonl": [user("同项目候选"), assistant("候选回答")],
			"archive-other.jsonl": [user("另一个项目的提问"), assistant("另一个项目的回答")],
			"archive-record.jsonl": [user("已归档会话"), { ...assistant("归档回答"), content: [{ type: "thinking", thinking: "先梳理归档会话中的项目上下文，再对照保存的工具输出检查相关文件内容。\n最后结合历史消息解释当时的处理步骤与结论。" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }, { type: "toolCall", id: "archive-tool", name: "read", arguments: { path: "README.md" } }, { type: "toolResult", toolCallId: "archive-tool", name: "read", content: "归档工具输出" }, { type: "text", text: "归档回答" }] }],
		}));
		for (const chat of chats) if (chat.hasMessages) chat.selectedModel = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
		storage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [project, otherProject], chats, activeId: "archive-active" }));
	} else if (["chat", "long", "picker", "voyage", "authorization", "visual", "tool-spacing", "process-rows"].includes(fixture) || fixture.startsWith("voyage-")) {
		seedPolishPreview(storage, fixture === "long");
		const sessions = JSON.parse(storage.getItem("skiff.test.sessions"));
		if (fixture === "process-rows") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "先检查环境，再写入与编辑文件，最后验证工具结果。" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "先用三条命令检查目录、工作路径和运行环境。\n随后写入一个文件、编辑另一个文件，确认工具摘要区分文件数和调用次数。\n".repeat(52) },
				...["ls", "pwd", "node --version"].map((command, index) => ({ type: "toolCall", id: `process-bash-${index}`, name: "bash", arguments: { command } })),
			] },
			...["Skiff", "D:/workspace/Skiff", "v24.19.0"].map((content, index) => ({ role: "toolResult", toolCallId: `process-bash-${index}`, toolName: "bash", content })),
			{ role: "assistant", content: [
				{ type: "text", text: "环境检查完成，接下来更新两个文件。" },
				{ type: "toolCall", id: "process-write", name: "write", arguments: { path: "notes.md", content: "# 工具检查\n" } },
				{ type: "toolCall", id: "process-edit", name: "edit", arguments: { path: "src/App.tsx", oldText: "const ready = false;", newText: "const ready = true;" } },
			] },
			{ role: "toolResult", toolCallId: "process-write", toolName: "write", content: "已写入 notes.md" },
			{ role: "toolResult", toolCallId: "process-edit", toolName: "edit", content: "已更新 src/App.tsx" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "两个文件已经更新，接下来读取并再次编辑同一个文件。\n这一组应分别显示读取一个文件和修改一个文件，避免把两次调用误写成两个文件。" },
				{ type: "toolCall", id: "process-read", name: "read", arguments: { path: "notes.md" } },
				{ type: "toolCall", id: "process-edit-note", name: "edit", arguments: { path: "notes.md", oldText: "# 工具检查", newText: "# 检查完成" } },
				{ type: "toolCall", id: "process-mixed-command", name: "bash", arguments: { command: "node scripts/check-tools.mjs --verify-output --include-command-details --theme light --theme dark --report tool-check.json" } },
			] },
			{ role: "toolResult", toolCallId: "process-read", toolName: "read", content: "# 工具检查" },
			{ role: "toolResult", toolCallId: "process-edit-note", toolName: "edit", content: "已更新 notes.md" },
			{ role: "toolResult", toolCallId: "process-mixed-command", toolName: "bash", content: "混合工具摘要应分别显示文件数量和命令条数。" },
			{ role: "assistant", content: [{ type: "toolCall", id: "process-check", name: "bash", arguments: { command: "node scripts/check-tools.mjs --verify-output --include-command-details --theme light --theme dark --report tool-check.json" } }] },
			{ role: "toolResult", toolCallId: "process-check", toolName: "bash", isError: true, content: "演示失败状态：检查脚本不存在。" },
			{ role: "assistant", content: "失败的命令保留输入与输出，可展开复盘。回复已截断，可继续检查。", durationMs: 15000, stopReason: "length" },
		];
		if (fixture === "tool-spacing") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "检查对话页面，收紧工具调用之间的间距。" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "先检查消息列表、工具摘要与正文样式，确认哪些父级间距和子元素外边距发生叠加。\n再检查连续工具步骤、空的结束消息以及折叠后的布局。" },
				{ type: "text", text: "我继续读关键文件。" },
				{ type: "toolCall", id: "spacing-read", name: "read", arguments: { path: "src/components/MessageItem.tsx" } },
				{ type: "toolCall", id: "spacing-command", name: "bash", arguments: { command: "node scripts/inspect-chat-layout.mjs --include-thinking --include-tool-results --check-collapsed-height --theme light --theme dark --report layout-spacing.json" } },
			] },
			{ role: "toolResult", toolCallId: "spacing-read", toolName: "read", content: "已读取消息组件。" },
			{ role: "toolResult", toolCallId: "spacing-command", toolName: "bash", content: "检查了消息与工具之间的间距。" },
			{ role: "assistant", content: [{ type: "toolCall", id: "spacing-next", name: "bash", arguments: { command: "node scripts/inspect-chat-layout.mjs --include-thinking --include-tool-results --check-collapsed-height --theme light --theme dark --report layout-spacing.json" } }] },
			{ role: "toolResult", toolCallId: "spacing-next", toolName: "bash", isError: true, content: "示例错误：保留完整命令和输出供展开检查。" },
			{ role: "assistant", content: "" },
			{ role: "assistant", content: "### 检查完成\n\n正文与工具步骤使用一致的间距，连续调用默认折叠。\n\n- 长命令保持单行，展开后查看全文\n- 空消息不再占用正文高度\n\n> 复制与线路、用量、费用和时间排列在同一底栏。\n\n```css\n.stack { gap: 8px; }\n```" },
			{ role: "assistant", content: "", usage: { input: 4096, cacheRead: 0, cacheWrite: 0, output: 234, totalTokens: 4330 }, durationMs: 2000 },
		];
		if (fixture === "visual") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "检查仪表盘的读数、主题与窄屏布局。" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "先核对指针的实际旋转中心与扫掠范围，再检查浅色和深色主题下的刻度、边框与文字对比度。\n最后验证窄屏换行、键盘折叠和用量明细。" },
				{ type: "toolCall", id: "visual-read", name: "read", arguments: { path: "src/components/VoyageRail.tsx" } },
			] },
			{ role: "toolResult", toolCallId: "visual-read", toolName: "read", content: "已读取仪表组件。" },
			{ role: "assistant", content: "### 检查完成\n\n读数已移出指针扫掠区域。船、波浪与航程保留，刻度在两种主题下均清晰可读。\n\n- 指针与中心保持连接\n- 过程信息可通过键盘折叠\n- Token 与费用明细可展开查看", usage: { input: 73, cacheRead: 1917, cacheWrite: 0, output: 190, totalTokens: 2180 }, durationMs: 3000,
				routeSnapshot: { providerKey: "skiff-relay-r1-deepseek", familyId: "deepseek", familyName: "DeepSeek", relayId: "r1", modelId: "deepseek-chat", relayName: "官方直连", billingAccountId: "演示账户", currency: "CNY", inputCost: .3, outputCost: 1.2, cacheReadCost: .3, cacheWriteCost: .3 } },
		];
		for (const messages of Object.values(sessions)) messages.forEach((message, index) => {
			message.timestamp = now - 60000 + index * 1000;
			message.entryId = `preview-entry-${index}`;
			if (message.role === "assistant") { message.provider = "skiff-relay-r1-deepseek"; message.model = "deepseek-chat"; }
			if (fixture === "tool-spacing" && message.role === "assistant") {
				message.usage ??= { input: 128, cacheRead: 512, cacheWrite: 0, output: message.content ? 32 : 0, totalTokens: message.content ? 672 : 640 };
				message.routeSnapshot = { providerKey: message.provider, familyId: "deepseek", familyName: "DeepSeek", relayId: "r1", modelId: message.model, relayName: "官方直连", billingAccountId: "演示账户", currency: "CNY", inputCost: 2, outputCost: 4, cacheReadCost: .2, cacheWriteCost: 2 };
			}
		});
		if (fixture.startsWith("voyage-")) for (const messages of Object.values(sessions)) {
			const last = messages.findLast((message) => message.role === "assistant");
			if (last) {
				last.usage = { input: fixture === "voyage-high" ? 121590 : 25000, cacheRead: 0, cacheWrite: 0, output: 10, totalTokens: fixture === "voyage-high" ? 121600 : 25010 };
				last.durationMs = 2000;
			}
		}
		storage.setItem("skiff.test.sessions", JSON.stringify(sessions));
		const workspace = JSON.parse(storage.getItem("skiff.workspace.v1"));
		if (fixture === "visual" || fixture === "tool-spacing") workspace.chats[0].routeSnapshots = sessions["polish-preview.jsonl"].filter((message) => message.role === "assistant").map((message) => message.routeSnapshot ?? null);
		workspace.chats[0].selectedModel = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
		storage.setItem("skiff.workspace.v1", JSON.stringify(workspace));
	} else {
		storage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "preview-project", name: "Skiff 示例项目", path: "D:\\workspace\\demo" }], chats: [{ id: "preview-chat", projectId: "preview-project", title: "新聊天", hasMessages: false, updatedAt: now }], activeId: "preview-chat" }));
	}
	return fixture;
}
