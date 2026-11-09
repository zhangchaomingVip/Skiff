import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR || "../.playwright-cli/node_modules/playwright-core");
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const base = process.argv[2] || "http://localhost:1421";
const output = "dist/process-hierarchy";
await mkdir(output, { recursive: true });
const commands = ["git log --oneline -n 5 | head", "git diff src/index.css", "echo one\r\n  echo   two", "echo done > out.txt"];
const paths = ["D:/workspace/Skiff/src/backend/services/org_apply_service.ts", "d:\\workspace\\skiff\\src\\components\\ToolSummaryLabel.tsx", "D:/workspace/Skiff-other/outside.ts", "README.md", `src/${"deep/".repeat(30)}${"long_filename_".repeat(25)}.ts`];
const calls = [...commands.map((command, index) => ({ type: "toolCall", id: `cmd-${index}`, name: "bash", arguments: { command } })), ...paths.map((path, index) => ({ type: "toolCall", id: `file-${index}`, name: "read", arguments: { path } }))];
const messages = [
	{ role: "user", content: "检查编程对话中的命令与文件展示。" },
	{ role: "assistant", content: [{ type: "text", text: "先核对 `ToolSummaryLabel` 的路径与命令，再检查显示层级。" }, ...calls] },
	...calls.map((call) => ({ role: "toolResult", toolCallId: call.id, name: call.name, content: "检查完成。" })),
	{ role: "assistant", content: "检查完成，`ToolSummaryLabel` 已呈现完整文件名和命令预览。", stopReason: "stop" },
];
try {
	for (const theme of ["light", "dark"]) {
		const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, reducedMotion: "reduce" });
		const errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${base}/tests/preview.html?fixture=chat-polish-031&theme=${theme}`);
		await page.locator(".composer").waitFor();
		await page.locator(".turn-process > summary").first().click();
		await page.screenshot({ path: `${output}/app-${theme}.png` });
		await page.goto(`${base}/tests/turn-usage.html`);
		await page.waitForFunction(() => window.turnUsageHarness);
		await page.evaluate(({ theme, messages }) => {
			document.documentElement.dataset.theme = theme;
			window.turnUsageHarness.render({ messages, projectRoot: "D:/workspace/Skiff" });
		}, { theme, messages });
		await page.locator(".turn-process > summary").click();
		await page.locator(".tool-run > summary").click();
		assert.equal(await page.locator(".messages").evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom) >= 24), true, "The transcript leaves space above the composer");
		assert.equal(await page.locator(".md .inline-code").first().evaluate((node) => {
			const style = getComputedStyle(node);
			return style.marginInlineStart === "2px" && style.borderTopWidth === "1px";
		}), true);
		const rows = page.locator(".tool > summary");
		assert.deepEqual(await rows.locator(".tool-command-preview").allTextContents(), commands.map((command) => command.replace(/\s+/g, " ").trim()));
		assert.deepEqual(await rows.locator(".tool-target-file").allTextContents(), ["src/backend/services/org_apply_service.ts", "src/components/ToolSummaryLabel.tsx", ...paths.slice(2)]);
		assert.equal(await rows.locator(".tool-target-file").first().getAttribute("title"), paths[0]);
		await page.mouse.move(0, 0);
		await page.locator(".tool-run > summary").blur();
		assert.equal(await rows.first().evaluate((row) => {
			const token = (name) => { const probe = document.createElement("span"); probe.style.color = `var(${name})`; row.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value; };
			return getComputedStyle(row.querySelector(".process-row-icon")).color === token("--chat-meta") && getComputedStyle(row.querySelector(".tool-summary")).color === token("--muted");
		}), true, "Action labels are stronger than repeated icons");
		assert.equal(await page.locator(".turn-process-body").evaluate((body) => {
			const narration = body.querySelector("[data-process-text] > .md");
			const reply = body.closest(".assistant-reply").querySelector(".msg:last-child .md");
			return getComputedStyle(body).borderLeftWidth === "1px" && getComputedStyle(narration).fontSize === "14px" && getComputedStyle(reply).fontSize === "15px" && narration.getBoundingClientRect().left > reply.getBoundingClientRect().left;
		}), true, "The rail and smaller narration distinguish the final answer");
		for (const width of [1200, 600, 360]) {
			await page.setViewportSize({ width, height: 1000 });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			if (width >= 600) assert.equal(await rows.locator(".tool-target-basename").first().evaluate((name) => name.scrollWidth <= name.clientWidth), true, "The filename survives before the directory");
			else assert.equal(await rows.locator(".tool-target-basename").first().evaluate((name) => name.scrollWidth <= name.clientWidth || name.previousElementSibling.clientWidth === 0), true, "Narrow windows exhaust the directory before truncating the filename");
			assert.equal(await rows.locator(".tool-target-basename").last().evaluate((name) => name.scrollWidth > name.clientWidth), true, "Extremely long filenames truncate inside the row");
			assert.equal(await rows.first().evaluate((row) => row.querySelector(".tool-command-preview").getBoundingClientRect().right <= row.getBoundingClientRect().right), true);
			await page.screenshot({ path: `${output}/${theme}-${width}.png`, fullPage: true });
		}
		await rows.first().press("Enter");
		assert.equal(await page.locator(".tool-content").first().isVisible(), true);
		assert.equal(await page.locator(".tool-content").first().locator(".tool-output").first().textContent(), `$ ${commands[0]}`);
		await rows.first().press("Enter");
		assert.equal(await page.locator(".tool-content").first().isVisible(), false);
		assert.deepEqual(errors, []);
		console.log(`PASS ${theme}: command previews, relative paths, filename priority, narration hierarchy, narrow layouts and keyboard disclosure`);
		await page.close();
	}
} finally {
	await browser.close();
}
