/** Drive the public mode switch before choosing a mode-specific activity. */
export function workbenchTool(page, name) {
	const locator = page.getByRole("navigation", { name: "工作区工具", exact: true }).getByRole("button", { name, exact: true });
	const click = locator.click.bind(locator);
	locator.click = async (options) => {
		const design = name === "生图" || name === "生成视频";
		const switcher = page.getByRole("button", { name: design ? "Design 设计室" : "Code 工作区", exact: true });
		const switched = await switcher.getAttribute("aria-pressed") !== "true";
		if (switched) {
			if (await page.locator("dialog[open][data-variant=drawer]").count()) await page.keyboard.press("Escape");
			await switcher.click();
		}
		if (!switched || await locator.getAttribute("aria-pressed") !== "true") await click(options);
		if (design && await page.getByRole("dialog", { name: "Design 导航", exact: true }).count()) await page.keyboard.press("Escape");
		if (design && !await page.locator(".generation-controls:visible").count()) await page.getByRole("button", { name: "创作参数", exact: true }).click();
	};
	return locator;
}
