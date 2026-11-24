import type { WorkspaceMode } from "../workbench/workspaceMode";

/** The app's only mode switch: a segmented control in the title bar. The activity
 *  rail keeps its single job of picking a first-level view, so the two never light
 *  up side by side. Labels only: two words need no glyphs, and `</>` was also the old
 *  shortcuts icon. */
export function WorkspaceModeSwitcher({ mode, onChange }: { mode: WorkspaceMode; onChange: (mode: WorkspaceMode) => void }) {
	return <div className="workspace-mode-switcher" role="group" aria-label="工作模式">
		<button type="button" aria-label="代码工作区" aria-pressed={mode === "code"} onClick={() => onChange("code")}><span>代码</span></button>
		<button type="button" aria-label="设计工作区" aria-pressed={mode === "design"} onClick={() => onChange("design")}><span>设计</span></button>
	</div>;
}
