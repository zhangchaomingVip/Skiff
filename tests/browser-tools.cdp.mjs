// Phase C: production UI -> real pi extension -> native lease -> real Chrome.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";

export async function createBrowserToolScenario(model) {
	const site = createServer((_request, response) => {
		response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
		if (_request.url === "/timeout") {
			const timer = setTimeout(() => response.end("<!doctype html><h1>延迟导航已完成</h1>"), 25000);
			response.on("close", () => clearTimeout(timer));
			return;
		}
		if (_request.url === "/dynamic") {
			response.end(`<!doctype html><meta charset="utf-8"><h1>动态页面验收</h1><main><button id="load">加载下一步</button></main><script>
				document.querySelector("#load").onclick = () => setTimeout(() => {
					document.querySelector("main").innerHTML = '<p>页面已替换</p><button id="confirm">动态确认</button>';
					document.querySelector("#confirm").onclick = () => {
						document.querySelector("main").textContent = "动态提交完成";
						history.pushState({}, "", "#done");
					};
				}, 300);
			</script>`);
			return;
		}
		response.end('<!doctype html><meta charset="utf-8"><style>body{font:20px system-ui;background:#f7f8fa}label{position:absolute;left:100px;top:70px}input{position:absolute;left:0;top:35px;width:350px;height:45px;font:20px system-ui}button{position:absolute;left:100px;top:190px;font:20px system-ui}</style><label>姓名<input id="name" aria-label="姓名"></label><button id="submit" onclick="this.textContent=\'完成：\'+document.querySelector(\'#name\').value">提交</button>');
	});
	await new Promise((done) => site.listen(0, "127.0.0.1", done));
	const url = `http://127.0.0.1:${site.address().port}`;
	let mode;
	let step = 0;
	let count = 0;
	let humanToolResult = "";
	let dynamicResults = [];
	const reply = "真实 pi 浏览器工具验证完成";
	const textOf = (message) => typeof message?.content === "string" ? message.content : (message?.content ?? []).map((part) => part.text ?? "").join("\n");
	const scenario = {
		set(value) { mode = value; step = 0; count = 0; dynamicResults = []; },
		get count() { return count; },
		get step() { return step; },
		get humanToolResult() { return humanToolResult; },
		get dynamicResults() { return dynamicResults; },
		close() { site.closeAllConnections(); site.close(); },
		handle(payload, response) {
			if (!mode) return false;
			count++;
			const snapshot = [...payload.messages].reverse().map(textOf).find((text) => text.includes('[ref=e') && text.includes('姓名')) ?? "";
			const ref = (role) => { const match = snapshot.match(new RegExp(`${role}.*?ref=(e\\d+)`)); assert.ok(match, `Missing ${role} reference in real snapshot: ${snapshot}`); return `@${match[1]}`; };
			let action;
			if (mode === "form") {
				switch (step) {
					case 0: action = { action: "open", url }; break;
					case 1: action = { action: "snapshot" }; break;
					case 2: action = { action: "fill", selector: ref("textbox"), text: "真实 pi 中文表单" }; break;
					case 3: action = { action: "press", key: "Tab" }; break;
					case 4: action = { action: "scroll", direction: "down", pixels: 100 }; break;
					case 5: action = { action: "wait", milliseconds: 30 }; break;
					case 6: action = { action: "snapshot" }; break;
					case 7: action = { action: "click", selector: ref("button") }; break;
					case 8: action = { action: "snapshot" }; break;
					case 9:
						assert.ok(payload.messages.some((message) => message.role === "tool" && textOf(message).includes("完成：真实 pi 中文表单")), "Real page mutation must reach model");
						action = { action: "screenshot" }; break;
					case 10:
						assert.ok(payload.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url" && part.image_url?.url.startsWith("data:image/png;base64,"))), "Screenshot must reach real pi provider as image");
						break;
					default: throw new Error("Unexpected browser step");
				}
			} else if (mode === "cancel" && step === 0) action = { action: "wait", milliseconds: 7000 };
			else if (mode === "dynamic") {
				const latest = textOf(payload.messages.at(-1));
				dynamicResults.push({ step, text: latest });
				const dynamicSnapshot = [...payload.messages].reverse().map(textOf).find((text) => text.includes("[ref=e") && text.includes("动态页面验收")) ?? "";
				const dynamicRef = (name) => {
					const match = dynamicSnapshot.match(new RegExp(`button "${name}".*?ref=(e\\d+)`));
					assert.ok(match, `Missing fresh dynamic element ${name}: ${dynamicSnapshot}`);
					return `@${match[1]}`;
				};
				switch (step) {
					case 0: action = { action: "open", url: `${url}/dynamic` }; break;
					case 1: action = { action: "snapshot" }; break;
					case 2: action = { action: "click", selector: dynamicRef("加载下一步") }; break;
					case 3: action = { action: "wait", milliseconds: 800 }; break;
					case 4: action = { action: "snapshot" }; break;
					case 5:
						assert.ok(latest.includes("页面已替换") && !latest.includes("加载下一步"), "Async DOM replacement must reach a new snapshot");
						action = { action: "click", selector: dynamicRef("动态确认") }; break;
					case 6: action = { action: "snapshot" }; break;
					case 7:
						assert.ok(latest.includes("动态提交完成"), "Fresh reference must operate on the replaced DOM");
						action = { action: "click", selector: "[" }; break;
					case 8:
						assert.match(latest, /selector|syntax|parse|选择器|无效/i, "Malformed selector must return the actual page error");
						action = { action: "click", selector: "#skiff-missing-element" }; break;
					case 9:
						assert.match(latest, /not found/i, "Missing element must return an explicit page error");
						action = { action: "open", url: `${url}/timeout` }; break;
					case 10:
						assert.match(latest, /timeout|timed out|超时/i, "Delayed navigation must return a real timeout, never success");
						assert.ok(!latest.includes("已完成"), "Timeout URL must not make a successful open satisfy the failure assertion");
						break;
					default: throw new Error("Unexpected dynamic page step");
				}
			}
			else if (mode === "resume") {
				if (step === 0) action = { action: "snapshot" };
				else if (step === 1) {
					assert.ok(textOf(payload.messages.at(-1)).includes("人工中文粘贴"), "Fresh snapshot must contain human input");
					action = { action: "click", selector: ref("button") };
				} else if (step === 2) action = { action: "snapshot" };
				else assert.ok(textOf(payload.messages.at(-1)).includes("完成：人工中文粘贴"), "AI continues on human page");
			}
			else if (mode === "snapshot" && step === 0) action = { action: "snapshot" };
			else if (mode === "human" && step === 0) action = { action: "click", selector: "#submit" };
			else if (mode === "human") humanToolResult = textOf(payload.messages.at(-1));
			const delta = action ? { tool_calls: [{ index: 0, id: `browser-${mode}-${step}`, type: "function", function: { name: "browser", arguments: JSON.stringify(action) } }] } : { content: `${reply}：${mode}` };
			step++;
			response.writeHead(200, { "Content-Type": "text/event-stream" });
			for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: action ? "tool_calls" : "stop" }]) response.write(`data: ${JSON.stringify({ id: "browser-tools", object: "chat.completion.chunk", model, choices: [choice] })}\n\n`);
			response.end("data: [DONE]\n\n");
			return true;
		},
	};
	return scenario;
}

