// Blocking head entry shared by production and previews.
(() => {
	const root = document.documentElement;
	const media = matchMedia("(prefers-color-scheme: dark)");
	const valid = (value) => ["system", "light", "dark"].includes(value) ? value : "system";
	let preference = "system";
	try { preference = valid(localStorage.getItem("skiff.theme")); } catch { /* Optional storage. */ }
	const apply = () => {
		root.dataset.themePreference = preference;
		root.dataset.theme = preference === "system" ? media.matches ? "dark" : "light" : preference;
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
	media.addEventListener("change", () => { if (preference === "system") apply(); });
	window.addEventListener("storage", (event) => { if (event.key === "skiff.theme") { preference = valid(event.newValue); apply(); } });
	apply();
})();
