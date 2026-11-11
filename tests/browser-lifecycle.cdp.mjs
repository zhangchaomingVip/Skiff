import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";

const textOf = (message) => typeof message?.content === "string" ? message.content : (message?.content ?? []).map((part) => part.text ?? "").join("\n");
export async function createLifecycleScenario(model) {
	const steps = new Map();
	let overlapped = false;
	const site = createServer((request, response) => {
		const owner = request.url?.startsWith("/set/") ? request.url.slice(5) : undefined;
		if (owner) response.setHeader("Set-Cookie", `owner=${owner}; Max-Age=86400; Path=/`);
		response.setHeader("Content-Type", "text/html;charset=utf-8");
		response.end('<!doctype html><meta charset="utf-8"><style>body{font:24px system-ui;background:#f6f8fa;margin:70px}</style><h1>独立聊天浏览器</h1><button id=owner></button><script>document.querySelector("#owner").textContent=document.cookie||"no cookie"</script>');
	});
	await new Promise((done) => site.listen(0, "127.0.0.1", done));
	const base = `http://127.0.0.1:${site.address().port}`;
	return {
		steps,
		get overlapped() { return overlapped; },
		close() { site.closeAllConnections(); site.close(); },
		handle(payload, response) {
			const user = [...payload.messages].reverse().find((message) => message.role === "user");
			const match = textOf(user).match(/\[F ([AB]) (set|read|restore|reopen)\]/);
			if (!match) return false;
			const [key, owner, operation] = match;
			if (owner === "B" && operation === "set" && steps.get("[F A set]") === 3) overlapped = true;
			const step = steps.get(key) ?? 0; steps.set(key, step + 1);
			let action;
			if (operation === "set") action = [{ action: "open", url: `${base}/set/${owner}` }, { action: "snapshot" }, { action: "wait", milliseconds: owner === "A" ? 6000 : 2500 }, { action: "snapshot" }][step];
			else if (operation === "restore" || operation === "reopen") {
				assert.ok(payload.tools.some((tool) => tool.function?.name === "browser"), "Closing must keep browser in the same pi process's active tools");
				action = [{ action: "open", url: `${base}/read` }, { action: "snapshot" }][step];
			}
			else action = [{ action: "snapshot" }][step];
			if (!action) assert.ok(textOf(payload.messages.at(-1)).includes(`owner=${owner}`), `Wrong browser cookie/context for ${key}: ${textOf(payload.messages.at(-1))}`);
			const delta = action ? { tool_calls: [{ index: 0, id: `f-${owner}-${operation}-${step}`, type: "function", function: { name: "browser", arguments: JSON.stringify(action) } }] } : { content: `F完成:${owner}:${operation}` };
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }]) response.write(`data: ${JSON.stringify({ id: "lifecycle", object: "chat.completion.chunk", model, choices: [choice] })}\n\n`);
			response.end("data: [DONE]\n\n"); return true;
		},
	};
}

