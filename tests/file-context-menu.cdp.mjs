import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Runs inside app.cdp.mjs's temporary repository and storage restore boundary.
export async function verifyFileContextMenu(page, root, artifacts) {
	const path = "图片 folder/星空,蓝.png";
	const directory = join(root, "图片 folder");
	await mkdir(directory);
	await writeFile(join(root, path), new Uint8Array([0, 1, 2]));
	const rejected = await page.evaluate(async (root) => {
		const errors = [];
		for (const path of ["../outside.txt", root]) {
			try { await window.__TAURI_INTERNALS__.invoke("reveal_project_file", { root, path }); }
			catch (error) { errors.push(String(error)); }
		}
		return errors;
	}, root);
	assert.equal(rejected.length, 2, "Native reveal must reject traversal and absolute paths");
	assert.match(rejected[0], /路径不能离开项目目录/);
	assert.match(rejected[1], /路径必须是项目内的相对路径/);
	await page.getByRole("button", { name: "刷新 Git 状态", exact: true }).click();
	const file = page.getByRole("button", { name: `查看 Diff：${path}`, exact: true });
	await file.click({ button: "right" });
	await page.getByRole("menuitem", { name: "在资源管理器中显示", exact: true }).waitFor();
	await page.screenshot({ path: join(artifacts, "file-context-menu-cdp.png") });
	await page.getByRole("menuitem", { name: "在资源管理器中显示", exact: true }).click();
	// Real Tauri's invoke property is read-only, so verify the native result
	// directly as well as exercising the actual menu control.
	await page.evaluate(({ root, path }) => window.__TAURI_INTERNALS__.invoke("reveal_project_file", { root, path }), { root, path });
	assert.equal(await page.getByRole("menu", { name: path, exact: true }).count(), 0);
	assert.equal(await page.getByRole("checkbox", { name: `选择 ${path}`, exact: true }).isChecked(), false);
	assert.deepEqual(await page.locator(".workbench-banner.error").allTextContents(), []);
	console.log("文件右键全链路通过：真实 UI → IPC → Rust 启动 Explorer；越界路径已拒绝。");
	if (process.env.SKIFF_CDP_INSPECT_REVEAL) {
		// Keep the temporary fixture alive until a manual Explorer inspection
		// releases the marker; an unattended debug run still expires in 5 minutes.
		const marker = join(artifacts, "cdp-reveal-inspection.json");
		await writeFile(marker, JSON.stringify({ root, path }));
		const deadline = Date.now() + 5 * 60_000;
		try {
			while (Date.now() < deadline) {
				try { await access(marker); } catch { break; }
				await page.waitForTimeout(500);
			}
		} finally { await rm(marker, { force: true }); }
	}
}
