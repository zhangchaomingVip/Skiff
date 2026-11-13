import type { WorkspaceMode } from "../workbench/workspaceMode";
import { Icon } from "./Icon";

/** The app's only mode switch: a segmented control in the title bar. The activity
 *  rail keeps its single job of picking a first-level view, so the two never light
 *  up side by side. Icon plus label reads faster than a lone glyph in a 40px strip. */
export function WorkspaceModeSwitcher({ mode, onChange }: { mode: WorkspaceMode; onChange: (mode: WorkspaceMode) => void }) {
	return <div className="workspace-mode-switcher" role="group" aria-label="工作模式">
		<button type="button" aria-label="Code 工作区" aria-pressed={mode === "code"} onClick={() => onChange("code")}><Icon name="code" size={14} /><span>Code</span></button>
		<button type="button" aria-label="Design 设计室" aria-pressed={mode === "design"} onClick={() => onChange("design")}><Icon name="palette" size={14} /><span>Design</span></button>
	</div>;
}
