export type SettingsCategory = "appearance" | "chat" | "providers" | "prompt" | "websearch" | "browser" | "images" | "videos" | "statistics" | "archives" | "about";

// Order here is the order inside each navigation group.
export const settingsCategories = [
	{ id: "appearance", label: "外观", icon: "palette" },
	{ id: "chat", label: "对话", icon: "spark" },
	{ id: "providers", label: "供应商", icon: "anchor" },
	{ id: "prompt", label: "系统提示词", icon: "message" },
	{ id: "websearch", label: "联网搜索", icon: "search" },
	{ id: "browser", label: "AI 浏览器", icon: "monitor" },
	{ id: "images", label: "图片生成", icon: "imageSpark" },
	{ id: "videos", label: "视频生成", icon: "video" },
	{ id: "statistics", label: "对话统计", icon: "chart" },
	{ id: "archives", label: "已归档对话", icon: "archive" },
	{ id: "about", label: "关于", icon: "info" },
] as const;

export type SettingsRestrictions = Partial<Record<SettingsCategory, string>>;
export const isMacPlatform = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** Precise, in-dialog destination; never persisted as a routing preference. */
export type SettingsLocation = { familyId?: string; relayId?: string; modelId?: string };
