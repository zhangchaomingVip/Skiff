export type SettingsCategory = "appearance" | "prompt" | "models" | "archives" | "shortcuts";

export const settingsCategories = [
	{ id: "appearance", label: "外观", icon: "sun" },
	{ id: "prompt", label: "系统提示词", icon: "message" },
	{ id: "models", label: "模型与提供商", icon: "tokens" },
	{ id: "archives", label: "归档会话", icon: "archive" },
	{ id: "shortcuts", label: "快捷键", icon: "code" },
] as const;

export type SettingsRestrictions = Partial<Record<SettingsCategory, string>>;
export const isMacPlatform = () => /Mac|iPhone|iPad/.test(navigator.platform);
