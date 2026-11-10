import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/git-commit", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const panel = () => page.locator(".git-panel");
const message = () => panel().getByRole("textbox", { name: "提交信息" });
const commit = () => panel().getByRole("button", { name: "Commit", exact: true });
const push = () => panel().getByRole("button", { name: "Commit and Push", exact: true });
const confirmation = () => page.getByRole("dialog", { name: "Push Commit", exact: true });
const confirmPush = async () => {
	await push().click();
	await confirmation().getByRole("button", { name: "Push", exact: true }).click();
	await confirmation().waitFor({ state: "hidden" });
};
const selectAll = async () => {
	await panel().getByRole("checkbox", { name: "选择全部 Changes", exact: true }).check();
	await panel().getByRole("checkbox", { name: "选择全部 Unversioned Files", exact: true }).check();
};

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => {
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.commitMode = "success";
			window.commitAttempts = 0;
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				if (command === "commit_project_files") window.commitAttempts++;
				if (command === "commit_project_files" && window.commitMode === "defer") {
					window.sendProgress = (progress) => args.onProgress.onmessage(progress);
					return new Promise((resolve) => { window.finishCommit = async () => resolve(await original(command, args)); });
				}
				if (command === "commit_project_files" && window.commitMode === "reject") throw new Error("当前分支没有配置远程上游");
				const result = await original(command, args);
				if (command === "get_project_git_status") return { ...result, entries: ["modified", "added", "untracked", "deleted", "renamed"].map((kind) => ({ path: `src/${kind}.ts`, kind, selectable: true, rollbackable: kind !== "untracked", indexStatus: kind === "added" ? "A" : " ", worktreeStatus: "M" })) };
				if (command === "commit_project_files") {
					if (window.commitMode === "push-failure") return { ...result, pushed: false, pushError: "推送失败，请检查网络" };
				}
				return result;
			};
		});
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await page.locator(".workbench-header").getByRole("button", { name: "刷新 Git 状态" }).click();
		await panel().locator('.git-file[data-kind="added"]').waitFor();
		assert.equal(await commit().isDisabled(), true);
		assert.equal(await push().isDisabled(), true);
		await page.screenshot({ path: `dist/git-commit/${theme}-disabled.png`, animations: "disabled" });
		for (const [kind, token] of [["modified", "--git-modified"], ["added", "--color-success"], ["untracked", "--danger"]]) {
			const colors = await panel().locator(`.git-file[data-kind=${kind}] > span:nth-child(2)`).evaluate((element, token) => {
				const probe = document.createElement("span"); probe.style.color = `var(${token})`; element.append(probe);
				const colors = [getComputedStyle(element).color, getComputedStyle(probe).color]; probe.remove(); return colors;
			}, token);
			assert.equal(colors[0], colors[1], `${theme}: ${kind} filename color`);
		}
		await selectAll();
		assert.equal(await panel().locator(".git-selected-count").innerText(), "已选 5 个文件");
		assert.deepEqual(await panel().locator(".git-change-counts span").allTextContents(), ["2 added", "1 modified", "1 deleted", "1 renamed"]);
		await message().fill("feat: update selected files");
		await page.mouse.move(1100, 700);
		await page.screenshot({ path: `dist/git-commit/${theme}.png`, animations: "disabled" });
		await push().click();
		await confirmation().getByRole("heading", { name: "Push Commit", exact: true }).waitFor();
		assert.deepEqual(await confirmation().locator(".git-path-endpoint").allTextContents(), ["codex/project-workbench", "origin/main"]);
		assert.match(await confirmation().innerText(), /所选 5 个文件/);
		assert.equal(await page.evaluate(() => window.commitAttempts), 0, "Opening confirmation must not commit or push");
		await page.screenshot({ path: `dist/git-commit/${theme}-confirmation.png`, animations: "disabled" });
		await confirmation().getByRole("button", { name: "Cancel", exact: true }).click();
		await confirmation().waitFor({ state: "hidden" });
		assert.equal(await message().inputValue(), "feat: update selected files");
		assert.equal(await panel().locator(".git-selected-count").innerText(), "已选 5 个文件");
		await push().click();
		await confirmation().waitFor();
		await page.keyboard.press("Escape");
		await confirmation().waitFor({ state: "hidden" });
		assert.equal(await page.evaluate(() => window.commitAttempts), 0, "Cancel and Escape must not invoke the write command");
		await page.evaluate(() => { window.commitMode = "reject"; });
		await confirmPush();
		await panel().getByRole("alert").filter({ hasText: "没有配置远程上游" }).waitFor();
		assert.equal(await message().inputValue(), "feat: update selected files");
		await page.evaluate(() => { window.commitMode = "defer"; });
		await confirmPush();
		await page.waitForFunction(() => window.finishCommit);
		assert.equal(await commit().isDisabled(), true); assert.equal(await push().isDisabled(), true);
		assert.equal(await message().isDisabled(), true);
		await panel().getByRole("status").filter({ hasText: "正在校验…" }).waitFor();
		await page.evaluate(() => window.sendProgress({ stage: "committed", commit: "abc1234" }));
		await panel().getByRole("status").filter({ hasText: /^已提交 abc1234$/ }).waitFor();
		await page.evaluate(() => window.sendProgress({ stage: "pushing", commit: "abc1234" }));
		await panel().getByRole("status").filter({ hasText: "已提交 abc1234 → 正在推送…" }).waitFor();
		await page.screenshot({ path: `dist/git-commit/${theme}-pushing.png`, animations: "disabled" });
		await page.evaluate(() => window.finishCommit());
		await panel().getByRole("status").filter({ hasText: "已提交并推送" }).waitFor();
		assert.equal(await message().inputValue(), "");
		await page.evaluate(() => window.sendProgress({ stage: "checking" }));
		assert.equal(await panel().getByRole("status").filter({ hasText: "正在校验" }).count(), 0);
		assert.equal(await page.evaluate(() => window.skiffPreview.commands.findLast((item) => item.command === "commit_project_files").args.push), true);
		await selectAll(); await message().fill("push will fail");
		await page.evaluate(() => { window.commitMode = "push-failure"; });
		await confirmPush();
		await panel().getByRole("alert").filter({ hasText: "本地提交 a13fc921 已创建并保留" }).waitFor();
		assert.equal(await message().inputValue(), "");
		assert.equal(await panel().locator(".git-selected-count").innerText(), "已选 0 个文件");
		await selectAll(); await message().fill("local only");
		await page.evaluate(() => { window.commitMode = "success"; });
		await message().press("Control+Enter");
		await panel().getByRole("status").filter({ hasText: "已创建本地提交" }).waitFor();
		assert.equal(await confirmation().count(), 0, "Local Commit remains a single-step action");
		assert.equal(await page.evaluate(() => window.skiffPreview.commands.findLast((item) => item.command === "commit_project_files").args.push), false);
	}
	await page.setViewportSize({ width: 600, height: 680 });
	await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=light`);
	await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
	await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
	await page.getByRole("tab", { name: "Commit", exact: true }).click();
	await selectAll(); await message().fill("narrow layout");
	assert.equal(await panel().evaluate((element) => element.scrollWidth <= element.clientWidth), true);
	await page.screenshot({ path: "dist/git-commit/narrow.png", animations: "disabled" });
	await push().click();
	await confirmation().waitFor();
	const bounds = await confirmation().boundingBox();
	assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 600 && bounds.y >= 0 && bounds.y + bounds.height <= 680);
	await page.screenshot({ path: "dist/git-commit/narrow-confirmation.png", animations: "disabled" });
	await confirmation().getByRole("button", { name: "Cancel", exact: true }).click();
	assert.deepEqual(errors, []);
	console.log("Commit UI: light/dark, Push confirmation/cancel/Escape, pending progress, local/push success, partial failure, draft retention and narrow layout passed.");
} finally { await browser.close(); }