export async function verifyBrowserLifecycle(page, scenario, requests, artifacts, root) {
	const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
	const active = () => page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);
	const send = async (text) => { await page.fill(".composer-input", text); await page.click(".send-btn"); };
	const idle = () => page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden", timeout: 90000 });
	const select = async (label) => { await page.locator(".sidebar .chat-link").filter({ hasText: `[F ${label} set]` }).first().click(); await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true"); };
	const profile = (id) => join(root, "browsers/profiles", createHash("sha256").update(id).digest("hex"));
	const exists = (path) => access(path).then(() => true, () => false);
	await page.keyboard.press("Control+Comma"); await page.getByRole("button", { name: "AI 浏览器", exact: true }).click(); await page.locator("#browser-enabled").click();
	await page.getByRole("dialog", { name: "设置", exact: true }).waitFor({ state: "detached" });
	await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	const a = await active();
	await send("[F A set] 浏览 A 并在后台等待。");
	const deadline = Date.now() + 30000;
	while ((scenario.steps.get("[F A set]") ?? 0) < 3) { assert.ok(Date.now() < deadline); await page.waitForTimeout(50); }
	await page.locator(".sidebar .new-chat").click();
	await page.waitForFunction((a) => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId !== a && document.querySelector(".sidebar")?.dataset.connected === "true", a);
	const b = await active();
	await send("[F B set] 浏览 B，保持与 A 的 cookie 独立。");
	await page.getByText("F完成:B:set", { exact: true }).waitFor({ timeout: 60000 }); await idle();
	await select("A"); await page.getByText("F完成:A:set", { exact: true }).waitFor({ timeout: 60000 }); await idle();
	assert.equal(scenario.overlapped, true, "Two real pi browser rounds must overlap, not just run in sequence");
	let first = await invoke("browser_find", { chatId: a }); const second = await invoke("browser_find", { chatId: b });
	assert.notEqual(first.generation, second.generation);
	await page.waitForFunction((a) => document.querySelector(".browser-panel")?.dataset.chatId === a && document.querySelector(".browser-screen")?.dataset.phase === "live", a);
	const initialGeneration = first.generation;
	await page.getByRole("button", { name: "关闭浏览器", exact: true }).click();
	await page.getByText("浏览器已关闭", { exact: true }).waitFor(); await idle();
	assert.equal(await page.getByRole("button", { name: "重新连接聊天", exact: true }).count(), 0);
	assert.equal((await invoke("browser_find", { chatId: b })).generation, second.generation);
	await send("[F A reopen] 再次打开网页，保留此前登录状态。");
	await page.getByText("F完成:A:reopen", { exact: true }).waitFor({ timeout: 60000 }); await idle();
	first = await invoke("browser_find", { chatId: a });
	assert.notEqual(first.generation, initialGeneration, "Reopen must create a new browser instance");
	assert.equal((await invoke("browser_find", { chatId: b })).generation, second.generation);
	await page.getByRole("button", { name: "接管浏览器", exact: true }).click(); await page.getByRole("textbox", { name: "浏览器键盘输入", exact: true }).waitFor();
	await select("B");
	await page.waitForFunction((b) => document.querySelector(".browser-panel")?.dataset.chatId === b, b);
	assert.equal(await page.getByRole("textbox", { name: "浏览器键盘输入", exact: true }).count(), 0);
	assert.equal((await invoke("browser_find", { chatId: a })).control, "human"); assert.equal((await invoke("browser_find", { chatId: b })).control, "ai");
	// Reload reconnects both pi owners lazily; the live page remains the same generation.
	await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForSelector(".composer-input");
	await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	await send("[F B read] 重连后先读取页面。"); await page.getByText("F完成:B:read", { exact: true }).waitFor({ timeout: 60000 }); await idle();
	assert.equal((await invoke("browser_find", { chatId: b })).generation, second.generation);
	await select("A");
	await page.getByRole("textbox", { name: "浏览器键盘输入", exact: true }).waitFor();
	assert.equal((await invoke("browser_find", { chatId: a })).generation, first.generation);
	await page.locator(".sidebar .chat-row").filter({ hasText: "[F A set]" }).first().click({ button: "right" });
	await page.getByRole("menu").getByRole("button", { name: "归档", exact: true }).click();
	await page.waitForFunction((a) => !!JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((chat) => chat.id === a)?.archivedAt, a);
	assert.equal(await invoke("browser_find", { chatId: a }), null); assert.equal(await exists(profile(a)), true);
	assert.equal((await invoke("browser_find", { chatId: b })).generation, second.generation);
	await page.keyboard.press("Control+Comma"); await page.getByRole("button", { name: "归档会话", exact: true }).click();
	await page.locator(".archive-session-row").filter({ hasText: "[F A set]" }).getByRole("button", { name: "恢复", exact: true }).click();
	await page.waitForFunction((a) => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId === a && document.querySelector(".sidebar")?.dataset.connected === "true", a);
	assert.equal(await invoke("browser_find", { chatId: a }), null, "Restore is lazy");
	await send("[F A restore] 显式重开并读取此前登录 cookie。"); await page.getByText("F完成:A:restore", { exact: true }).waitFor({ timeout: 60000 }); await idle();
	const restored = await invoke("browser_find", { chatId: a }); assert.notEqual(restored.generation, first.generation);
	await page.screenshot({ path: join(artifacts, "cdp-browser-lifecycle.png") });
	const row = page.locator(".sidebar .chat-row").filter({ hasText: "[F A set]" }).first();
	await row.click({ button: "right" }); await page.getByRole("menu").getByRole("button", { name: "永久删除", exact: true }).click();
	await page.getByRole("button", { name: "确认删除", exact: true }).click();
	await page.waitForFunction((a) => !JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.some((chat) => chat.id === a), a);
	assert.equal(await exists(profile(a)), false); assert.equal(await exists(profile(b)), true);
	assert.equal((await invoke("browser_find", { chatId: b })).generation, second.generation);
	assert.ok(requests.some((request) => request.payload.messages.some((message) => textOf(message).includes("F完成:A:set"))));
	await invoke("browser_retire_chat", { chatId: b, deleteProfile: true });
	await select("B");
	await page.waitForSelector(".composer-input");
	console.log("F 全链路通过：真实双 pi 并行/后台完成、独立 cookie 和画面/控制权、关闭保留工具并在同一 pi 中重开恢复 cookie、重连同实例、归档关闭保留 profile、恢复按需重开恢复 cookie、永久删除仅清理所属 profile。");
}
