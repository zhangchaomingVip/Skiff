// Phase B: real WebView2 -> production native service -> two real Chrome instances.
// Invoked by app.cdp.mjs --browser. Uses only the harness's temporary browser data directory.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyNativeBrowser(page) {
	const site = createServer((request, response) => {
		response.setHeader("Content-Type", "text/html;charset=utf-8");
		response.end('<!doctype html><meta charset="utf-8"><title>标签导航验证</title><h1>浏览器服务验证</h1><input aria-label="姓名" id="name"><button id="submit" onclick="this.textContent=\'完成：\'+document.querySelector(\'#name\').value">提交</button>');
	});
	await new Promise((done) => site.listen(0, "127.0.0.1", done));
	const targets = [];
	const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
	try {
		const dependencies = await invoke("browser_dependencies");
		assert.equal(dependencies.ready, true, dependencies.message);
		const [a, duplicate, b] = await Promise.all([invoke("browser_start", { chatId: "cdp-browser-a" }), invoke("browser_start", { chatId: "cdp-browser-a" }), invoke("browser_start", { chatId: "cdp-browser-b" })]);
		targets.push(a, b);
		assert.equal(a.generation, duplicate.generation);
		assert.notEqual(a.generation, b.generation);
		// Production target structs reject unrelated fields. Use only chatId/generation.
		const target = { chatId: a.chatId, generation: a.generation };
		const connection = await invoke("browser_connection", { target });
		const command = async (action) => {
			const response = await fetch(`${connection.bridgeUrl}/command`, { method: "POST", headers: { Authorization: `Bearer ${connection.agentToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ target, requestId: randomUUID(), controlVersion: a.controlVersion, action }) });
			const result = await response.json(); assert.equal(result.success, true, JSON.stringify(result)); return result.data;
		};
		await command({ type: "open", url: `http://127.0.0.1:${site.address().port}` });
		await command({ type: "fill", selector: "#name", text: "桌面原生服务" });
		await command({ type: "click", selector: "#submit" });
		assert.match(JSON.stringify(await command({ type: "snapshot" })), /完成：桌面原生服务/);
		await page.evaluate((url) => {
			window.browserNativeProbe = { frames: 0 };
			window.browserNativeSocket = new WebSocket(url);
			window.browserNativeSocket.binaryType = "arraybuffer";
			window.browserNativeSocket.onmessage = ({ data }) => {
				if (data instanceof ArrayBuffer) {
					const bytes = new Uint8Array(data);
					if (bytes[0] === 0xff && bytes[1] === 0xd8) window.browserNativeSocket.send(JSON.stringify({ type: "ack", seq: ++window.browserNativeProbe.frames }));
					return;
				}
				const message = JSON.parse(data);
				if (message.type === "frame") { window.browserNativeProbe.frames++; window.browserNativeSocket.send(JSON.stringify({ type: "ack", seq: message.seq })); }
			};
		}, connection.streamUrl);
		await page.waitForFunction(() => window.browserNativeProbe.frames > 0);
		const human = await invoke("browser_control", { target, operation: "takeOver" }); assert.equal(human.control, "human");
		const ai = await invoke("browser_control", { target, operation: "return" }); assert.equal(ai.control, "ai");
		const stopped = await invoke("browser_control", { target, operation: "stop" }); assert.equal(stopped.control, "stopped");
		await page.evaluate(() => window.browserNativeSocket.close());
		await invoke("browser_close", { target });
		const bStatus = await invoke("browser_status", { target: { chatId: b.chatId, generation: b.generation } }); assert.equal(bStatus.control, "ai");
		// Exercise the actual panel, including the blank page that has no capture socket.
		await invoke("browser_set_enabled", { enabled: true });
		const chatId = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);
		const prior = await invoke("browser_find", { chatId });
		if (prior && prior.control !== "closed") await invoke("browser_close", { target: { chatId, generation: prior.generation } });
		const panel = page.locator(".browser-panel");
		if (await panel.count()) await page.getByRole("button", { name: "收起浏览器", exact: true }).click();
		await page.getByRole("button", { name: "浏览器", exact: true }).click();
		await page.getByRole("button", { name: "打开浏览器", exact: true }).click();
		await page.locator(".browser-new-page").waitFor();
		const baseTabs = (await invoke("browser_find", { chatId })).tabs.length;
		await page.getByRole("button", { name: "新建标签页", exact: true }).click();
		await page.waitForFunction((count) => document.querySelectorAll(".browser-tab").length === count, baseTabs + 1);
		await page.locator(".browser-tab.is-active .browser-tab-close").click();
		await page.waitForFunction((count) => document.querySelectorAll(".browser-tab").length === count, baseTabs).catch(async (error) => { throw new Error(`${error.message}\n${await panel.innerText()}\n${JSON.stringify(await invoke("browser_find", { chatId }))}`); });
		await page.getByRole("button", { name: "新建标签页", exact: true }).click();
		await page.waitForFunction((count) => document.querySelectorAll(".browser-tab").length === count, baseTabs + 1);
		await page.locator(".browser-tab:not(.is-active) .browser-tab-close").first().click();
		await page.waitForFunction((count) => document.querySelectorAll(".browser-tab").length === count, baseTabs);
		assert.equal(await page.locator(".browser-screen").count(), 0);
		const address = page.getByRole("combobox", { name: "地址栏" });
		const fixtureUrl = `http://127.0.0.1:${site.address().port}/tabs`;
		await address.fill(fixtureUrl); await address.press("Enter");
		await page.locator('.browser-screen[data-phase="live"]').waitFor({ timeout: 15000 }).catch(async (error) => { throw new Error(`${error.message}\n${await panel.innerText()}\n${JSON.stringify(await invoke("browser_find", { chatId }))}`); });
		await page.getByRole("tab", { name: "标签导航验证", exact: true }).waitFor();
		assert.equal(await page.locator(".browser-handoff").count(), 0);
		await page.screenshot({ path: join(process.cwd(), "dist/cdp-browser-tabs-page.png") });
		await page.getByRole("button", { name: "新建标签页", exact: true }).click();
		await page.locator(".browser-new-page").waitFor();
		await address.fill("标签导航验证");
		await page.getByRole("option").first().waitFor();
		await page.screenshot({ path: join(process.cwd(), "dist/cdp-browser-tabs-history.png") });
		await address.press("ArrowDown"); await address.press("Enter");
		await page.locator('.browser-screen[data-phase="live"]').waitFor();
		await page.locator(".browser-tab.is-active .browser-tab-close").click();
		await page.waitForFunction((count) => document.querySelectorAll(".browser-tab").length === count, baseTabs);
		while (await page.locator(".browser-tab-close").count() > 1) {
			const count = await page.locator(".browser-tab-close").count();
			await page.locator(".browser-tab-close").first().click();
			await page.waitForFunction((before) => document.querySelectorAll(".browser-tab").length < before, count);
		}
		await page.locator(".browser-tab-close").click();
		await panel.waitFor({ state: "detached", timeout: 30000 });
		assert.equal((await invoke("browser_find", { chatId })).control, "closed");
		await page.getByRole("button", { name: "浏览器", exact: true }).click();
		await page.getByRole("button", { name: "打开浏览器", exact: true }).click();
		await page.locator(".browser-new-page").waitFor();
		while (await page.locator(".browser-tab-close").count() > 1) {
			const count = await page.locator(".browser-tab-close").count();
			await page.locator(".browser-tab-close").first().click();
			await page.waitForFunction((before) => document.querySelectorAll(".browser-tab").length < before, count);
		}
		await page.locator(".browser-tab-close").click();
		await panel.waitFor({ state: "detached", timeout: 30000 });
		console.log("真实标签交互通过：空白页立即关闭、后台标签关闭、无画面导航、历史建议、最后标签收起与重新打开。");
		// Leave one owned browser for the real window-close lifecycle check after storage restoration.
		await invoke("browser_start", { chatId: "cdp-browser-exit" });
		console.log("浏览器原生服务通过：启动去重、双实例、结构化操作、真实画面、接管/交还/停止和单实例关闭。");
	} finally {
		for (const { chatId, generation } of targets) await invoke("browser_close", { target: { chatId, generation } }).catch(() => {});
		site.closeAllConnections(); site.close();
	}
}

export async function verifyNativeBrowserShutdown(page, root) {
	const directory = join(root, "browsers/runs");
	const owned = [];
	for (const name of await readdir(directory)) {
		const file = join(directory, name, "owned.json");
		try { owned.push({ file, ...JSON.parse(await readFile(file, "utf8")) }); } catch {}
	}
	assert.ok(owned.length > 0, "Window shutdown must be exercised with a live browser");
	await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })).catch(() => {});
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		const alive = owned.some(({ pid }) => { try { process.kill(pid, 0); return true; } catch { return false; } });
		const records = await Promise.all(owned.map(({ file }) => readFile(file).then(() => true, () => false)));
		if (!alive && records.every((present) => !present)) {
			console.log("浏览器退出清理通过：正常关闭真实窗口后，托管 daemon 退出，进程记录清除。");
			return;
		}
		await new Promise((done) => setTimeout(done, 100));
	}
	throw new Error("Window exit left a live managed browser daemon or ownership record");
}
