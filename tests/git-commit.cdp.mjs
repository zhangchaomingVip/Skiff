import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

// Uses app.cdp.mjs's temporary directory and storage snapshot/restore boundary.
export async function verifyGitCommit(page, temporaryRoot, artifacts) {
	const root = join(temporaryRoot, "commit-repo");
	const remote = join(temporaryRoot, "commit-remote.git");
	await mkdir(root);
	const execute = promisify(execFile);
	const git = async (...args) => (await execute("git", args, { cwd: root, windowsHide: true })).stdout.trim();
	const remoteHead = async () => (await execute("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"], { windowsHide: true })).stdout.trim();
	await git("init", "-q", "-b", "main");
	await git("config", "user.name", "CDP Commit"); await git("config", "user.email", "cdp@example.invalid");
	await writeFile(join(root, "selected.txt"), "base\n"); await writeFile(join(root, "other.txt"), "base\n");
	await git("add", "."); await git("commit", "-qm", "Base fixture");
	await execute("git", ["clone", "--bare", root, remote], { windowsHide: true });
	await git("remote", "add", "origin", remote); await git("fetch", "origin"); await git("branch", "--set-upstream-to", "origin/main");
	const base = await remoteHead();
	await writeFile(join(root, "selected.txt"), "selected change\n"); await writeFile(join(root, "other.txt"), "unrelated staged change\n");
	await git("add", "other.txt");
	await page.evaluate((root) => {
		localStorage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "commit-project", name: "Commit fixture", path: root }], chats: [{ id: "commit-chat", projectId: "commit-project", title: "Commit", updatedAt: Date.now(), hasMessages: false }], activeId: "commit-chat" }));
		localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "chats" })); localStorage.setItem("skiff.sidebar.open", "true");
	}, root);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
	await page.getByRole("tab", { name: "Commit", exact: true }).click();
	const preloadDeadline = Date.now() + 15000;
	while (!await page.evaluate(async (root) => {
		const cacheModule = performance.getEntriesByType("resource").find((entry) => entry.name.includes("/src/workbench/projectDiffCache.ts"))?.name;
		if (!cacheModule) return false;
		const { projectDiffCache } = await import(cacheModule);
		return projectDiffCache.get(root, "selected.txt")?.content?.includes("+selected change");
	}, root)) {
		assert.ok(Date.now() < preloadDeadline, "Native Diff preloading did not complete");
		await page.waitForTimeout(100);
	}
	await page.getByRole("button", { name: "查看 Diff：selected.txt", exact: true }).click();
	await page.locator(".diff-preview", { hasText: "+selected change" }).waitFor();
	const panel = page.locator(".git-panel");
	const message = panel.getByRole("textbox", { name: "提交信息" });
	await panel.getByRole("checkbox", { name: "选择 selected.txt", exact: true }).check();
	await message.fill("Local selected commit");
	await panel.getByRole("button", { name: "Commit", exact: true }).click();
	await panel.getByRole("status").filter({ hasText: "已创建本地提交" }).waitFor();
	assert.equal(await remoteHead(), base);
	assert.equal(await git("diff", "--cached", "--name-only"), "other.txt");
	assert.equal(await git("show", "HEAD:other.txt"), "base");
	await writeFile(join(root, "new.txt"), "new file to push\n");
	await panel.getByRole("button", { name: "刷新 Git 状态", exact: true }).click();
	await panel.getByRole("checkbox", { name: "选择 new.txt", exact: true }).check();
	await message.fill("Commit and push new file");
	await panel.getByRole("button", { name: "Commit and Push", exact: true }).click();
	await panel.getByRole("status").filter({ hasText: "已提交并推送" }).waitFor();
	assert.equal(await remoteHead(), await git("rev-parse", "HEAD"));
	assert.equal(await git("diff", "--cached", "--name-only"), "other.txt");
	assert.equal(await message.inputValue(), "");
	await page.screenshot({ path: join(artifacts, "git-commit-cdp.png") });
	console.log("Commit 全链路通过：只提交勾选文件、保留其他暂存内容、本地 Commit 不推送、Commit and Push 更新本地测试远程。");
	return root;
}
