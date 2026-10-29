import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
const output = new URL("../dist/project-git/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const workspace = () => page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")));
const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
const chooseProject = async (name) => {
	await page.getByRole("button", { name: /^浏览项目：/ }).click();
	await page.getByRole("dialog", { name: "选择浏览项目", exact: true }).getByRole("option", { name, exact: true }).click();
};
const addFolder = async (path) => {
	await page.getByRole("button", { name: /^浏览项目：/ }).click();
	await page.getByRole("button", { name: "新建项目", exact: true }).click();
	await page.evaluate((path) => window.skiffPreview.setDialogPath(path), path);
	await page.getByRole("button", { name: "添加源文件夹", exact: true }).click();
	return page.getByRole("dialog", { name: "创建项目", exact: true });
};

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=project-limit&theme=${theme}`);
		const legacy = page.getByRole("dialog", { name: "整理项目列表" });
		await legacy.waitFor();
		const before = await workspace();
		assert.equal(before.projects.length, 6);
		assert.equal(await legacy.getByRole("button", { name: "移出所选项目" }).isDisabled(), true);
		await legacy.getByRole("radio", { name: /emptyForTest/ }).check();
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-limit.png`, output)), animations: "disabled" });
		await legacy.getByRole("button", { name: "移出所选项目" }).click();
		await legacy.waitFor({ state: "hidden" });
		await tool("文件").click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.locator(".git-file").first().waitFor();
		await page.getByRole("button", { name: /^浏览项目：/ }).click();
		assert.equal(await page.getByRole("option").count(), 5);
		await page.keyboard.press("Escape");

		// Canceling replacement must not hide the selected project.
		let dialog = await addFolder("D:\\workspace\\new-project");
		assert.equal(await dialog.getByRole("button", { name: "移出并创建项目" }).isDisabled(), true);
		await dialog.getByRole("radio", { name: /aiagent/ }).check();
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-replace.png`, output)), animations: "disabled" });
		await dialog.getByRole("button", { name: "取消", exact: true }).click();
		assert.equal((await workspace()).projects.find((item) => item.name === "aiagent").hiddenAt, undefined);

		dialog = await addFolder("D:\\workspace\\new-project");
		await dialog.getByRole("radio", { name: /aiagent/ }).check();
		await dialog.getByRole("button", { name: "移出并创建项目" }).click();
		await dialog.waitFor({ state: "hidden" });
		const replaced = await workspace();
		assert.equal(replaced.projects.filter((item) => item.hiddenAt === undefined).length, 5);
		assert.ok(replaced.projects.find((item) => item.name === "aiagent").hiddenAt);
		for (const chat of before.chats) assert.equal(replaced.chats.find((item) => item.id === chat.id)?.sessionFile, chat.sessionFile);
		assert.equal(await page.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "delete_session_file").length), 0);

		// Picking an already-listed folder consumes no slot or replacement.
		dialog = await addFolder("D:\\workspace\\Skiff");
		assert.equal(await dialog.getByRole("radio").count(), 0);
		await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
		assert.equal((await workspace()).projects.filter((item) => item.hiddenAt === undefined).length, 5);
		await chooseProject("Skiff");

		// Override the preview transport, keeping its normal command recording.
		await page.evaluate(() => {
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.testGitMode = "local";
			window.testGitVersion = "1";
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const value = await original(command, args);
				if (command !== "get_project_git_status") return value;
				if (args.root.endsWith("cc-switch") && window.testGitMode === "local") throw new Error("无法识别 Git 仓库：fatal: not a git repository (or any of the parent directories): .git");
				if (args.root.endsWith("cc-switch") && window.testGitMode === "error") throw new Error("Git permission denied");
				return { ...value, repositoryRoot: args.root, version: window.testGitVersion, entries: [...value.entries, { path: `change-${window.testGitVersion}.ts`, kind: "modified", selectable: true, rollbackable: true }] };
			};
			window.skiffPreview.commands.length = 0;
			window.dispatchEvent(new Event("focus"));
		});
		await page.waitForFunction(() => window.skiffPreview.commands.filter((item) => item.command === "get_project_git_status").length === 5);
		await chooseProject("cc-switch");
		await page.getByText("Local project", { exact: true }).waitFor();
		assert.equal(await page.locator(".git-panel [role=alert]").count(), 0);
		assert.equal(await page.getByRole("textbox", { name: "提交信息" }).count(), 0);
		await page.screenshot({ path: fileURLToPath(new URL(`${theme}-local.png`, output)), animations: "disabled" });
		await page.evaluate(() => { window.testGitMode = "error"; });
		await page.getByRole("button", { name: "刷新 Git 状态" }).click();
		await page.getByRole("alert").filter({ hasText: "Git permission denied" }).waitFor();
		await page.evaluate(() => { window.testGitMode = "git"; });
		await page.getByRole("button", { name: "刷新 Git 状态" }).click();
		await page.getByRole("textbox", { name: "提交信息" }).waitFor();

		// An agent's completed edit updates its project while another project is visible.
		await page.evaluate(() => {
			window.testGitVersion = "2";
			window.skiffPreview.commands.length = 0;
			const instanceId = [...window.skiffPreview.processes].find(([, session]) => session.file === "sidebar-skiff-chat-0.jsonl")?.[0];
			if (!instanceId) throw new Error("Expected Skiff runtime");
			window.skiffPreview.emit(instanceId, { type: "message_end", message: { role: "toolResult", toolCallId: "edit-test", toolName: "edit", content: [{ type: "text", text: "Updated file" }] } });
		});
		await page.waitForFunction(() => window.skiffPreview.commands.some((item) => item.command === "get_project_git_status" && item.args.root.endsWith("Skiff")));
		assert.equal(await page.getByRole("button", { name: /^浏览项目：/ }).innerText(), "cc-switch");
		await chooseProject("Skiff");
		await page.locator(".git-file", { hasText: "change-2.ts" }).waitFor();
		await page.locator(".git-file", { hasText: "change-2.ts" }).click();
		await page.locator(".diff-preview").waitFor();
		await page.evaluate(() => { window.testGitVersion = "3"; window.skiffPreview.commands.length = 0; window.dispatchEvent(new Event("focus")); });
		await page.waitForFunction(() => window.skiffPreview.commands.some((item) => item.command === "get_project_git_diff"));
	}
	await page.setViewportSize({ width: 600, height: 680 });
	await page.goto(`${origin}/tests/preview.html?fixture=project-limit&theme=dark`);
	const narrow = page.getByRole("dialog", { name: "整理项目列表" });
	await narrow.waitFor();
	const bounds = await narrow.boundingBox();
	assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 600 && bounds.y >= 0 && bounds.y + bounds.height <= 680);
	await page.screenshot({ path: fileURLToPath(new URL("narrow-limit.png", output)), animations: "disabled" });

	// Virtual time proves polling continues with the sidebar closed, at five minutes.
	const timed = await browser.newPage();
	await timed.clock.install();
	await timed.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
	await timed.waitForFunction(() => window.skiffPreview?.commands.filter((item) => item.command === "get_project_git_status").length >= 3);
	await timed.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	await timed.clock.fastForward(1500);
	await timed.getByRole("button", { name: "收起侧栏", exact: true }).click();
	const initial = await timed.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "get_project_git_status").length);
	await timed.clock.fastForward(4 * 60_000);
	assert.equal(await timed.evaluate(() => window.skiffPreview.commands.filter((item) => item.command === "get_project_git_status").length), initial);
	await timed.clock.fastForward(60_000);
	await timed.waitForFunction((initial) => window.skiffPreview.commands.filter((item) => item.command === "get_project_git_status").length === initial + 3, initial);
	await timed.close();
	assert.deepEqual(errors, []);
	console.log("Project limit/replacement, preserved chats, local-project state, AI edits, Diff refresh and five-minute closed-sidebar polling passed in light/dark.");
} finally {
	await browser.close();
}