export async function verifyBrowserTools(page, scenario, requests, artifacts) {
	const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
	const chatId = await page.evaluate(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).activeId);
	const send = async (text) => {
		const previous = requests.length;
		await page.fill(".composer-input", text); await page.click(".send-btn");
		const deadline = Date.now() + 60000;
		while (requests.length === previous) { assert.ok(Date.now() < deadline, "Composer must reach real provider"); await new Promise((done) => setTimeout(done, 50)); }
	};
	const idle = () => page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden", timeout: 90000 });
	const settings = page.getByRole("dialog", { name: "设置", exact: true });
	const toggle = async () => {
		await page.keyboard.press("Control+Comma");
		await settings.getByRole("button", { name: "AI 浏览器", exact: true }).click();
		await settings.locator("#browser-enabled").click();
		await settings.waitFor({ state: "detached" });
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
	};
	assert.equal((await invoke("browser_dependencies")).enabled, false);
	await send("先验证默认禁用浏览器的普通聊天。"); await idle();
	assert.ok(!requests.at(-1).payload.tools.some((tool) => tool.function.name === "browser"));
	assert.equal(await invoke("browser_find", { chatId }), null);
	await toggle();
	assert.equal((await invoke("browser_dependencies")).enabled, true);
	assert.equal(await invoke("browser_find", { chatId }), null, "Enabling/reconnecting must not start Chrome");
	scenario.set("form");
	await send("打开本地表单，填写中文姓名并提交，核对结果和截图。");
	await page.getByText("真实 pi 浏览器工具验证完成：form", { exact: true }).waitFor({ timeout: 120000 }); await idle();
	assert.equal(scenario.count, 11);
	assert.ok(requests.at(-1).payload.tools.some((tool) => tool.function.name === "browser"));
	await page.getByRole("button", { name: "展开本轮执行过程", exact: true }).last().click();
	const captureTool = page.locator(".tool").filter({ has: page.locator("summary", { hasText: "截取页面" }) }).last();
	await captureTool.locator(":scope > summary").click();
	await captureTool.getByRole("button", { name: "放大图片：浏览器页面截图", exact: true }).click();
	await page.getByRole("dialog", { name: "图片预览", exact: true }).waitFor();
	await page.getByRole("button", { name: "关闭图片预览", exact: true }).click();
	const fillTool = page.locator(".tool").filter({ has: page.locator("summary", { hasText: "填写字段" }) }).first();
	await fillTool.locator(":scope > summary").click();
	assert.match(await fillTool.textContent(), /填写内容已隐藏/);
	await page.getByRole("button", { name: "收起本轮执行过程", exact: true }).last().click();
	const status = await invoke("browser_find", { chatId });
	assert.equal(status?.chatId, chatId, "Tools must bind to actual launcher chat, independent of RPC instance id");
	assert.equal(status.control, "ai");
	const browserPanel = page.getByRole("region", { name: "浏览器画面", exact: true });
	await browserPanel.waitFor();
	await page.locator('.browser-screen[data-phase="live"]').waitFor({ timeout: 30000 });
	assert.equal(await browserPanel.getAttribute("data-chat-id"), chatId);
	assert.equal(await browserPanel.getAttribute("data-generation"), status.generation);
	assert.ok(await page.locator(".browser-screen canvas").evaluate((canvas) => canvas.width > 0 && canvas.height > 0 && canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3] === 255), "Production canvas must paint decoded Chrome JPEG");
	await page.fill(".composer-input", "面板收起后保留这段草稿");
	await page.getByRole("button", { name: "收起浏览器", exact: true }).click();
	await browserPanel.waitFor({ state: "detached" });
	await page.getByRole("button", { name: "浏览器", exact: true }).click();
	await page.locator('.browser-screen[data-phase="live"]').waitFor({ timeout: 30000 });
	assert.equal(await page.inputValue(".composer-input"), "面板收起后保留这段草稿");
	await page.fill(".composer-input", "");
	console.log("产品浏览器面板通过：首次自动展开、实例归属、真实 Chrome JPEG 解码绘制、收起重连及草稿保留。");
	const target = { chatId: status.chatId, generation: status.generation };
	try {
		await page.screenshot({ path: join(artifacts, "cdp-browser-tools.png") });
		await page.screenshot({ path: join(artifacts, "cdp-browser-panel.png") });
		await invoke("browser_control", { target, operation: "takeOver" });
		scenario.set("human"); await send("人工接管期间验证工具拒绝点击。");
		await page.getByText("真实 pi 浏览器工具验证完成：human", { exact: true }).waitFor({ timeout: 60000 }); await idle();
		assert.match(scenario.humanToolResult, /接管|控制权/, "Takeover must return an explicit error to pi");
		assert.ok(await page.locator(".tool-state.failed").count() > 0, "pi tool_result hook must mark takeover as error");
		await invoke("browser_control", { target, operation: "return" });
		scenario.set("snapshot"); await send("读取交还后的新页面。");
		await page.getByText("真实 pi 浏览器工具验证完成：snapshot", { exact: true }).waitFor(); await idle();
		scenario.set("cancel"); await send("开始等待，随后用户将接管。");
		await page.locator(".tool-state.running").last().waitFor({ state: "attached" }); await page.waitForTimeout(1000);
		await page.getByRole("button", { name: "接管浏览器", exact: true }).click();
		await page.getByText("正在接管，请等待在途操作结束…", { exact: true }).waitFor();
		assert.equal(await page.getByRole("textbox", { name: "浏览器键盘输入", exact: true }).count(), 0);
		const keyboard = page.getByRole("textbox", { name: "浏览器键盘输入", exact: true });
		await keyboard.waitFor({ timeout: 30000 }); await idle();
		assert.equal(scenario.count, 1, "Takeover interrupts pi without another provider request");
		const point = await page.locator(".browser-screen canvas").evaluate((canvas) => {
			const r = canvas.getBoundingClientRect(); const scale = Math.min(r.width / canvas.width, r.height / canvas.height);
			return { x: r.left + (r.width - canvas.width * scale) / 2 + 160 * scale, y: r.top + (r.height - canvas.height * scale) / 2 + 125 * scale };
		});
		await page.mouse.click(point.x, point.y); await page.keyboard.press("Control+A");
		await keyboard.evaluate((element) => {
			element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
			element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "人工中文" }));
			const clipboardData = new DataTransfer(); clipboardData.setData("text/plain", "粘贴");
			element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData }));
		});
		await page.getByRole("button", { name: "交还 AI", exact: true }).click();
		await page.getByRole("button", { name: "继续浏览任务", exact: true }).waitFor();
		scenario.set("resume");
		await page.getByRole("button", { name: "继续浏览任务", exact: true }).click();
		await page.getByText("真实 pi 浏览器工具验证完成：resume", { exact: true }).waitFor({ timeout: 60000 }); await idle();
		assert.equal(scenario.count, 4);
		await page.screenshot({ path: join(artifacts, "cdp-browser-control.png") });
		console.log("人工接管通过：在途 wait 排空后才开放输入、pi 轮次中断、缩放坐标点击、Control+A、中文 composition 与粘贴、交还输入确认、新 snapshot 及 AI 使用新引用继续提交。");
		scenario.set("cancel"); await send("开始长等待以验证停止。");
		await page.locator(".tool-state.running").last().waitFor({ state: "attached" });
		// Allow the real extension to reach native wait, then use the actual composer abort.
		await page.waitForTimeout(1000);
		await page.getByRole("button", { name: "停止生成", exact: true }).click(); await idle();
		await page.waitForFunction(async (target) => (await window.__TAURI_INTERNALS__.invoke("browser_status", { target })).control === "stopped", target, { timeout: 20000 });
		assert.equal(scenario.count, 1, "Abort must not start another provider request");
		await page.getByRole("button", { name: "交还 AI", exact: true }).click();
		scenario.set("snapshot"); await send("停止后读取新页面。");
		await page.getByText("真实 pi 浏览器工具验证完成：snapshot", { exact: true }).last().waitFor(); await idle();
		scenario.set("cancel"); await send("使用浏览器面板停止本轮。");
		await page.locator(".tool-state.running").last().waitFor({ state: "attached" }); await page.waitForTimeout(500);
		await page.getByRole("button", { name: "停止任务", exact: true }).click(); await idle();
		await page.waitForFunction(async (target) => (await window.__TAURI_INTERNALS__.invoke("browser_status", { target })).control === "stopped", target, { timeout: 20000 });
		await page.getByRole("button", { name: "交还 AI", exact: true }).click();
		scenario.set("snapshot"); await send("动态验收前读取停止后的新页面。");
		await page.getByText("真实 pi 浏览器工具验证完成：snapshot", { exact: true }).last().waitFor(); await idle();
		scenario.set("dynamic"); await send("验证动态页面：等待异步 DOM 替换后读取新 snapshot，使用新引用提交，再核对错误和超时。");
		await page.getByText("真实 pi 浏览器工具验证完成：dynamic", { exact: true }).waitFor({ timeout: 90000 }).catch((error) => { throw new Error(`${error.message}\nDynamic scenario: ${JSON.stringify(scenario.dynamicResults)}`); }); await idle();
		assert.equal(scenario.count, 11);
		assert.equal(await page.locator(".turn-process-head").last().locator(".tool .tool-state.failed").count(), 3, "Both selector errors and navigation timeout must be failed tools in this turn");
		assert.equal((await invoke("browser_status", { target })).control, "faulted", "Uncertain navigation timeout must close the mutation gate");
		await page.getByRole("button", { name: "展开本轮执行过程", exact: true }).last().click();
		const timeoutTool = page.locator(".tool").filter({ has: page.locator("summary", { hasText: "/timeout" }) }).last();
		await timeoutTool.locator(":scope > summary").click();
		assert.match(await timeoutTool.textContent(), /超时/, "Native timeout outcome must survive pi and UI parsing");
		await page.screenshot({ path: join(artifacts, "cdp-browser-dynamic.png") });
		await page.getByRole("button", { name: "收起本轮执行过程", exact: true }).last().click();
		console.log("动态页面通过：异步 DOM 替换后读取新 snapshot 和引用，真实选择器错误/导航超时均标记失败；不确定超时进入故障并关闭操作入口。");
		scenario.set(undefined);
		await toggle();
		await send("关闭浏览器能力后验证普通聊天。"); await idle();
		assert.ok(!requests.at(-1).payload.tools.some((tool) => tool.function.name === "browser"));
		assert.equal((await invoke("browser_status", { target })).generation, status.generation, "Disabling retains page");
		await page.getByRole("button", { name: "关闭并重新准备", exact: true }).click();
		await page.getByText("浏览器已关闭", { exact: true }).waitFor();
		await page.waitForFunction(() => document.querySelector(".sidebar")?.dataset.connected === "true");
		assert.equal((await invoke("browser_status", { target })).control, "closed", "Fault recovery must confirm resource closure");
		console.log("浏览器工具全链路通过：默认禁用、设置重连、按需启动、8 类操作、真实 snapshot 引用与中文提交、图片、人工接管错误、pi abort 排空及禁用后普通聊天。");
	} finally { await invoke("browser_close", { target }).catch(() => {}); }
}
