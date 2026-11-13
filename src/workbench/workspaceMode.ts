import type { FileWorkbenchTab, GenerationTool, WorkbenchTool } from "./projectWorkbench";

export type WorkspaceMode = "code" | "design";
export type CodeTool = "chats" | FileWorkbenchTab;
export interface WorkspaceNavigation {
	workspaceMode: WorkspaceMode;
	codeTool: CodeTool;
	designTool: GenerationTool;
}
export const workspaceNavigationKey = "skiff.workspace.navigation.v1";
const codeTools = ["chats", "files", "git", "git-tree"];

export function readWorkspaceNavigation(storage: Pick<Storage, "getItem">): WorkspaceNavigation {
	const fallback: WorkspaceNavigation = { workspaceMode: "code", codeTool: "chats", designTool: "image-generation" };
	try {
		const saved = JSON.parse(storage.getItem(workspaceNavigationKey) ?? "null");
		if (saved && (saved.workspaceMode === "code" || saved.workspaceMode === "design")) return {
			workspaceMode: saved.workspaceMode,
			codeTool: codeTools.includes(saved.codeTool) ? saved.codeTool : "chats",
			designTool: saved.designTool === "video-generation" ? "video-generation" : "image-generation",
		};
		const legacy = JSON.parse(storage.getItem("skiff.workbench.v1") ?? "null")?.tool;
		if (legacy === "image-generation" || legacy === "video-generation") return { ...fallback, workspaceMode: "design", designTool: legacy };
		if (codeTools.includes(legacy)) return { ...fallback, codeTool: legacy };
	} catch { /* Missing or damaged preferences use Code. */ }
	return fallback;
}

export function selectWorkspaceTool(current: WorkspaceNavigation, tool: WorkbenchTool): WorkspaceNavigation {
	return tool === "image-generation" || tool === "video-generation" ? { ...current, workspaceMode: "design", designTool: tool } : { ...current, workspaceMode: "code", codeTool: tool };
}
