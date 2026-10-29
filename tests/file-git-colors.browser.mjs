import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "../.playwright-cli/node_modules/playwright-core/index.mjs";

const origin = process.argv[2] ?? "http://localhost:1421";
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.setDefaultTimeout(10000);
const row = (path) => page.locator(`.file-tree-row[title="${path}"]`);
const color = (path) => row(path).evaluate((element) => getComputedStyle(element).color);
const refresh = () => page.getByRole("button", { name: "刷新文件树", exact: true }).click();
const tokenColor = (token) => page.evaluate((token) => {
	const probe = document.createElement("span"); probe.style.color = `var(${token})`; document.body.append(probe);
	const value = getComputedStyle(probe).color; probe.remove(); return value;
}, token);

try {
	await mkdir("dist/file-git-colors", { recursive: true });
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=sidebar&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate(() => {
			const original = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
			window.fileGitMode = "changes";
			window.__TAURI_INTERNALS__.invoke = async (command, args) => {
				const result = await original(command, args);
				if (command === "list_project_directory" && args.path === "src") return { path: "src", truncated: false, entries: ["App.tsx", "added.ts", "untracked.ts", "renamed.ts", "conflict.ts", "normal.ts"].map((name) => ({ path: `src/${name}`, name, kind: "file" })) };
				if (command === "get_project_git_status") {
					if (window.fileGitMode === "local") throw new Error("not a git repository");
					const changed = window.fileGitMode === "changes" && args.root.endsWith("Skiff");
					return { ...result, version: window.fileGitMode, entries: changed ? [
						{ path: "src\\App.tsx", kind: "modified" }, { path: "src/added.ts", kind: "added" },
						{ path: "src/untracked.ts", kind: "untracked" }, { path: "src/renamed.ts", oldPath: "src/old.ts", kind: "renamed" }, { path: "src/conflict.ts", kind: "conflict" },
					] : [] };
				}
				return result;
			};
		});
		await page.getByRole("navigation", { name: "工作区工具" }).getByRole("button", { name: "文件", exact: true }).click();
		await row("src").click(); await row("src/App.tsx").waitFor();
		await refresh();
		await page.waitForFunction(() => document.querySelector('.file-tree-row[title="src/App.tsx"]')?.dataset.gitKind === "modified");
		await page.mouse.move(1100, 750);
		for (const [path, token] of [["App.tsx", "--git-modified"], ["added.ts", "--color-success"], ["untracked.ts", "--danger"], ["renamed.ts", "--git-modified"], ["conflict.ts", "--danger"], ["normal.ts", "--secondary"]]) {
			assert.equal(await color(`src/${path}`), await tokenColor(token), `${theme}: ${path}`);
		}
		assert.equal(await row("src").getAttribute("data-git-kind"), null);
		assert.equal(await row("src/App.tsx").getAttribute("aria-description"), "已修改");
		await row("src/App.tsx").hover();
		assert.equal(await color("src/App.tsx"), await tokenColor("--git-modified"), "Hover preserves status color");
		await row("src/App.tsx").click();
		await page.locator(".project-preview").waitFor();
		await page.mouse.move(1100, 750);
		await page.screenshot({ path: `dist/file-git-colors/${theme}.png`, animations: "disabled" });
		// A background Git refresh changes colors without rebuilding the directory tree.
		await page.evaluate(() => { window.fileGitMode = "clean"; window.dispatchEvent(new Event("focus")); });
		await page.waitForFunction(() => !document.querySelector('.file-tree-row[title="src/App.tsx"]')?.dataset.gitKind);
		assert.equal(await color("src/App.tsx"), await tokenColor("--secondary"));
		await page.evaluate(() => { window.fileGitMode = "changes"; }); await refresh();
		await page.waitForFunction(() => document.querySelector('.file-tree-row[title="src/App.tsx"]')?.dataset.gitKind === "modified");
		await page.getByRole("button", { name: /^浏览项目：/ }).click();
		await page.getByRole("option", { name: "aiagent", exact: true }).click();
		await row("src").click(); await row("src/App.tsx").waitFor();
		assert.equal(await row("src/App.tsx").getAttribute("data-git-kind"), null, "Other projects cannot inherit colors");
		await page.evaluate(() => { window.fileGitMode = "local"; }); await refresh();
		await page.waitForFunction(() => document.querySelector(".git-local-project") !== null);
		await row("src/App.tsx").waitFor();
		assert.equal(await row("src/App.tsx").getAttribute("data-git-kind"), null);
	}
	console.log("File Git colors: light/dark, status mapping, normal files, hover, open, refresh, background cleanup, project isolation and non-Git folders passed.");
} finally { await browser.close(); }
