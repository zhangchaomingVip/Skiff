import { setThemePreference, useThemePreference } from "../theme";
import { Icon } from "./Icon";
import { IconButton, Tooltip } from "./ui";

const labels = { system: "跟随系统", light: "浅色", dark: "深色" };
export function ThemeToggle() {
	const theme = useThemePreference();
	return <Tooltip text={`主题：${labels[theme]} · 系统 → 浅色 → 深色`}><IconButton onClick={() => setThemePreference(theme === "system" ? "light" : theme === "light" ? "dark" : "system")} aria-label={`主题：${labels[theme]}，点击切换`}><Icon name={theme === "system" ? "monitor" : theme === "dark" ? "moon" : "sun"} size={16} /></IconButton></Tooltip>;
}
