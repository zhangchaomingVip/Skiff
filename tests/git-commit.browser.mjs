import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/git-commit", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(10000);
const panel = () => page.locator(".git-panel");
const message = () => panel().getByRole("textbox", { name: "提交信息" });
const commit = () => panel().getByRole("button", { name: "Commit", exact: true });
const push = () => panel().getByRole("button", { name: "Commit and Push", exact: true });
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
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const result = await original(command, args);
				if (command === "get_project_git_status") return { ...result, entries: ["modified", "added", "untracked", "deleted", "renamed"].map((kind) => ({ path: `src/${kind}.ts`, kind, selectable: true, rollbackable: kind !== "untracked", indexStatus: kind === "added" ? "A" : " ", worktreeStatus: "M" })) };
				if (command === "commit_project_files") {
					if (window.commitMode === "reject") throw new Error("当前分支没有配置远程上游");
					if (window.commitMode === "defer") return new Promise((resolve) => { window.finishCommit = () => resolve(result); });
					if (window.commitMode === "push-failure") return { ...result, pushed: false, pushError: "推送失败，请检查网络" };
				}
				return result;
			};
		});
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
	await page.getByRole("tab", { name: "Commit", exact: true }).click();
		await panel().getByRole("button", { name: "刷新 Git 状态" }).click();
		await panel().locator('.git-file[data-kind="added"]').waitFor();
		assert.equal(await commit().isDisabled(), true);
		assert.equal(await push().isDisabled(), true);
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
		await page.evaluate(() => { window.commitMode = "reject"; });
		await push().click();
		await panel().getByRole("alert").filter({ hasText: "没有配置远程上游" }).waitFor();
		assert.equal(await message().inputValue(), "feat: update selected files");
		await page.evaluate(() => { window.commitMode = "defer"; });
		await push().click();
		await page.waitForFunction(() => window.finishCommit);
		assert.equal(await commit().isDisabled(), true); assert.equal(await push().isDisabled(), true);
		assert.equal(await message().isDisabled(), true);
		await page.evaluate(() => window.finishCommit());
		await panel().getByRole("status").filter({ hasText: "已提交并推送" }).waitFor();
		assert.equal(await message().inputValue(), "");
		assert.equal(await page.evaluate(() => window.skiffPreview.commands.findLast((item) => item.command === "commit_project_files").args.push), true);
		await selectAll(); await message().fill("push will fail");
		await page.evaluate(() => { window.commitMode = "push-failure"; });
		await push().click();
		await panel().getByRole("alert").filter({ hasText: "本地提交 a13fc921 已创建并保留" }).waitFor();
		assert.equal(await message().inputValue(), "");
		assert.equal(await panel().locator(".git-selected-count").innerText(), "已选 0 个文件");
		await selectAll(); await message().fill("local only");
		await page.evaluate(() => { window.commitMode = "success"; });
		await commit().click();
		await panel().getByRole("status").filter({ hasText: "已创建本地提交" }).waitFor();
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
	console.log("Commit UI: light/dark colors, selected counts, pending lock, local/push success, partial failure, draft retention and narrow layout passed.");
} finally { await browser.close(); }
