import { seedPolishPreview } from "./polishFixture.mjs";

export const fixtures = ["launcher", "single", "multi", "unknown", "empty", "loading", "error", "chat", "long", "settings", "picker", "voyage", "authorization", "sidebar"];

// This entry runs only on the separate preview origin. It never uses real pi.
export function preparePreview(target) {
	const params = new URLSearchParams(target.location.search);
	const fixture = params.get("fixture") || "launcher";
	const storage = target.localStorage;
	for (let index = storage.length - 1; index >= 0; index--) {
		const key = storage.key(index);
		if (key?.startsWith("skiff.")) storage.removeItem(key);
	}
	const now = Date.parse("2026-10-09T04:00:00Z");
	if (params.get("static") === "1") {
		Date.now = () => now;
		document.documentElement.dataset.previewStatic = "true";
	}
	const theme = params.get("theme") || "system";
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
	} else if (["chat", "long", "picker", "voyage", "authorization"].includes(fixture)) {
		seedPolishPreview(storage, fixture === "long");
		const sessions = JSON.parse(storage.getItem("skiff.test.sessions"));
		for (const messages of Object.values(sessions)) messages.forEach((message, index) => {
			message.timestamp = now - 60000 + index * 1000;
			message.entryId = `preview-entry-${index}`;
			if (message.role === "assistant") { message.provider = "skiff-relay-r1-deepseek"; message.model = "deepseek-chat"; }
		});
		storage.setItem("skiff.test.sessions", JSON.stringify(sessions));
		const workspace = JSON.parse(storage.getItem("skiff.workspace.v1"));
		workspace.chats[0].selectedModel = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
		storage.setItem("skiff.workspace.v1", JSON.stringify(workspace));
	} else {
		storage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "preview-project", name: "Skiff 示例项目", path: "D:\\workspace\\demo" }], chats: [{ id: "preview-chat", projectId: "preview-project", title: "新聊天", hasMessages: false, updatedAt: now }], activeId: "preview-chat" }));
	}
	return fixture;
}
