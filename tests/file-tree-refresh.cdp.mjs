import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Real pi round completion and native directory reads, using only the harness's
// temporary project and local mock provider. No model-generated file claims.
export async function verifyFileTreeRefresh(page, temporaryRoot, artifacts, modelId, reply) {
	const root = join(temporaryRoot, "file-refresh-project");
	await mkdir(join(root, "notes"), { recursive: true });
	await writeFile(join(root, "notes", "initial.md"), "Initial file\n");
	await page.evaluate((root) => {
		localStorage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "refresh-project", name: "File refresh fixture", path: root }], chats: [{ id: "refresh-chat", projectId: "refresh-project", title: "File refresh", updatedAt: Date.now(), hasMessages: false }], activeId: "refresh-chat" }));
		localStorage.setItem("skiff.workbench.v1", JSON.stringify({ version: 1, tool: "files" }));
		localStorage.setItem("skiff.sidebar.open", "true");
	}, root);
	await page.reload({ waitUntil: "domcontentloaded" });
	const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
	const row = (path) => page.locator(`.file-tree-row[title="${path}"]`);
	await row("notes").click();
	await row("notes/initial.md").waitFor();
	await tool("对话").click();
	await page.locator(".launcher-row", { hasText: modelId }).getByRole("button", { name: "开始聊天" }).click();
	for (const round of [1, 2]) {
		// The fixture creates a real file before each real pi reply finishes.
		await writeFile(join(root, "notes", `round-${round}.md`), `Round ${round}\n`);
		await page.fill(".composer-input", `第 ${round} 轮文件刷新验证，请回复。`);
		await page.click(".send-btn");
		await page.waitForFunction(({ reply, round }) => [...document.querySelectorAll(".md")].filter((node) => node.textContent.includes(reply)).length >= round, { reply, round });
		await tool("文件").click();
		// No manual refresh or re-expansion: the previous directory state survives.
		await row(`notes/round-${round}.md`).waitFor({ timeout: 10000 });
		assert.equal(await row("notes/initial.md").isVisible(), true);
		if (round === 1) await tool("对话").click();
	}
	await page.screenshot({ path: join(artifacts, "file-tree-refresh-cdp.png") });
	console.log("文件树刷新全链路通过：真实 pi 连续两轮结束后，已缓存并展开的非 Git 目录自动显示新增文件，无需手动刷新。");
}
