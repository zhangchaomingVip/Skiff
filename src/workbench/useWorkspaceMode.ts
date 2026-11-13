import { useCallback, useEffect, useState } from "react";
import type { WorkbenchTool } from "./projectWorkbench";
import { readWorkspaceNavigation, selectWorkspaceTool, workspaceNavigationKey, type WorkspaceMode } from "./workspaceMode";

export function useWorkspaceMode() {
	const [navigation, setNavigation] = useState(() => readWorkspaceNavigation(localStorage));
	useEffect(() => {
		try { localStorage.setItem(workspaceNavigationKey, JSON.stringify(navigation)); }
		catch { /* Navigation remains usable without storage. */ }
	}, [navigation]);
	const setWorkspaceMode = useCallback((workspaceMode: WorkspaceMode) => setNavigation((current) => ({ ...current, workspaceMode })), []);
	const setActiveTool = useCallback((tool: WorkbenchTool) => setNavigation((current) => selectWorkspaceTool(current, tool)), []);
	const activeTool = navigation.workspaceMode === "code" ? navigation.codeTool : navigation.designTool;
	return { ...navigation, activeTool, setActiveTool, setWorkspaceMode };
}
