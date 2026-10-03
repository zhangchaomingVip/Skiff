import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export function ThemeToggle() {
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		try {
			return (localStorage.getItem("skiff.theme") as "light" | "dark") || "dark";
		} catch {
			return "dark";
		}
	});

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		try {
			localStorage.setItem("skiff.theme", theme);
		} catch {
			// Theme preference is optional.
		}
	}, [theme]);

	const toggleTheme = () => {
		setTheme((current) => (current === "dark" ? "light" : "dark"));
	};

	return (
		<button
			className="icon-btn"
			onClick={toggleTheme}
			title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
			aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
		>
			<Icon name={theme === "dark" ? "sun" : "moon"} />
		</button>
	);
}
