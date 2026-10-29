// Blocking head entry shared by production and previews.
(() => {
	const root = document.documentElement;
	const media = matchMedia("(prefers-color-scheme: dark)");
	const valid = (value) => ["system", "light", "dark"].includes(value) ? value : "system";
	// Missing, invalid and retired "default" values resolve to the new mode defaults.
	const validColor = (value) => ["purple", "yellow", "green", "blue"].includes(value) ? value : "yellow";
	const validDarkColor = (value) => ["star-black", "star-blue"].includes(value) ? value : "star-blue";
	const validStars = (value) => value !== false && value !== "false";
	let preference = "system";
	let color = "yellow";
	let darkColor = "star-blue";
	let stars = true;
	try {
		preference = valid(localStorage.getItem("skiff.theme"));
		color = validColor(localStorage.getItem("skiff.themeColor"));
		darkColor = validDarkColor(localStorage.getItem("skiff.darkThemeColor"));
		stars = validStars(localStorage.getItem("skiff.themeStars"));
	} catch { /* Optional storage. */ }
	const apply = () => {
		root.dataset.themePreference = preference;
		root.dataset.theme = preference === "system" ? media.matches ? "dark" : "light" : preference;
		root.dataset.themeColor = color;
		root.dataset.darkThemeColor = darkColor;
		root.dataset.themeStars = String(stars);
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
	window.addEventListener("skiff:dark-theme-color-request", (event) => {
		darkColor = validDarkColor(event.detail);
		try { localStorage.setItem("skiff.darkThemeColor", darkColor); } catch { /* Works in memory. */ }
		apply();
	});
	window.addEventListener("skiff:theme-stars-request", (event) => {
		stars = validStars(event.detail);
		try { localStorage.setItem("skiff.themeStars", String(stars)); } catch { /* Works in memory. */ }
		apply();
	});
	media.addEventListener("change", () => { if (preference === "system") apply(); });
	window.addEventListener("storage", (event) => {
		if (event.key === "skiff.theme") { preference = valid(event.newValue); apply(); }
		if (event.key === "skiff.themeColor") { color = validColor(event.newValue); apply(); }
		if (event.key === "skiff.darkThemeColor") { darkColor = validDarkColor(event.newValue); apply(); }
		if (event.key === "skiff.themeStars") { stars = validStars(event.newValue); apply(); }
	});
	apply();
})();
