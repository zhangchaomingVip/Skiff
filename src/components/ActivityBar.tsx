import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./ui";
import type { WorkbenchTool } from "../workbench/projectWorkbench";

const tools: Array<{ id: WorkbenchTool; label: string; icon: IconName }> = [
	{ id: "chats", label: "会话", icon: "message" },
	{ id: "files", label: "文件", icon: "folder" },
	{ id: "git", label: "Git", icon: "git" },
];

export function ActivityBar({ active, panelOpen, onSelect }: { active: WorkbenchTool; panelOpen: boolean; onSelect: (tool: WorkbenchTool) => void }) {
	return <nav className="activity-bar" aria-label="工作区工具">{tools.map((tool) => <Tooltip key={tool.id} text={tool.label} align="start"><button className="activity-button" aria-label={tool.label} aria-pressed={active === tool.id && panelOpen} onClick={() => onSelect(tool.id)}><Icon name={tool.icon} size={18} /></button></Tooltip>)}</nav>;
}
