import { Icon, type IconName } from "./Icon";
import { Tooltip } from "./ui";
import { isFileWorkbenchTab, type GenerationTool, type WorkbenchTool } from "../workbench/projectWorkbench";
import type { WorkspaceMode } from "../workbench/workspaceMode";
import { isMacPlatform } from "./settingsNavigation";

// The file tool uses a tree glyph: the plain and open folders belong to project rows
// in the sidebar, and the old stacked-pages glyph read as "copy". File browsing,
// commits and history share the file panel.
const tools: Array<{ id: "chats" | "files" | GenerationTool; label: string; icon: IconName }> = [
	{ id: "chats", label: "对话", icon: "chatBubble" },
	{ id: "files", label: "文件", icon: "folderTree" },
	{ id: "image-generation", label: "生图", icon: "imageSpark" },
	{ id: "video-generation", label: "生成视频", icon: "video" },
];

export function ActivityBar({ mode, active, panelOpen, settingsOpen = false, onSelect, onOpenSettings }: { mode: WorkspaceMode; active: WorkbenchTool; panelOpen: boolean; settingsOpen?: boolean; onSelect: (tool: WorkbenchTool) => void; onOpenSettings: () => void }) {
	const selected = isFileWorkbenchTab(active) ? "files" : active;
	// While settings own the workspace only the gear is current; no tool behind it lights up.
	const toolOpen = (id: string) => !settingsOpen && selected === id && panelOpen;
	// The pressed state means "this tool is open", so a collapsed panel clears it; the
	// hint opens sideways because the narrow rail has no room for a bubble underneath.
	// Preferences anchor to the foot of the rail, always reachable even when the panel is closed.
	// Only one thing here can ever look selected: the mode lives in the title bar.
	return <nav className="activity-bar" aria-label="工作区工具">
		{tools.filter((tool) => mode === "code" ? tool.id === "chats" || tool.id === "files" : tool.id === "image-generation" || tool.id === "video-generation").map((tool) => <Tooltip key={tool.id} text={toolOpen(tool.id) ? `收起侧栏（${isMacPlatform() ? "Cmd" : "Ctrl"}+B）` : tool.label} side="right"><button className="activity-button" aria-label={tool.label} aria-current={!settingsOpen && selected === tool.id ? "page" : undefined} aria-pressed={toolOpen(tool.id)} aria-expanded={toolOpen(tool.id)} onClick={() => onSelect(tool.id)}><Icon name={tool.icon} size={18} /></button></Tooltip>)}
		<div className="activity-footer"><Tooltip text={`设置（${isMacPlatform() ? "Cmd" : "Ctrl"}+,）`} side="right"><button className="activity-button settings-trigger" aria-label="设置" aria-pressed={settingsOpen} onClick={onOpenSettings}><Icon name="settings" size={18} /></button></Tooltip></div>
	</nav>;
}
