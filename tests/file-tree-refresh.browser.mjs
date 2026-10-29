import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(5000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const row = (path) => page.locator(`.file-tree-row[title="${path}"]`);
const tool = (name) => page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name, exact: true });
const choose = async (name) => {
	await page.getByRole("button", { name: /^浏览项目：/ }).click();
	await page.getByRole("option", { name, exact: true }).click();
};
const finishRound = async (generation, toolName = "write") => {
	await page.evaluate(() => {
		const instanceId = [...window.skiffPreview.processes].find(([, session]) => session.file === "sidebar-skiff-chat-0.jsonl")?.[0];
		if (!instanceId) throw new Error("Expected Skiff runtime");
		window.fileRefreshInstance = instanceId;
		window.skiffPreview.processes.get(instanceId).isStreaming = true;
		window.skiffPreview.emit(instanceId, { type: "agent_start" });
	});
	// Let React observe the running state before the completion event.
	await page.waitForTimeout(100);
	await page.evaluate(({ generation, toolName }) => {
		window.fileGeneration = generation;
		const instanceId = window.fileRefreshInstance;
		window.skiffPreview.emit(instanceId, { type: "message_end", message: { role: "toolResult", toolCallId: `file-round-${generation}`, toolName, content: [{ type: "text", text: "Created file" }] } });
		window.skiffPreview.processes.get(instanceId).isStreaming = false;
		window.skiffPreview.emit(instanceId, { type: "agent_end" });
		window.skiffPreview.emit(instanceId, { type: "agent_settled" });
	}, { generation, toolName });
};

try {
	await mkdir("dist/file-tree-refresh", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => {
			window.fileGeneration = 0;
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				if (command === "list_project_directory" && args.path === "src") {
					const count = args.root.endsWith("Skiff") ? window.fileGeneration : 0;
					return { path: "src", truncated: false, entries: Array.from({ length: count + 1 }, (_, i) => ({ name: `round-${i}.txt`, path: `src/round-${i}.txt`, kind: "file" })) };
				}
				// File refresh must also work for projects without Git metadata.
				if (command === "get_project_git_status") throw new Error("not a git repository");
				return original(command, args);
			};
		});
		await tool("文件").click();
		await row("src").click();
		await row("src/round-0.txt").waitFor();
		await finishRound(1);
		await row("src/round-1.txt").waitFor();
		await finishRound(2);
		await row("src/round-2.txt").waitFor();
		assert.equal(await page.locator('.file-tree-row[title^="src/round-"]').count(), 3);
		await page.screenshot({ path: `dist/file-tree-refresh/${theme}-two-rounds.png`, animations: "disabled" });
		// Cache invalidation must survive the panel being unmounted.
		await tool("对话").click();
		await finishRound(3, "custom_generator");
		await page.waitForTimeout(900);
		await tool("文件").click();
		await row("src/round-3.txt").waitFor();
		// An open panel for another project also keeps its own local page cache.
		await choose("aiagent");
		await row("src").click();
		await row("src/round-0.txt").waitFor();
		await finishRound(4);
		await page.waitForTimeout(900);
		assert.equal(await row("src/round-4.txt").count(), 0, "Background changes must not appear in another project");
		await choose("Skiff");
		await row("src/round-4.txt").waitFor();
	}
	assert.deepEqual(errors, []);
	console.log("File tree refresh: both themes, consecutive rounds, expanded directories, non-Git projects, closed panels, completion fallback and background project isolation passed.");
} finally { await browser.close(); }
