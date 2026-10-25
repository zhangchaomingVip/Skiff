import type { ToolKind } from "../chat/toolRuns";
import type { IconName } from "./Icon";

/** One icon per tool category: read/write/delete get distinct glyphs, as in Codex. */
export const TOOL_ICONS: Record<ToolKind, IconName> = {
	read: "file",
	write: "edit",
	delete: "trash",
	find: "search",
	list: "folder",
	command: "terminal",
	search: "search",
	web: "search",
	other: "wrench",
};
