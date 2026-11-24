import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const savedJob = (id, serviceName, projectRoot, extra = {}) => ({ id, status: "completed", serviceId: `${id}-service`, serviceName, modelId: "media-local", projectRoot, createdAt: Date.now() - 60_000, prompt: "local fixture", size: "1024x1024", quality: "auto", ...extra });
export async function seedSessionStatistics(root, agentDir, seed) {
	const project = { id: "p-cdp-archive", name: "统计归档项目", path: join(root, "archived-project") };
	const transcriptDir = join(agentDir, "sessions", "stats-fixture");
	const sessionFile = join(transcriptDir, "archive-fixture.jsonl");
	const originalProject = seed.projects[0].path;
	const historyTime = new Date(Date.now() - 600_000).toISOString();
	await mkdir(project.path, { recursive: true });
	await mkdir(transcriptDir, { recursive: true });
	await writeFile(sessionFile, [
		{ type: "session", version: 3, cwd: project.path, id: "statistics-archive", timestamp: historyTime },
		{ type: "message", id: "old-user", parentId: null, timestamp: historyTime, message: { role: "user", content: "ARCHIVE_PRIVATE_CONTENT" } },
		{ type: "message", id: "old-model", parentId: "old-user", timestamp: historyTime, message: { role: "assistant", provider: "retired-relay", model: "archive-local", timestamp: Date.parse(historyTime), usage: { input: 10, output: 50, cacheRead: 70, cacheWrite: 6 }, stopReason: "stop", content: "ARCHIVE_PRIVATE_CONTENT" } },
	].map((line) => JSON.stringify(line)).join("\n") + "\n");
	seed.projects.push(project);
	seed.chats.push({ id: "c-cdp-archive", projectId: project.id, title: "归档统计会话", updatedAt: Date.parse(historyTime), sessionFile, hasMessages: true, archivedAt: Date.now() });
	const imageDir = join(root, "generation", "jobs");
	const videoDir = join(root, "generation", "video-jobs");
	await mkdir(imageDir, { recursive: true });
	await mkdir(videoDir, { recursive: true });
	await writeFile(join(imageDir, "image.json"), JSON.stringify(savedJob("image-fixture", "图像服务测试", originalProject, { removed: true, prompt: "MEDIA_PRIVATE_PROMPT", usage: { totalTokens: 100000 } })));
	await writeFile(join(imageDir, "failed.json"), JSON.stringify(savedJob("ignored-image", "失败测试", originalProject, { status: "failed" })));
	await writeFile(join(videoDir, "video.json"), JSON.stringify(savedJob("video-fixture", "视频服务测试", project.path, { status: "download_failed", remoteStatus: "completed", baseUrl: "http://127.0.0.1", duration: 5, ratio: "9:16", resolution: "1080p", hasReference: false, prompt: "MEDIA_PRIVATE_PROMPT" })));
}

export async function verifySessionStatistics(page, root, artifacts) {
	await page.waitForFunction(() => {
		const chat = JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find(({ id }) => id === "c-cdp");
		return chat?.sessionFile && chat.routeSnapshots?.some(Boolean);
	});
	await page.keyboard.press("Control+Comma");
	const settings = page.locator(".settings-workspace");
	await page.getByRole("button", { name: "对话统计", exact: true }).click();
	const stats = settings.getByRole("region", { name: "对话统计", exact: true });
	// The app opens on the Code workspace, so the panel starts on the code slice.
	await stats.getByRole("group", { name: "统计模式" }).getByRole("button", { name: /全部汇总/ }).click();
	const label = (text) => stats.getByLabel(text, { exact: true });
	const button = (text) => stats.getByRole("button", { name: text, exact: true });
	const kpi = (text) => stats.locator(".statistics-stat").filter({ has: page.getByText(text, { exact: true }) }).locator("dd");
	await stats.getByText("归档统计会话", { exact: true }).waitFor();
	await stats.getByRole("cell", { name: /CDP 本地验证/ }).waitFor();
	assert.deepEqual(await Promise.all(["会话请求", "消耗 Tokens", "生成图片", "生成视频"].map((item) => kpi(item).textContent())), ["2", "168", "1", "1"]);
	assert.equal(await kpi("已知费用").textContent(), "¥0.00156");
	const projection = await page.evaluate(async () => {
		const workspace = JSON.parse(localStorage.getItem("skiff.workspace.v1"));
		return window.__TAURI_INTERNALS__.invoke("read_session_statistics", { targets: workspace.chats.filter(({ sessionFile }) => sessionFile).map(({ id, projectId, sessionFile }) => ({ chatId: id, sessionFile, cwd: workspace.projects.find((p) => p.id === projectId).path })) });
	});
	assert.equal(projection.skippedSessions + projection.skippedMedia, 0);
	assert.doesNotMatch(JSON.stringify(projection), /ARCHIVE_PRIVATE_CONTENT|MEDIA_PRIVATE_PROMPT|dummy-local-key/);
	await button("按项目").click();
	const archive = stats.getByRole("row", { name: /统计归档项目/ });
	assert.equal(await archive.locator("td").first().textContent(), "1");
	assert.equal(await archive.locator("td").last().textContent(), "1");
	assert.ok((await stats.getByText("1 次未定价", { exact: true }).count()) > 0, "The cost caveat stays in the grouped view");
	await stats.getByRole("button", { name: "筛选项目：统计归档项目", exact: true }).click();
	assert.equal(await kpi("消耗 Tokens").textContent(), "136");
	await label("项目").selectOption("");
	await button("按提供商").click();
	assert.equal(await stats.getByRole("row", { name: /图像服务测试/ }).locator("td").nth(4).textContent(), "1");
	assert.equal(await stats.getByRole("row", { name: /视频服务测试/ }).locator("td").last().textContent(), "1");
	await stats.getByRole("row", { name: /视频服务测试/ }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: join(artifacts, "cdp-session-statistics.png") });
	await label("提供商").selectOption({ label: "视频服务测试 · 视频" });
	assert.equal(await kpi("生成视频").textContent(), "1");
	assert.equal(await kpi("会话请求").textContent(), "0");
	await writeFile(join(root, "generation", "video-jobs", "second-video.json"), JSON.stringify(savedJob("second-video", "视频服务测试", null, { serviceId: "video-fixture-service", remoteStatus: "completed", baseUrl: "http://127.0.0.1", duration: 5, ratio: "9:16", resolution: "1080p", hasReference: false })));
	await button("刷新").click();
	await page.waitForFunction(() => Array.from(document.querySelectorAll(".statistics-stat")).some((node) => node.querySelector("dt")?.textContent === "生成视频" && node.querySelector("dd")?.textContent === "2"));
	console.log("会话统计原生验证：真实 pi 用量、归档、项目/提供商分组、生成记录、价格及隐私投影均通过。");
}
