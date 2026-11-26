// Focused prompt preferences regression; uses the isolated mock preview origin.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SKIFF_IDENTITY_PROMPT } from "../src/chat/prompt.ts";
import { assembleSystemPrompt } from "../src/chat/systemPrompt.ts";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? join(process.cwd(), ".playwright-cli/node_modules/playwright-core"));
const origin = process.argv[2] ?? "http://localhost:1421";
const output = join(process.cwd(), "dist/identity-settings");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 }, permissions: ["clipboard-read", "clipboard-write"] });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const dialog = page.locator(".settings-workspace");
const editor = dialog.getByRole("textbox", { name: "自定义附加指令" });
const overview = dialog.locator(".prompt-system");
const reader = page.locator("dialog.prompt-reader");
const body = reader.locator(".prompt-reader-content");
const openReader = overview.getByRole("button", { name: "查看完整指令" });
const snapshot = {
	content: "",
	sections: [
		{ name: "preamble", text: "You are a coding assistant running inside pi. Help users inspect files, run commands and modify code." },
		{ name: "tools", text: "<tools>\n- read: Read file contents.\n- edit: Make targeted changes to source files.\n- bash: Run commands in the current workspace.\n\nAdditional tools may be available.\n</tools>" },
		{ name: "rules", text: Array.from({ length: 12 }, (_, i) => [
			`# Workspace rule ${i + 1}`,
			"- Inspect existing files and usage before editing.",
			"- Preserve the original line endings and local user changes.",
			"- 修改前阅读相关实现，完成后运行与本次变更相关的验证。",
		].join("\n")).join("\n\n") },
		{ name: "docs", text: "Pi documentation\n- README.md: Setup and everyday use.\n- docs/rpc.md: Running pi as an RPC subprocess.\n- docs/extensions.md: Extension APIs and examples." },
		{ name: "addendum", text: "使用用户指定的语言回答，并报告已运行的测试。" },
		{ name: "project_context", text: "Project-specific instructions and guidelines:\n\n<project_instructions path=\"AGENTS.md\">\n" + "Use the shared style tokens and test both themes.\n".repeat(6) + "</project_instructions>" },
		{ name: "skills", text: "<available_skills>\n" + ["accessibility", "ui-review", "test-runner", "workspace-search"].map((name) => `<skill>\n  <name>${name}</name>\n  <description>Review workspace changes and summarize the result.</description>\n</skill>`).join("\n") + "\n</available_skills>" },
		{ name: "cwd", text: "D:/workspace/Skiff" },
		{ name: "extension_note", text: "Preview." },
	],
};
const open = async () => {
	await page.keyboard.press("Control+Comma");
	await page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "对话", exact: true }).click();
	await editor.waitFor();
};
const save = async () => {
	const count = await page.evaluate(() => window.promptStarts.length);
	await dialog.getByRole("button", { name: "保存并重启", exact: true }).click();
	await dialog.waitFor({ state: "detached" });
	await page.waitForFunction((previous) => window.promptStarts.length > previous, count);
	await page.waitForFunction(() => document.querySelector(".composer-input")?.disabled === false);
	return page.evaluate(() => window.promptStarts.at(-1));
};

