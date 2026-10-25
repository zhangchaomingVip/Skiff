import { seedPolishPreview } from "./polishFixture.mjs";

export const fixtures = ["launcher", "single", "multi", "unknown", "empty", "loading", "error", "chat", "long", "settings", "settings-info", "picker", "voyage", "voyage-output", "voyage-thinking", "voyage-tool", "voyage-moored", "voyage-high", "authorization", "sidebar", "archive", "visual", "tool-spacing", "process-rows", "repeated-process", "process-folding", "process-actions", "file-discovery", "content-replay-a", "content-replay-b", "chat-polish-031"];

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
	} else if (["chat", "long", "picker", "voyage", "authorization", "visual", "tool-spacing", "process-rows", "repeated-process", "process-folding", "process-actions", "file-discovery", "content-replay-a", "content-replay-b", "chat-polish-031"].includes(fixture) || fixture.startsWith("voyage-")) {
		seedPolishPreview(storage, fixture === "long");
		const sessions = JSON.parse(storage.getItem("skiff.test.sessions"));
		if (fixture === "content-replay-a") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "验证旁白、多工具和尾段正文同时可见。" },
			{ role: "assistant", content: [
				{ type: "text", text: "旁白 A：先运行命令并搜索资料，随后读取说明文件。" },
				{ type: "toolCall", id: "replay-a-bash", name: "bash", arguments: { command: "pwd" } },
				{ type: "toolCall", id: "replay-a-web", name: "web_search", arguments: { query: "Skiff 文档" } },
				{ type: "toolCall", id: "replay-a-read", name: "read", arguments: { path: "README.md" } },
			] },
			{ role: "toolResult", toolCallId: "replay-a-bash", name: "bash", content: "D:/workspace/Skiff" },
			{ role: "toolResult", toolCallId: "replay-a-web", name: "web_search", content: "找到文档" },
			{ role: "toolResult", toolCallId: "replay-a-read", name: "read", content: "说明文件正文" },
			{ role: "assistant", content: "尾段正文 A：三种工具的结果都已核对，完整回答保留在这里。", stopReason: "length" },
		];
		if (fixture === "content-replay-b") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "验证正文中间穿插旁白和工具。" },
			{ role: "assistant", content: [
				{ type: "text", text: "首段正文 B：先说明本轮的检查目标。" },
				{ type: "thinking", thinking: "核对第一阶段的输入和结果，保持内容顺序。" },
				{ type: "toolCall", id: "replay-b-read", name: "read", arguments: { path: "README.md" } },
				{ type: "text", text: "中段旁白 B：接下来同时运行命令并搜索资料。" },
				{ type: "toolCall", id: "replay-b-bash", name: "bash", arguments: { command: "pwd" } },
				{ type: "toolCall", id: "replay-b-web", name: "web_search", arguments: { query: "Skiff 文档" } },
				{ type: "text", text: "尾段正文 B：所有阶段均完成，文字保持原样。" },
			] },
			{ role: "toolResult", toolCallId: "replay-b-read", name: "read", content: "说明文件正文" },
			{ role: "toolResult", toolCallId: "replay-b-bash", name: "bash", content: "D:/workspace/Skiff" },
			{ role: "toolResult", toolCallId: "replay-b-web", name: "web_search", content: "找到文档" },
			{ role: "assistant", content: "", stopReason: "length" },
		];
		if (fixture === "file-discovery") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "汇总思考、读取、编辑、命令和联网搜索；grep、find 计入命令。" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "先查找说明文件，再列举目录、读取正文，最后演示编辑结果。" },
				{ type: "text", text: "先检查文件和目录，再读取、编辑，并搜索相关内容。" },
				{ type: "thinking", thinking: "先查找说明文件，再列举目录、读取正文，最后演示编辑结果。" },
				{ type: "toolCall", id: "discover-web", name: "web_search", arguments: { query: "示例项目说明" } },
				{ type: "toolCall", id: "discover-glob", name: "glob", arguments: { pattern: "**/SKILL.md", path: "." } },
				{ type: "toolCall", id: "discover-ls", name: "ls", arguments: { path: "skills" } },
				{ type: "toolCall", id: "discover-read", name: "read", arguments: { path: "skills/demo/SKILL.md" } },
				{ type: "toolCall", id: "discover-read-again", name: "read", arguments: { path: "skills/demo/SKILL.md" } },
				{ type: "toolCall", id: "discover-write", name: "write", arguments: { path: "notes.md", content: "待检查" } },
				{ type: "toolCall", id: "discover-edit", name: "edit", arguments: { path: "notes.md", oldText: "待检查", newText: "检查完成" } },
				{ type: "toolCall", id: "discover-bash", name: "bash", arguments: { command: "pwd" } },
				{ type: "toolCall", id: "discover-grep", name: "grep", arguments: { pattern: "示例", path: "skills" } },
			] },
			{ role: "toolResult", toolCallId: "discover-web", name: "web_search", content: "示例搜索服务暂不可用", isError: true },
			{ role: "toolResult", toolCallId: "discover-glob", name: "glob", content: "skills/demo/SKILL.md\nskills/other/SKILL.md" },
			{ role: "toolResult", toolCallId: "discover-ls", name: "ls", content: "demo/\nother/" },
			{ role: "toolResult", toolCallId: "discover-read", name: "read", content: "# 示例技能\n这是技能说明的正文。" },
			{ role: "toolResult", toolCallId: "discover-read-again", name: "read", content: "# 示例技能\n这是技能说明的正文。" },
			{ role: "toolResult", toolCallId: "discover-write", name: "write", content: "已写入 notes.md" },
			{ role: "toolResult", toolCallId: "discover-edit", name: "edit", content: "已更新 notes.md" },
			{ role: "toolResult", toolCallId: "discover-bash", name: "bash", content: "D:/workspace/Skiff" },
			{ role: "toolResult", toolCallId: "discover-grep", name: "grep", content: "skills/demo/SKILL.md:1:# 示例技能" },
			{ role: "assistant", content: "检查完成。同一文件读取两次计为 2，写入和编辑合并计为 2；grep、查找文件、列目录和 bash 共计 4 条命令。web_search 单独显示为联网搜索，失败次数保留在对应类别旁。", stopReason: "stop" },
		];
		if (fixture === "process-actions") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "检查项目说明与设置入口，确认读取失败时的展示效果。" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "先梳理项目约定，再读取相关文件，核对设置入口。".repeat(90) },
				{ type: "text", text: "先读取项目说明和设置文件，再搜索设置入口。" },
				{ type: "toolCall", id: "action-read-1", name: "read", arguments: { path: "skills/README.md" } },
				{ type: "toolCall", id: "action-read-2", name: "read", arguments: { path: "src/settings.ts" } },
				{ type: "toolCall", id: "action-search", name: "grep", arguments: { pattern: "Settings", path: "src" } },
			] },
			{ role: "toolResult", toolCallId: "action-read-1", name: "read", content: "项目使用 React 和 TypeScript。" },
			{ role: "toolResult", toolCallId: "action-read-2", name: "read", content: "文件不存在：src/settings.ts", isError: true },
			{ role: "toolResult", toolCallId: "action-search", name: "grep", content: "src/components/Settings.tsx" },
			{ role: "assistant", content: "找到了设置入口：`src/components/Settings.tsx`。其中一个候选路径不存在，读取失败已标在对应动作旁，详细输出保留在折叠组内。", stopReason: "stop", usage: { input: 1000, output: 120, totalTokens: 1120 } },
		];
		if (fixture === "repeated-process" || fixture === "process-folding") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "检查命令连续执行时的展示效果。" },
			...Array.from({ length: 12 }, (_, round) => [
				{ role: "assistant", content: [
					{ type: "thinking", thinking: `第 ${round + 1} 轮先分析上一次的结果，再选择接下来的检查命令。\n保留每轮思考与工具详情供展开查看。` },
					...[0, 1].map((call) => ({ type: "toolCall", id: `repeat-${round}-${call}`, name: "bash", arguments: { command: call ? "node --version" : "pwd" } })),
				] },
				...[0, 1].map((call) => ({ role: "toolResult", toolCallId: `repeat-${round}-${call}`, toolName: "bash", isError: round === 8 && call === 1, content: round === 8 && call === 1 ? "示例失败：命令不可用。" : "检查完成。" })),
			]).flat(),
			{ role: "assistant", content: "检查结束。连续过程已归纳成一行，展开后可查看每轮的命令、思考和输出。", stopReason: "stop", durationMs: 15000, usage: { input: 4096, output: 234, totalTokens: 4330 } },
		];
		if (fixture === "process-folding") {
			sessions["polish-preview.jsonl"].pop();
			sessions["polish-preview.jsonl"].push(
				{ role: "assistant", content: "### 先给结论\n\n首个正文之前的 12 轮过程已汇总在上方，回答默认可见。" },
				{ role: "assistant", content: [
					{ type: "thinking", thinking: "接下来核对正文中的细节，再继续给出说明。" },
					{ type: "toolCall", id: "inline-check", name: "bash", arguments: { command: "npm test" } },
				] },
				{ role: "toolResult", toolCallId: "inline-check", name: "bash", content: "所有检查通过。" },
				{ role: "assistant", content: "### 检查结果\n\n正文之间的工具调用以一行注脚展示。展开只推开后文，轮首计数保持不变。", stopReason: "stop", durationMs: 15000, usage: { input: 4096, output: 234, totalTokens: 4330 } },
			);
		}
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
		if (fixture === "chat-polish-031") sessions["polish-preview.jsonl"] = [
			{ role: "user", content: "展示命令动作摘要、结构化结果卡片和新的排版层级。" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "先并行查看目录、运行测试并检查仓库状态，再演示高风险命令的标题保留。" },
				{ type: "toolCall", id: "p31-ls", name: "bash", arguments: { command: "ls -la" } },
				{ type: "toolCall", id: "p31-ls2", name: "bash", arguments: { command: "cd packages/app && ls" } },
				{ type: "toolCall", id: "p31-test", name: "bash", arguments: { command: "npm test" } },
				{ type: "toolCall", id: "p31-git", name: "bash", arguments: { command: "git status" } },
				{ type: "toolCall", id: "p31-rm", name: "bash", arguments: { command: "rm -rf dist/cache" } },
				{ type: "toolCall", id: "p31-pipe", name: "bash", arguments: { command: "cat package.json | head -20" } },
			] },
			{ role: "toolResult", toolCallId: "p31-ls", name: "bash", content: "src/\npackage.json" },
			{ role: "toolResult", toolCallId: "p31-ls2", name: "bash", content: "demo/\nREADME.md" },
			{ role: "toolResult", toolCallId: "p31-test", name: "bash", content: "all tests passed" },
			{ role: "toolResult", toolCallId: "p31-git", name: "bash", content: "nothing to commit, working tree clean" },
			{ role: "toolResult", toolCallId: "p31-rm", name: "bash", content: "" },
			{ role: "toolResult", toolCallId: "p31-pipe", name: "bash", isError: true, content: "npm error Missing script" },
			{ role: "assistant", content: "命令折叠行现在显示确定性动作摘要，展开后保留完整命令、工作目录、退出状态和输出。" },
			{ role: "user", content: "单独修改一个文件，看看单文件结果卡。" },
			{ role: "assistant", content: [
				{ type: "thinking", thinking: "先更新说明文件，再演示单文件卡片。" },
				{ type: "toolCall", id: "p31-write", name: "write", arguments: { path: "docs/preview.md", content: "# 预览" } },
			] },
			{ role: "toolResult", toolCallId: "p31-write", name: "write", content: "已写入 docs/preview.md" },
			{ role: "assistant", content: "### 单文件修改\n\n结果卡片出现在正文之后、操作栏之前，只展示真实数据。" },
			{ role: "user", content: "再修改三个文件并删除两个，看看聚合卡和删除卡。" },
			{ role: "assistant", content: [
				{ type: "toolCall", id: "p31-edit-a", name: "edit", arguments: { path: "src/App.tsx", oldText: "const width = 800;", newText: "const width = 900;" } },
				{ type: "toolCall", id: "p31-edit-b", name: "edit", arguments: { path: "src/components/MessageItem.tsx", oldText: "const ready = false;", newText: "const ready = true;" } },
				{ type: "toolCall", id: "p31-edit-c", name: "edit", arguments: { path: "src/chat/toolRuns.ts", oldText: "export function toolRunSummary", newText: "export function toolRunSummaryV2" } },
			] },
			{ role: "toolResult", toolCallId: "p31-edit-a", name: "edit", content: "ok", details: { diff: "-const width = 800;\n+const width = 900;" } },
			{ role: "toolResult", toolCallId: "p31-edit-b", name: "edit", content: "ok", details: { diff: "-const ready = false;\n+const ready = true;\n+trackReady();" } },
			{ role: "toolResult", toolCallId: "p31-edit-c", name: "edit", content: "ok", details: { diff: "-export function toolRunSummary\n+export function toolRunSummaryV2" } },
			{ role: "assistant", content: "### 多文件修改\n\n多个文件聚合为一张卡，展开后查看每个文件的完整路径和增删行数。" },
			{ role: "assistant", content: [
				{ type: "toolCall", id: "p31-del-a", name: "delete", arguments: { path: "tmp/old-cache.json" } },
				{ type: "toolCall", id: "p31-del-b", name: "delete", arguments: { path: "tmp/stale-report.log" } },
			] },
			{ role: "toolResult", toolCallId: "p31-del-a", name: "delete", content: "removed" },
			{ role: "toolResult", toolCallId: "p31-del-b", name: "delete", content: "removed" },
			{ role: "assistant", content: [
				{ type: "text", text: "### 汇总\n\n- 删除结果卡显示数量和可展开清单，没有 diff 数据就不显示增删行数\n- 纯问答不渲染结果卡片\n\n| 区域 | 状态 |\n| --- | --- |\n| 命令折叠行 | 已更新 |\n| 结果卡片 | 已更新 |" },
			], usage: { input: 4096, cacheRead: 512, cacheWrite: 0, output: 234, totalTokens: 4842 }, durationMs: 32000 },
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
