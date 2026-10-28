// Blocking head entry shared by production and previews.
(() => {
	const root = document.documentElement;
	const media = matchMedia("(prefers-color-scheme: dark)");
	const valid = (value) => ["system", "light", "dark"].includes(value) ? value : "system";
	const validColor = (value) => ["default", "purple", "yellow", "green", "blue"].includes(value) ? value : "default";
	let preference = "system";
	let color = "default";
	try {
		preference = valid(localStorage.getItem("skiff.theme"));
		color = validColor(localStorage.getItem("skiff.themeColor"));
	} catch { /* Optional storage. */ }
	const apply = () => {
		root.dataset.themePreference = preference;
		root.dataset.theme = preference === "system" ? media.matches ? "dark" : "light" : preference;
		root.dataset.themeColor = color;
		root.style.colorScheme = root.dataset.theme;
		root.dataset.themeChanging = "true";
		requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeChanging));
		window.dispatchEvent(new Event("skiff:theme-changed"));
	};
	window.addEventListener("skiff:theme-request", (event) => {
		preference = valid(event.detail);
		try { localStorage.setItem("skiff.theme", preference); } catch { /* Works in memory. */ }
		apply();
	});
	window.addEventListener("skiff:theme-color-request", (event) => {
		color = validColor(event.detail);
		try { localStorage.setItem("skiff.themeColor", color); } catch { /* Works in memory. */ }
		apply();
	});
	media.addEventListener("change", () => { if (preference === "system") apply(); });
	window.addEventListener("storage", (event) => {
		if (event.key === "skiff.theme") { preference = valid(event.newValue); apply(); }
		if (event.key === "skiff.themeColor") { color = validColor(event.newValue); apply(); }
	});
	apply();
})();
