import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./ui";
import type { WorkbenchTool } from "../workbench/projectWorkbench";

// "files" is the explorer glyph, keeping the single folder for project groups in the
// sidebar; the git tool is named in Chinese like its siblings.
const tools: Array<{ id: WorkbenchTool; label: string; icon: IconName }> = [
	{ id: "chats", label: "对话", icon: "message" },
	{ id: "files", label: "文件", icon: "files" },
	{ id: "git-tree", label: "Git 历史", icon: "git" },
];

export function ActivityBar({ active, panelOpen, onSelect }: { active: WorkbenchTool; panelOpen: boolean; onSelect: (tool: WorkbenchTool) => void }) {
	const selected = active === "git" ? "files" : active;
	// The pressed state means "this tool is open", so a collapsed panel clears it; the
	// hint opens sideways because a 40px rail has no room for a bubble underneath.
	return <nav className="activity-bar" aria-label="工作区工具">{tools.map((tool) => <Tooltip key={tool.id} text={tool.label} side="right"><button className="activity-button" aria-label={tool.label} aria-pressed={selected === tool.id && panelOpen} aria-expanded={selected === tool.id && panelOpen} onClick={() => onSelect(tool.id)}><Icon name={tool.icon} size={18} /></button></Tooltip>)}</nav>;
}