try {
	for (const theme of ["light", "dark"]) {
		await page.setViewportSize({ width: 1100, height: 750 });
		await page.goto(`${origin}/tests/preview.html?fixture=archive&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		await page.evaluate((snapshot) => {
			window.promptStarts = [];
			window.promptSnapshot = snapshot;
			const invoke = window.__TAURI_INTERNALS__.invoke;
			window.__TAURI_INTERNALS__.invoke = async (command, args, ...rest) => {
				if (command === "rpc_start") window.promptStarts.push(args.options.appendSystemPrompt);
				if (command === "read_system_prompt") {
					if (window.deferPrompt) await new Promise((resolve) => { window.finishPromptRead = resolve; });
					if (!window.promptSnapshot) throw new Error("模拟读取失败");
					return window.promptSnapshot;
				}
				return invoke(command, args, ...rest);
			};
		}, snapshot);
		await open();
		assert.equal(await editor.inputValue(), "");
		assert.match(await dialog.locator(".prompt-hint").innerText(), /清空仅移除自定义指令/);
		await openReader.waitFor();
		await page.waitForFunction(() => document.querySelectorAll(".prompt-map-tile").length === 9);
		assert.match(await overview.locator(".prompt-card-title").innerText(), /共 9 段 · [\d,]+ 字 · 约 [\d.]+K? token/);
		assert.equal(await overview.locator(".prompt-breakdown-row").first().getAttribute("data-section"), "rules");
		assert.equal(await overview.locator(".prompt-map").evaluate((node) => node.clientHeight), 128);
		await page.screenshot({ path: join(output, `prompt-${theme}.png`), animations: "disabled" });
		const customHeading = await dialog.getByRole("heading", { name: "自定义附加指令" }).boundingBox();
		assert.ok(customHeading.y + customHeading.height < 750, `The custom prompt heading stays in the first viewport (${customHeading.y}px)`);

		const ruleTile = overview.locator('.prompt-map-tile[data-section="rules"]');
		const ruleRow = overview.locator('.prompt-breakdown-row[data-section="rules"]');
		await ruleTile.hover();
		assert.equal(await ruleRow.getAttribute("data-highlighted"), "true");
		await ruleRow.hover();
		assert.equal(await ruleTile.getAttribute("data-highlighted"), "true");
		assert.equal(await overview.locator('.prompt-map-tile[data-section="extension_note"]').textContent(), "");
		await ruleTile.click();
		assert.equal(await reader.getByRole("button", { name: "行为规则", exact: true }).getAttribute("aria-pressed"), "true");
		assert.equal(await body.textContent(), snapshot.sections.find(({ name }) => name === "rules").text);
		await reader.getByRole("button", { name: "复制行为规则" }).click();
		await reader.getByRole("status").getByText("已复制", { exact: true }).waitFor();
		const copied = await page.evaluate(() => navigator.clipboard.readText());
		assert.equal(copied.replaceAll("\r\n", "\n"), await body.textContent());
		await reader.getByRole("button", { name: "全部" }).click();
		assert.equal(await body.textContent(), assembleSystemPrompt(snapshot));
		assert.equal(await body.evaluate((node) => node.scrollHeight > node.clientHeight), true);
		assert.deepEqual(await reader.getByRole("group", { name: "筛选提示词段落" }).getByRole("button").allTextContents(), [
			"全部", "角色定位", "可用工具", "行为规则", "帮助文档", "附加说明", "项目上下文", "技能清单", "工作目录", "extension_note",
		]);
		await page.screenshot({ path: join(output, `prompt-reader-${theme}.png`), animations: "disabled" });
		await page.keyboard.press("Escape");
		await reader.waitFor({ state: "detached" });
		await page.waitForFunction(() => document.activeElement?.matches('.prompt-map-tile[data-section="rules"]'));
		await ruleRow.click();
		assert.equal(await reader.getByRole("button", { name: "行为规则", exact: true }).getAttribute("aria-pressed"), "true");
		await reader.getByRole("button", { name: "关闭" }).click();
		await openReader.click();
		assert.equal(await reader.getByRole("button", { name: "全部" }).getAttribute("aria-pressed"), "true");
		await reader.getByRole("button", { name: "关闭" }).click();

		await page.evaluate(() => {
			const [instance] = window.skiffPreview.processes.keys();
			window.skiffPreview.emit(instance, { type: "agent_start" });
		});
		await page.waitForFunction(() => document.querySelector("#append-prompt")?.matches(":disabled"));
		await openReader.click();
		await reader.getByRole("button", { name: "关闭" }).click();
		await page.evaluate(() => {
			const [instance] = window.skiffPreview.processes.keys();
			window.skiffPreview.emit(instance, { type: "agent_end" });
			window.skiffPreview.emit(instance, { type: "agent_settled" });
		});
		await page.waitForFunction(() => !document.querySelector("#append-prompt")?.matches(":disabled"));

		if (theme === "light") {
			await page.evaluate(() => { window.deferPrompt = true; window.promptSnapshot = undefined; });
			await overview.getByRole("button", { name: "重新读取" }).click();
			await overview.getByRole("button", { name: "正在读取…" }).waitFor();
			await page.evaluate(() => { window.deferPrompt = false; window.finishPromptRead(); });
			assert.match(await overview.getByRole("alert").innerText(), /模拟读取失败/);
			assert.equal(await openReader.isDisabled(), true);
			await page.evaluate(() => { window.promptSnapshot = { content: "", sections: [] }; });
			await overview.getByRole("button", { name: "重新读取" }).click();
			await overview.getByText("当前会话没有可显示的系统提示词段落。").waitFor();
			assert.equal(await openReader.isDisabled(), true);
			await page.evaluate(() => { window.promptSnapshot = { content: "完整的原文\n下一行", sections: [] }; });
			await overview.getByRole("button", { name: "重新读取" }).click();
			await openReader.click();
			assert.equal(await body.textContent(), "完整的原文\n下一行");
			await reader.getByRole("button", { name: "关闭" }).click();
			await page.evaluate((snapshot) => { window.promptSnapshot = snapshot; }, snapshot);
		}
		const custom = "请使用中文。\n保留这条多行自定义指令。";
		await editor.fill(custom);
		assert.equal(await save(), `${SKIFF_IDENTITY_PROMPT}\n\n${custom}`);
		await open();
		assert.equal(await editor.inputValue(), custom, "Reopening shows only the saved user instructions");
		await dialog.getByRole("button", { name: "清空", exact: true }).click();
		assert.equal(await editor.inputValue(), "");
		await page.setViewportSize({ width: 600, height: 400 });
		await openReader.click();
		assert.equal(await reader.evaluate((node) => node.scrollWidth > node.clientWidth), false);
		assert.equal(await reader.locator(".prompt-reader-filters").evaluate((node) => node.scrollWidth > node.clientWidth), false);
		assert.ok((await body.boundingBox()).height > 100);
		await page.screenshot({ path: join(output, `prompt-reader-${theme}-600.png`), animations: "disabled" });
		await page.keyboard.press("Escape");
		await reader.waitFor({ state: "detached" });
		await dialog.locator(".prompt-hint").scrollIntoViewIfNeeded();
		assert.equal(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth), false);
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
		await page.screenshot({ path: join(output, `prompt-${theme}-600.png`) });
		assert.equal(await save(), SKIFF_IDENTITY_PROMPT, "Clearing must preserve built-in identity at session startup");
		assert.equal(await page.evaluate(() => localStorage.getItem("skiff.prompt.append")), "");
	}
	assert.deepEqual(errors, []);
	console.log("PASS: prompt treemap, linked highlights, reader, copy, state handling, restricted editing, save/restart, light/dark and 600x400 layout.");
} finally {
	await browser.close();
}
