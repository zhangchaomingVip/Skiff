import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SKIFF_PLAYWRIGHT_DIR ?? "../.playwright-cli/node_modules/playwright-core");
const origin = process.argv[2] ?? "http://localhost:1421";
await mkdir("dist/project-restore", { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const workspace = () => page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")));
const projectRows = () => page.locator(".project-row");

try {
	for (const theme of ["light", "dark"]) {
		await page.goto(`${origin}/tests/preview.html?fixture=project-restore&theme=${theme}`);
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		assert.equal(await projectRows().count(), 1, "A hidden project stays out of the sidebar");
		assert.equal(await page.getByText("被移出的项目", { exact: true }).count(), 0);

		await page.getByRole("button", { name: "添加项目", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "创建项目", exact: true });
		await dialog.waitFor();
		const hidden = dialog.getByRole("region", { name: "已移出的项目" });
		await hidden.waitFor();
		assert.equal(await hidden.getByText("被移出的项目", { exact: true }).count(), 1);
		assert.equal(await hidden.getByText("D:\\workspace\\old-project", { exact: true }).count(), 1);
		assert.equal(await hidden.getByRole("button", { name: /^恢复/ }).innerText(), "恢复 · 1 个聊天");
		await page.screenshot({ path: `dist/project-restore/${theme}.png`, animations: "disabled" });

		await hidden.getByRole("button", { name: /^恢复/ }).click();
		await dialog.waitFor({ state: "hidden" });
		const restored = await workspace();
		assert.equal(restored.projects.find((project) => project.id === "restore-old")?.hiddenAt, undefined);
		assert.equal(restored.activeId, "restore-old-chat", "Restoring focuses the newest surviving chat");
		assert.equal(await projectRows().count(), 2);
		await page.locator(".project-group", { hasText: "被移出的项目" }).locator(".chat-title", { hasText: "被移出的消息" }).waitFor();

		await page.getByRole("button", { name: "添加项目", exact: true }).click();
		await dialog.waitFor();
		assert.equal(await dialog.getByRole("region", { name: "已移出的项目" }).count(), 0, "Nothing left to restore");
		await page.getByRole("button", { name: "取消", exact: true }).click();
		await dialog.waitFor({ state: "hidden" });
	}
	assert.deepEqual(errors, []);
	console.log("Project restore: hidden list, chat count, restore into the sidebar and empty state passed in light/dark.");
} finally {
	await browser.close();
}
