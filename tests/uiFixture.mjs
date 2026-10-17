import { seedPolishPreview } from "./polishFixture.mjs";

export const fixtures = ["launcher", "single", "multi", "unknown", "empty", "loading", "error", "chat", "long", "settings", "picker", "voyage", "voyage-output", "voyage-thinking", "voyage-fishing", "voyage-tool", "voyage-moored", "voyage-high", "authorization", "sidebar", "archive", "visual"];

// This entry runs only on the separate preview origin. It never uses real pi.
export function preparePreview(target) {
	const params = new URLSearchParams(target.location.search);
	const fixture = params.get("fixture") || "launcher";
	const storage = target.localStorage;
	const preservedPreferences = params.get("persist") === "1" ? ["skiff.sidebar.width", "skiff.voyage.width", "skiff.sidebar.recent-expanded", "skiff.theme"].map((key) => [key, storage.getItem(key)]).filter((entry) => entry[1] !== null) : [];
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
	} else if (["chat", "long", "picker", "voyage", "authorization", "visual"].includes(fixture) || fixture.startsWith("voyage-")) {
		seedPolishPreview(storage, fixture === "long");
		const sessions = JSON.parse(storage.getItem("skiff.test.sessions"));
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
		if (fixture === "visual") workspace.chats[0].routeSnapshots = sessions["polish-preview.jsonl"].filter((message) => message.role === "assistant").map((message) => message.routeSnapshot ?? null);
		workspace.chats[0].selectedModel = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
		storage.setItem("skiff.workspace.v1", JSON.stringify(workspace));
	} else {
		storage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "preview-project", name: "Skiff 示例项目", path: "D:\\workspace\\demo" }], chats: [{ id: "preview-chat", projectId: "preview-project", title: "新聊天", hasMessages: false, updatedAt: now }], activeId: "preview-chat" }));
	}
	return fixture;
}
