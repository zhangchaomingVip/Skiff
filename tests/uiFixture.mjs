import { seedPolishPreview } from "./polishFixture.mjs";

export const fixtures = ["launcher", "single", "multi", "unknown", "empty", "loading", "error", "chat", "long", "settings", "picker", "voyage", "authorization"];

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
	if (["chat", "long", "picker", "voyage", "authorization"].includes(fixture)) {
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
