import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { testImage } from "./imageFixture.mjs";

export async function verifyWorkspaceModes(page, generationDir, artifacts, modelId) {
	const root = join(dirname(generationDir), "design-project"); await mkdir(root, { recursive: true });
	await page.evaluate((root) => {
		const workspace = JSON.parse(localStorage.getItem("skiff.workspace.v1"));
		workspace.projects.push({ id: "p-design-cdp", name: "设计联动验证", path: root });
		workspace.chats.push({ id: "c-design-cdp", projectId: "p-design-cdp", title: "设计联动", createdAt: Date.now(), updatedAt: Date.now(), hasMessages: false });
		workspace.activeId = "c-design-cdp";
		localStorage.setItem("skiff.workspace.v1", JSON.stringify(workspace));
		localStorage.setItem("skiff.workspace.navigation.v1", JSON.stringify({ workspaceMode: "design", codeTool: "chats", designTool: "image-generation" }));
		localStorage.setItem("skiff.design.collections.v1", JSON.stringify({ image: "all", video: "all" }));
	}, root);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.locator(".design-workspace:not([hidden])").waitFor();
	const card = page.locator(".design-gallery-route:not([hidden]) .generation-card:not(.generation-pending-card)").first();
	await card.getByRole("button", { name: /^更多作品操作/ }).click();
	await page.getByRole("menuitem", { name: "保存至当前项目", exact: true }).click();
	await page.getByRole("button", { name: "在 Code 中查看", exact: true }).waitFor();
	let paths = await page.evaluate((root) => window.__TAURI_INTERNALS__.invoke("list_project_directory", { root, path: "assets" }), root);
	assert.equal(paths.entries.length, 1); assert.deepEqual(await readFile(join(root, "assets", paths.entries[0].name)), testImage());
	// A repeated save creates a new file, preserving the first original.
	await card.getByRole("button", { name: /^更多作品操作/ }).click();
	await page.getByRole("menuitem", { name: "保存至当前项目", exact: true }).click();
	await page.getByRole("button", { name: "在 Code 中查看", exact: true }).waitFor();
	paths = await page.evaluate((root) => window.__TAURI_INTERNALS__.invoke("list_project_directory", { root, path: "assets" }), root);
	assert.equal(paths.entries.length, 2);
	await page.getByRole("button", { name: "在 Code 中查看", exact: true }).click();
	assert.equal(await page.getByRole("button", { name: "Code 工作区", exact: true }).getAttribute("aria-pressed"), "true");
	await page.locator(".code-workspace .project-preview").waitFor();
	// Design is a closed studio: no project picker, no Code column and no archive sync.
	await page.getByRole("button", { name: "Design 设计室", exact: true }).click();
	assert.equal(await page.getByRole("complementary", { name: "Design 导航", exact: true }).getByRole("combobox").count(), 0, "Design binds no Code project");
	assert.equal(await page.getByRole("navigation", { name: "设计资产分组", exact: true }).getByRole("button", { name: /^来自 Code/ }).count(), 0, "No Code collection");
	assert.equal(await page.getByRole("button", { name: "同步项目图片", exact: true }).count(), 0, "No project image sync");
	await page.screenshot({ path: join(artifacts, "workspace-modes-cdp.png"), animations: "disabled" });
	await page.reload({ waitUntil: "domcontentloaded" });
	assert.equal(await page.getByRole("button", { name: "Design 设计室", exact: true }).getAttribute("aria-pressed"), "true");
	assert.equal(await page.getByRole("button", { name: "返回对话", exact: true }).count(), 0);
	await page.getByRole("button", { name: "Code 工作区", exact: true }).click();
	console.log("PASS real workspace modes: Studio → isolated project saves, collision-safe copies, real preview routing and a studio that never mirrors Code images");
}
