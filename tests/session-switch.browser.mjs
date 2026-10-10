// SKIFF_PLAYWRIGHT_DIR can point to an existing Playwright installation.
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = process.env.SKIFF_PLAYWRIGHT_DIR ? require(process.env.SKIFF_PLAYWRIGHT_DIR) : await import("playwright");
const origin = process.argv[2] ?? "http://localhost:1431";
const destination = process.argv[3] ?? "dist/session-switch-results.json";
const baseline = process.argv.includes("--baseline");
const perfOnly = process.argv.includes("--perf-only");
const profile = process.argv.includes("--profile");
const queryIndex = process.argv.indexOf("--query");
const fixtureQuery = queryIndex < 0 ? "" : process.argv[queryIndex + 1];
const samplesIndex = process.argv.indexOf("--samples");
const sampleCount = samplesIndex < 0 ? 60 : Number(process.argv[samplesIndex + 1]);
if (!Number.isInteger(sampleCount) || sampleCount < 2 || sampleCount % 2) throw new Error("--samples must be a positive even count of at least 2");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
const report = { browser: browser.version(), mode: "production", profile, fixtureQuery, viewport: [1440, 1000], cpuThrottle: 1, baseline, checks: [], samples: [], errors };
const cdp = profile ? await page.context().newCDPSession(page) : undefined;
let tracing = false;
const check = (value, name) => { report.checks.push({ name, passed: !!value }); if (!value && !baseline) throw new Error(name); };
const data = () => page.evaluate(() => {
	const f = window.switchFixture;
	return { spans: f.spans, renders: f.renders, clicks: f.clicks, tasks: f.tasks, commits: f.commits, timings: f.timings, scale: f.scale, sidebarRows: document.querySelectorAll(".chat-link").length, processes: f.mock.processes.size, listeners: f.mock.listeners.size };
});
const ready = (id) => page.waitForFunction((id) => window.switchFixture?.renders.at(-1)?.id === id && window.switchFixture.renders.at(-1)?.connected, id, { timeout: 60000 });
const open = async (query = fixtureQuery) => { await page.goto(`${origin}/tests/session-switch.html?fixture=sidebar&${query}`); await ready("s0"); };
const row = (id) => page.locator(`.sidebar-recent .chat-link[title="Session ${id}"]`);
const select = (id) => row(id).click({ timeout: perfOnly ? 60000 : 800, position: { x: 20, y: 15 } });
async function stopSampling() {
	report.failure = "Fixture exceeded the 5 minute sampling budget; incomplete, not a passing measurement.";
	await writeFile(destination, JSON.stringify(report, null, 2));
	try { report.performance = await data(); } catch { /* A stalled page may not answer. */ }
	await writeFile(destination, JSON.stringify(report, null, 2));
	await browser.close();
	process.exit(1);
}
process.once("SIGTERM", stopSampling);
process.once("message", (message) => { if (message?.type === "stop") void stopSampling(); });
const clean = async () => {
	await page.evaluate(() => window.switchFixture.unmount());
	await page.waitForFunction(() => window.switchFixture.mock.processes.size === 0 && window.switchFixture.mock.listeners.size === 0 && window.switchFixture.mock.callbacks.size === 0);
};
async function regressions() {
	for (const type of ["switch_session", "get_messages"]) {
		await open();
		await page.evaluate((type) => window.switchFixture.hold(type), type);
		await select(1);
		await page.waitForFunction(() => window.switchFixture.held());
		const old = await page.evaluate(() => [...window.switchFixture.mock.processes.keys()][0]);
		await select(2);
		await ready("s2"); // Barrier stays held: old RPC must be rejected by stop.
		check(await page.locator('.selected .chat-link').getAttribute("title") === "Session 2", `${type} 挂起时真实导航不等待 35 秒超时`);
		const before = await page.evaluate(() => JSON.stringify(window.switchFixture.renders.at(-1)));
		await page.evaluate((old) => {
			const f = window.switchFixture;
			for (const listener of f.mock.listeners.values()) if (listener.event === `rpc-stderr://${old}`) f.mock.callbacks.get(listener.handler)?.({ payload: "stale stderr" });
			f.mock.emit(old, { type: "error", errorMessage: "stale error" });
			f.mock.emit(old, { type: "bridge_exit", message: "stale exit" });
			f.mock.emit(old, { type: "message_end", message: { role: "assistant", content: "stale history" } });
			f.release("late failure");
		}, old);
		await page.waitForTimeout(30);
		check(await page.evaluate(() => JSON.stringify(window.switchFixture.renders.at(-1))) === before, `${type} 迟到错误、消息、stderr 与退出均不污染当前快照`);
		await clean();
	}
	await open();
	await page.evaluate(() => window.switchFixture.hold("rpc_start"));
	await select(1); await page.waitForFunction(() => window.switchFixture.held());
	await select(2); await select(0);
	const latest = await page.evaluate(() => window.switchFixture.renders.at(-1).owner.generation);
	await page.evaluate(() => window.switchFixture.release());
	await ready("s0");
	const sequence = await data();
	check(sequence.renders.at(-1).owner.generation === latest && sequence.processes === 1, "A→B→C→A 最新批次生效，跳过已过期的启动及后续初始化");
	check(sequence.spans.filter((span) => span.type === "switch_session").length === 2, "等待启动时被越过的目标没有恢复或读取历史");
	const countBefore = sequence.spans.length;
	await select(0); await page.waitForTimeout(40);
	check((await data()).spans.length === countBefore, "重复选择当前目标不启动、恢复或读取历史");
	await clean();
	for (const type of ["rpc_start", "switch_session", "get_messages"]) {
		await open(); await page.evaluate((type) => window.switchFixture.hold(type), type);
		await select(1); await page.waitForFunction(() => window.switchFixture.held());
		await page.evaluate(() => window.switchFixture.release("fixture initialization failed"));
		await page.getByRole("button", { name: "重新连接", exact: true }).waitFor();
		check((await page.getByRole("alert").innerText()).includes("fixture initialization failed"), `${type} 初始化失败展示当前错误与重试入口`);
		if (type === "rpc_start") {
			await page.locator('.home-nav').click();
			check((await page.getByRole("alert").innerText()).includes("fixture initialization failed") && await page.getByRole("button", { name: "重新连接", exact: true }).count() === 1, "Launcher 同样显示当前初始化错误与重试入口");
			await page.getByRole("button", { name: "返回聊天", exact: true }).click();
		}
		check(await page.locator('[aria-label="正在加载会话"]').count() === 0, `${type} 失败不永久 loading`);
		const failedGeneration = await page.evaluate(() => window.switchFixture.renders.at(-1).owner.generation);
		await page.getByRole("button", { name: "重新连接", exact: true }).click(); await ready("s1");
		check((await data()).renders.at(-1).owner.generation !== failedGeneration, `${type} 同 ID 重试建立独立批次`);
		await select(2); await ready("s2"); await clean();
	}
	await open();
	await page.evaluate(() => window.switchFixture.hold("get_messages"));
	await select(1); await page.waitForFunction(() => window.switchFixture.held());
	await row(2).focus(); await page.keyboard.press("Enter"); await ready("s2");
	check((await data()).renders.at(-1).id === "s2", "键盘 Enter 可在加载期间选择跨项目会话");
	await page.evaluate(() => window.switchFixture.release());
	await page.evaluate(() => window.switchFixture.hold("get_messages"));
	await select(1); await page.waitForFunction(() => window.switchFixture.held());
	await page.locator('.project-select').filter({ hasText: "Project B" }).click(); await ready("s2");
	check((await data()).renders.at(-1).id === "s2", "项目选择在加载期间可用");
	await page.evaluate(() => window.switchFixture.release());
	await page.evaluate(() => window.switchFixture.hold("get_messages"));
	await select(1); await page.waitForFunction(() => window.switchFixture.held());
	await row(2).click({ button: "right", position: { x: 20, y: 15 } });
	await page.getByRole("menu").getByRole("button", { name: "打开", exact: true }).click(); await ready("s2");
	check((await data()).renders.at(-1).id === "s2", "右键菜单在加载期间可打开已有会话");
	await page.evaluate(() => window.switchFixture.release());
	await page.evaluate(() => window.switchFixture.hold("get_messages"));
	await select(1); await page.waitForFunction(() => window.switchFixture.held());
	await page.locator('.home-nav').click();
	await page.locator('.launcher-recent-row').filter({ hasText: "Session 2" }).click(); await ready("s2");
	check((await data()).renders.at(-1).id === "s2", "Launcher 最近会话在加载期间可打开");
	await page.evaluate(() => window.switchFixture.release());
	await row(1).click({ button: "right", position: { x: 20, y: 15 } });
	await page.evaluate(() => { const f = window.switchFixture; f.mock.emit([...f.mock.processes.keys()][0], { type: "agent_start" }); });
	check(await page.getByRole("menu").getByRole("button", { name: "打开", exact: true }).isDisabled(), "已打开的右键菜单在生成开始后也遵守导航限制");
	await page.evaluate(() => { const f = window.switchFixture; f.mock.emit([...f.mock.processes.keys()][0], { type: "agent_end" }); });
	await page.keyboard.press("Escape");
	await page.evaluate(() => window.switchFixture.hold("prompt"));
	await page.locator('textarea').fill("s2 fixture message pending");
	await page.getByRole("button", { name: "发送消息", exact: true }).click();
	await page.waitForFunction(() => window.switchFixture.held());
	check(await row(1).isDisabled() && await page.evaluate(() => window.switchFixture.currentSession.pending), "发送请求挂起而 agent_start 尚未到达时仍禁止导航");
	await page.evaluate(() => window.switchFixture.release());
	await page.getByRole("button", { name: "停止生成", exact: true }).click();
	await page.waitForFunction(() => !window.switchFixture.currentSession.pending && !window.switchFixture.currentSession.state.isStreaming);
	await page.locator('textarea').fill("s2 fixture message draft");
	await page.getByRole("button", { name: "发送消息", exact: true }).click();
	await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
	check(await row(1).isDisabled() && await page.locator('.project-select').first().isDisabled(), "生成中侧栏与项目入口被禁用");
	await page.locator('.home-nav').click();
	check(await page.locator('.launcher-recent-row').first().isDisabled(), "生成中 Launcher 已有会话入口被禁用");
	await page.getByRole("button", { name: "当前工作区", exact: true }).click();
	check(await page.locator('.launcher-ws-item').first().isDisabled(), "生成中 Launcher 项目入口被禁用");
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "返回聊天", exact: true }).click();
	await page.getByRole("button", { name: "停止生成", exact: true }).click();
	await page.waitForFunction(() => !window.switchFixture.currentSession.state.isStreaming);
	await page.evaluate(() => { const f = window.switchFixture; f.hold("set_model"); void f.derivedState.selectModel({ provider: "skiff-relay-r2-deepseek", id: "deepseek-chat", routeId: "route-deepseek-r2", offerId: "route-deepseek-r2/deepseek-chat" }); });
	await page.waitForFunction(() => window.switchFixture.held());
	check(await row(1).isDisabled(), "修改模型请求未完成时导航被禁用");
	await page.evaluate(() => window.switchFixture.release());
	await page.waitForFunction(() => !window.switchFixture.currentSession.pending);
	await page.waitForFunction(() => JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats.find((c) => c.id === "s2").selectedModel.provider === "skiff-relay-r2-deepseek");
	await select(1); await ready("s1"); await select(2); await ready("s2");
	check(await page.evaluate(() => {
		const chats = JSON.parse(localStorage.getItem("skiff.workspace.v1")).chats;
		return chats.every((c) => c.sessionFile === `${c.id}.jsonl` && c.routeEvents.every((e) => e.sessionId === c.id) && c.routeSnapshots[0].relayName === `fixture-${c.id}`) && chats.find((c) => c.id === "s2").routeEvents.length === 2 && chats.find((c) => c.id === "s2").elapsedMs >= 200;
	}), "文件、模型选择、RouteSnapshot、RouteEvent 和计时按会话持久化");
	await page.goto(`${origin}/tests/session-switch.html?restore=1`); await ready("s2");
	check(await page.evaluate(() => {
		const f = window.switchFixture; return f.currentSession.state.model.provider === "skiff-relay-r2-deepseek" && f.currentSession.state.messages[1].routeSnapshot.relayName === "fixture-s2" && f.derivedState.routeEvents.length === 2;
	}), "重载后模型与会话归属元数据仍正确");
	await clean();
	await open();
	await page.getByRole("textbox", { name: "聊天消息", exact: true }).fill("local draft");
	await page.locator('input[type="file"]').setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("local fixture attachment") });
	await page.waitForFunction(() => document.querySelector('.composer')?.textContent.includes("draft.txt"));
	await page.evaluate(() => window.switchFixture.currentSession.reconnect()); await ready("s0");
	check(await page.getByRole("textbox", { name: "聊天消息", exact: true }).inputValue() === "local draft", "同会话重连保留草稿");
	await select(1); await ready("s1");
	check(await page.getByRole("textbox", { name: "聊天消息", exact: true }).inputValue() === "" && !await page.locator('.composer').innerText().then((text) => text.includes("draft.txt")), "不同会话子树隔离草稿与附件");
	await page.locator('.msg.user').first().hover();
	await page.getByRole("button", { name: "编辑并重发", exact: true }).first().click();
	check(await page.locator('.editing-banner').count() === 1, "会话编辑状态可进入");
	await select(2); await ready("s2");
	check(await page.locator('.editing-banner').count() === 0, "切换后不继承旧会话编辑状态");
	await clean();
	await open("kind=tool");
	await page.getByRole("button", { name: "收起本轮执行过程", exact: true }).first().click();
	await page.locator('.messages').evaluate((element) => element.scrollTo(0, 0));
	await select(1); await ready("s1");
	check(await page.getByRole("button", { name: "收起本轮执行过程", exact: true }).count() === 1 && await page.getByRole("button", { name: "回到底部", exact: true }).count() === 0, "跨会话执行折叠与滚动跟随状态隔离");
	await clean();
	await open("empty=1"); await select(1); await ready("s1");
	check(await page.locator('.empty').count() === 1 && await page.locator('[aria-label="正在加载会话"]').count() === 0, "空历史成功后展示空会话，结束加载");
	await clean();
	// Hook-level supplements cover transitions absent from ordinary navigation.
	await open();
	await page.evaluate(() => { const f = window.switchFixture; f.setDelay(0); f.mountProbe({ id: "probe", cwd: "D:/workspace/Skiff", sessionFile: "s0.jsonl" }); });
	await page.waitForFunction(() => window.switchFixture.probe?.connected);
	const firstGeneration = await page.evaluate(() => window.switchFixture.probe.owner.generation);
	await page.evaluate(() => { const f = window.switchFixture; f.hold("get_messages"); f.probe.reconnect({ provider: "custom", id: "new-model" }); });
	await page.waitForFunction(() => window.switchFixture.held());
	check(await page.evaluate((generation) => { const p = window.switchFixture.probe; return p.owner.generation !== generation && p.state.messages.length === 0 && !p.state.model && p.phase === "loading"; }, firstGeneration), "同 ID 重连期间模型和历史立即隔离");
	const staleRpc = await page.evaluate(() => [...window.switchFixture.mock.processes.keys()][0]);
	await page.evaluate(() => window.switchFixture.setTarget({ id: "probe", cwd: "D:/workspace/demo", sessionFile: "s2.jsonl", model: { provider: "custom", id: "cwd-model" } }));
	await page.waitForFunction(() => window.switchFixture.probe?.connected && window.switchFixture.probe.state.model?.id === "cwd-model");
	await page.evaluate((id) => { const f = window.switchFixture; f.release(); f.mock.emit(id, { type: "bridge_exit", message: "stale cwd exit" }); }, staleRpc);
	check(await page.evaluate((generation) => { const p = window.switchFixture.probe; return p.owner.generation !== generation && p.owner.cwd === "D:/workspace/demo" && !p.state.lastError && p.connected && p.sessionFile === "s2.jsonl"; }, firstGeneration), "同 ID cwd 变化及旧批次成功/退出均不覆盖最新模型和文件");
	await page.evaluate(() => { const f = window.switchFixture; f.hold("rpc_start"); f.probe.reconnect({ provider: "custom", id: "stale-preference" }); });
	await page.waitForFunction(() => window.switchFixture.held());
	await page.evaluate(() => window.switchFixture.setTarget({ id: "probe", cwd: "D:/workspace/Skiff", sessionFile: "s0.jsonl", model: { provider: "custom", id: "current-preference" } }));
	await page.waitForFunction(() => window.switchFixture.probe.owner.cwd === "D:/workspace/Skiff");
	await page.evaluate(() => window.switchFixture.release());
	await page.waitForFunction(() => window.switchFixture.probe?.connected);
	check(await page.evaluate(() => window.switchFixture.probe.state.model?.id === "current-preference"), "启动未完成的重连模型偏好不跨 cwd 批次继承");
	await clean();
	check((await data()).listeners === 0, "连续切换与卸载后进程和监听器清理完成");
}
try {
	if (!perfOnly) {
	await open();
	await page.evaluate(() => window.switchFixture.hold("rpc_start"));
	await select(1);
	await page.waitForFunction(() => window.switchFixture.held());
	check(!await row(2).isDisabled(), "启动挂起时跨项目会话按钮可用");
	try { await select(2); } catch (error) { if (!baseline) throw error; }
	check(await page.locator('.sidebar-recent .selected .chat-link').getAttribute("title") === "Session 2", "A 启动未释放即可真实点击选中 B");
	check((await data()).clicks.some((event) => event.title === "Session 2" && event.trusted), "B 点击进入真实事件处理入口");
	check(await page.locator('[aria-label="正在加载会话"]').count() === 1, "目标会话立即显示加载反馈");
	await page.screenshot({ path: destination.replace(/\.json$/, ".loading.png"), fullPage: true });
	await page.evaluate(() => window.switchFixture.release());
	await ready(baseline ? "s1" : "s2");
	check((await data()).processes === 1, "迟到启动已清理，只保留当前进程");
	report.reproduction = await data();
	await page.evaluate(() => window.switchFixture.unmount());
	await page.waitForFunction(() => window.switchFixture.mock.processes.size === 0 && window.switchFixture.mock.listeners.size === 0);
	}
	await open();
	report.assets = await page.locator('script[src]').evaluateAll((scripts) => scripts.map((script) => script.src));
	report.cold = await data();
	// Warm up; measure trusted clicks independently from React profiling.
	await select(1); await ready("s1"); await select(0); await ready("s0");
	if (cdp) { await cdp.send("Tracing.start", { categories: "devtools.timeline,v8,disabled-by-default-v8.cpu_profiler", transferMode: "ReturnAsStream" }); tracing = true; }
	for (let index = 0; index < sampleCount; index++) {
		const id = index % 2 ? 0 : 1;
		await page.evaluate((id) => {
			const result = { id, start: 0, highlight: undefined, loading: undefined, paintOpportunity: undefined, history: undefined, ready: undefined, mountedAtHighlight: undefined, mountedReady: undefined };
			window.switchMeasurement = result;
			const observe = () => {
				if (!result.start) return;
				const selected = document.querySelector('.sidebar-recent .selected .chat-link')?.title === `Session ${id}`;
				if (selected && result.highlight === undefined) { result.highlight = performance.now() - result.start; result.mountedAtHighlight = document.querySelectorAll('.msg').length; requestAnimationFrame(() => requestAnimationFrame(() => { result.paintOpportunity = performance.now() - result.start; })); }
				if (selected && document.querySelector('[aria-label="正在加载会话"]') && result.loading === undefined) result.loading = performance.now() - result.start;
				const snapshot = window.switchFixture.renders.at(-1);
				if (snapshot?.id === `s${id}` && snapshot?.connected && document.querySelector('.msg') && result.history === undefined) result.history = performance.now() - result.start;
				if (snapshot?.id === `s${id}` && snapshot?.sendable) { result.ready = performance.now() - result.start; result.mountedReady = document.querySelectorAll('.msg').length; observer.disconnect(); }
			};
			const observer = new MutationObserver(observe); observer.observe(document.getElementById("root"), { subtree: true, childList: true, attributes: true });
			document.addEventListener("click", () => { result.start = performance.now(); }, { capture: true, once: true });
		}, id);
		await select(id); await ready(`s${id}`);
		await page.waitForFunction(() => window.switchMeasurement.paintOpportunity !== undefined);
		report.samples.push(await page.evaluate(() => window.switchMeasurement));
		if (index % 10 === 9) await writeFile(destination, JSON.stringify(report, null, 2));
	}
	report.performance = await data();
	const percentile = (values, p) => values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
	report.summary = Object.fromEntries(["highlight", "loading", "paintOpportunity", "history", "ready"].map((key) => {
		const values = report.samples.map((sample) => sample[key]).filter((value) => value !== undefined);
		return [key, { n: values.length, p50: percentile([...values], .5), p95: percentile([...values], .95) }];
	}));
	check(report.performance.renders.every((render) => render.foreignMessages === 0), "每次正式 App 渲染均未把旧历史交给新会话子树");
	await page.screenshot({ path: destination.replace(/\.json$/, ".png"), fullPage: true });
	if (!baseline && !perfOnly) await regressions();
} catch (error) { report.failure = String(error.stack); }
finally {
	if (tracing) {
		const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
		await cdp.send("Tracing.end");
		const { stream } = await complete;
		let trace = "";
		for (;;) { const chunk = await cdp.send("IO.read", { handle: stream }); trace += chunk.data; if (chunk.eof) break; }
		await cdp.send("IO.close", { handle: stream });
		await writeFile(destination.replace(/\.json$/, ".trace.json"), trace);
	}
	if (errors.length && !baseline) report.failure ??= `Browser errors: ${errors.join("; ")}`;
	await writeFile(destination, JSON.stringify(report, null, 2)); await browser.close();
	if (process.connected) process.disconnect();
}
console.log(JSON.stringify({ checks: report.checks, summary: report.summary, failure: report.failure, errors }, null, 2));
if (report.failure) process.exitCode = 1;
