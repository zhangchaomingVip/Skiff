export type SettingsCategory = "appearance" | "websearch" | "prompt" | "providers" | "models" | "routes" | "archives" | "shortcuts";

export const settingsCategories = [
	{ id: "appearance", label: "外观", icon: "sun" },
	{ id: "websearch", label: "联网搜索", icon: "search" },
	{ id: "prompt", label: "系统提示词", icon: "message" },
	{ id: "providers", label: "供应商", icon: "anchor" },
	{ id: "models", label: "模型", icon: "tokens" },
	{ id: "routes", label: "路线", icon: "flag" },
	{ id: "archives", label: "归档会话", icon: "archive" },
	{ id: "shortcuts", label: "快捷键", icon: "code" },
] as const;

export type SettingsRestrictions = Partial<Record<SettingsCategory, string>>;
export const isMacPlatform = () => /Mac|iPhone|iPad/.test(navigator.platform);
