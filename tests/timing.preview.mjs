// Open /tests/timing.html on the isolated Vite preview port. Uses only local mock pi.
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { usePiSession } from "../src/chat/usePiSession";
import { VoyageWorkspace } from "../src/components/VoyageWorkspace";
import { installMockPi } from "./mockPi.mjs";
import "../src/tokens.css";
import "../src/index.css";
import "../src/voyage.css";
import "../src/components/ui.css";

const mock = installMockPi(window);
const root = createRoot(document.getElementById("root"));
const output = document.getElementById("results");
const results = [];
const realNow = Date.now;
let now = realNow();
Date.now = () => now;
let latest;
let target = { id: "timing", cwd: "D:\\workspace\\demo" };
let restoration;
let holdPrompts = false;
const heldPrompts = [];
const invoke = window.__TAURI_INTERNALS__.invoke;
window.__TAURI_INTERNALS__.invoke = async (command, args) => {
	if (holdPrompts && command === "rpc_send" && JSON.parse(args.message).type === "prompt") {
		heldPrompts.push({ ...args, request: JSON.parse(args.message) });
		return;
	}
	const result = await invoke(command, args);
	if (command === "rpc_start" && restoration) {
		Object.assign(mock.processes.get(args.options.instanceId), restoration);
		restoration = undefined;
	}
	return result;
};
const search = { available: false, configured: false, extensionInstalled: false, enabled: false, busy: false, toggle: async () => {}, clearKey: async () => {}, install: async () => {}, refresh: () => {} };
const noop = () => {};
const send = (text, images) => latest.actions.prompt(text, images);
const intervals = new Set();
const originalInterval = window.setInterval;
const originalClear = window.clearInterval;
window.setInterval = (...args) => { const id = originalInterval(...args); intervals.add(id); return id; };
window.clearInterval = (id) => { intervals.delete(id); originalClear(id); };

function Harness() {
	latest = usePiSession(target);
	return React.createElement(VoyageWorkspace, { state: latest.state, connected: latest.connected, pending: latest.pending, actions: latest.actions, onSend: send, onReconnect: latest.reconnect, search, onConfigureSearch: noop });
}
function render() { root.render(React.createElement(StrictMode, null, React.createElement(Harness))); }
function assert(value, message) { if (!value) throw new Error(message); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function until(check, message) {
	const deadline = performance.now() + 5000;
	while (!check()) { if (performance.now() > deadline) throw new Error(message); await delay(10); }
}
function record(message) { results.push(`PASS ${message}`); output.textContent = results.join("\n"); }
function emit(event) { mock.emit([...mock.processes.keys()][0], event); }
function header() { return [...document.querySelectorAll(".turn-header")].at(-1)?.textContent; }
function rail() { return document.querySelector(".voyage-turn dd")?.textContent; }
async function advance(ms) { now += ms; await delay(150); }
function begin() {
	emit({ type: "agent_start" });
	emit({ type: "message_start", message: { role: "user", content: "计时测试" } });
	emit({ type: "message_start", message: { role: "assistant" } });
	emit({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
	emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "这是没有后续消息到达的长时间思考过程。" } });
}
const waiting = () => [...document.querySelectorAll(".msg.assistant")].at(-1)?.textContent.includes("等待回复…");
function answer(held, success = true) {
	mock.emit(held.instanceId, { type: "response", id: held.request.id, success, data: success ? {} : undefined, error: success ? undefined : "Simulated send rejection" });
}
async function takePrompt(action) {
	const task = action();
	await until(() => heldPrompts.length > 0, "Prompt was not dispatched");
	return { task, held: heldPrompts.shift() };
}
function confirmUser(held) {
	const session = mock.processes.get(held.instanceId);
	session.isStreaming = true;
	const user = { role: "user", timestamp: now, content: held.request.images?.length ? [...(held.request.message ? [{ type: "text", text: held.request.message }] : []), ...held.request.images] : held.request.message };
	session.messages.push(user);
	emit({ type: "agent_start" });
	emit({ type: "message_start", message: user });
	emit({ type: "message_end", message: user });
}
async function finishReply(held, text = "回复完成") {
	const session = mock.processes.get(held.instanceId);
	const assistant = { role: "assistant", content: [{ type: "text", text }], provider: session.model.provider, model: session.model.id, usage: { input: 10, cacheRead: 0, cacheWrite: 0, output: 5, totalTokens: 15 } };
	session.messages.push(assistant);
	session.isStreaming = false;
	emit({ type: "message_end", message: assistant });
	emit({ type: "agent_end" });
	answer(held);
	await until(() => !latest.pending && !latest.state.isStreaming, "Reply did not settle");
}
function setDraft(text) {
	const input = document.querySelector('[aria-label="聊天消息"]');
	Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, text);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

try {
	render();
	await until(() => latest?.connected, "Session did not connect");
	document.querySelector('[aria-label="展开航行台"]')?.click();
	await until(() => document.querySelector(".voyage-turn"), "Rail did not expand");
	holdPrompts = true;
	const sent = await takePrompt(() => latest.actions.prompt("慢速请求"));
	await until(waiting, "Missing immediate assistant placeholder");
	assert(document.querySelectorAll(".msg.user").length === 1 && document.querySelectorAll(".msg.assistant").length === 1, "Optimistic rows missing");
	assert(latest.state.messages.length === 0 && rail() === "0s", "Optimistic rows entered history or clock missing");
	assert(document.querySelector(".msg.assistant .msg-role").textContent.includes(latest.state.model.name), "Placeholder model label missing");
	assert(!document.querySelector(".msg.assistant").textContent.includes("0步"), "Placeholder invented steps");
	await advance(2200);
	assert(rail() === "2s" && document.querySelector(".msg.assistant").textContent.includes("耗时2s"), "Pre-agent clock did not advance");
	confirmUser(sent.held);
	await until(() => latest.state.pendingPrompt?.userMessage === undefined, "User confirmation did not reconcile");
	assert(document.querySelectorAll(".msg.user").length === 1 && waiting(), "User confirmation duplicated a bubble");
	await advance(1000);
	emit({ type: "message_start", message: { role: "assistant" } });
	await until(() => !waiting() && header()?.includes("耗时3s"), "Empty assistant did not take over the elapsed clock");
	assert(document.querySelectorAll(".msg.assistant").length === 1 && !document.querySelector(".thinking-toggle"), "Empty assistant duplicated or offered an empty fold");
	await advance(1100);
	emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "纯文本回复" } });
	await until(() => header()?.includes("耗时4s"), "Pure-text duration missing");
	await finishReply(sent.held, "纯文本回复");
	assert(await sent.task, "Successful prompt rejected");
	assert(latest.state.messages.at(-1).durationMs === 4300 && latest.elapsedMs === 4300, "Send latency missing from final duration");
	record("发送立即显示用户行、模型占位和计时；延迟确认、空回复及纯文本接续不重复、不归零");
	for (const edit of [true, false]) {
		document.querySelector(edit ? '[aria-label="编辑并重发"]' : '[aria-label="重新生成"]').click();
		if (edit) {
			await until(() => document.querySelector(".editing-banner"), "Edit mode did not open");
			setDraft("编辑后的问题");
			await delay(30);
			document.querySelector('[aria-label="发送消息"]').click();
		}
		await until(() => heldPrompts.length > 0 && waiting(), "Resend placeholder missing");
		const held = heldPrompts.shift();
		assert(held.request.message === "编辑后的问题" && latest.state.messages.length === 0, "Fork/resend did not reconcile history");
		confirmUser(held);
		emit({ type: "message_start", message: { role: "assistant" } });
		await advance(1000);
		await finishReply(held);
		record(edit ? "编辑重发在回退完成后立即显示占位" : "重新生成沿用原提问并立即显示占位");
	}
	document.querySelector('[aria-label="继续生成"]').click();
	await until(() => heldPrompts.length > 0 && waiting(), "Continue placeholder missing");
	const continuation = heldPrompts.shift();
	assert(continuation.request.message === "继续", "Continue sent wrong text");
	assert(document.querySelectorAll(".voyage-turn dd")[1].textContent === "—", "New prompt displayed the preceding turn's usage");
	confirmUser(continuation);
	emit({ type: "message_start", message: { role: "assistant" } });
	await advance(1000);
	await finishReply(continuation);
	record("继续生成立即展示新轮占位");
	setDraft("失败后保留草稿"); await delay(30);
	document.querySelector('[aria-label="发送消息"]').click();
	await until(() => heldPrompts.length > 0 && waiting(), "Failed send placeholder missing");
	answer(heldPrompts.shift(), false);
	await until(() => !latest.pending && !latest.state.isStreaming, "Failure did not clear state");
	assert(!waiting() && intervals.size === 0 && document.querySelector('[aria-label="聊天消息"]').value === "失败后保留草稿", "Failure leaked placeholder or lost draft");
	record("发送拒绝清理占位、停止计时并保留草稿");
	const cancelled = await takePrompt(() => latest.actions.prompt("开始前中止"));
	await until(waiting, "Abort placeholder missing");
	await latest.actions.abort();
	await until(() => !latest.pending && !latest.state.isStreaming && intervals.size === 0, "Pre-start abort did not clear");
	const next = await takePrompt(() => latest.actions.prompt("中止后的新请求"));
	await until(waiting, "New request did not start after abort");
	const nextId = latest.state.activeRun.promptId;
	answer(cancelled.held);
	assert(!await cancelled.task, "Cancelled request was accepted late");
	assert(latest.state.activeRun.promptId === nextId && latest.pending, "Late confirmation cleared the new request");
	answer(next.held, false); await next.task;
	await until(() => !latest.state.isStreaming && intervals.size === 0, "Second request did not clear");
	record("run 开始前中止可立即重发，迟到确认不影响新请求");
	const acknowledged = await takePrompt(() => latest.actions.prompt("确认后等待 agent_start"));
	answer(acknowledged.held); assert(await acknowledged.task, "Acknowledged send rejected");
	await until(waiting, "Acknowledged wait vanished");
	await latest.actions.abort();
	await until(() => !latest.state.isStreaming && intervals.size === 0, "Acknowledged wait did not abort");
	record("发送已确认但 run 未开始时仍可中止");
	const image = { id: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0HcAAAAASUVORK5CYII=" };
	const imageSend = await takePrompt(() => latest.actions.prompt("", [image]));
	await until(() => document.querySelectorAll(".msg.user img").length === 1 && waiting(), "Image-only optimistic display missing");
	confirmUser(imageSend.held); emit({ type: "message_start", message: { role: "assistant" } });
	await advance(1000); await finishReply(imageSend.held);
	assert(await imageSend.task, "Image-only send failed");
	assert(latest.state.messages.at(-2).blocks[0].kind === "image" && document.querySelectorAll(".msg.user img").length === 1, "Image confirmation duplicated or lost image");
	record("纯图片发送立即展示附件，真实用户事件接续不重复");
	assert(!await latest.actions.prompt("  "), "Empty prompt accepted");
	await latest.actions.setModel(latest.state.model);
	const web = latest.actions.setWebSearch(true);
	await until(() => heldPrompts.length > 0, "Web command not sent");
	assert(!latest.state.activeRun && !latest.state.pendingPrompt && !waiting(), "Settings created a chat placeholder");
	answer(heldPrompts.shift()); await web;
	record("空输入、模型设置和联网开关不产生占位");
	holdPrompts = false; mock.failNextSend();
	const history = latest.state.messages;
	assert(!await latest.actions.prompt("模拟传输失败"), "Transport failure was accepted");
	await until(() => !latest.pending && !latest.state.isStreaming && intervals.size === 0, "Transport failure leaked clock");
	assert(latest.state.messages === history && !latest.state.pendingPrompt && !waiting(), "Transport failure mutated history or left optimistic rows");
	record("传输失败清理临时状态且不改写历史");
	holdPrompts = true;
	const exiting = await takePrompt(() => latest.actions.prompt("确认前退出"));
	emit({ type: "bridge_exit", message: "simulated exit before confirmation" });
	assert(!await exiting.task, "Exited send was accepted");
	await until(() => !latest.connected && !latest.pending && intervals.size === 0, "Exit leaked clock");
	assert(!latest.state.pendingPrompt && !waiting(), "Exit leaked optimistic rows");
	latest.reconnect(); await until(() => latest.connected, "Reconnect after exit failed");
	const switching = await takePrompt(() => latest.actions.prompt("切换前请求"));
	target = { id: "after-send-switch", cwd: "D:\\workspace\\demo" }; render();
	await until(() => latest.loadedId === target.id && latest.connected, "Switch during send failed");
	assert(!await switching.task, "Old send was accepted after switch");
	answer(switching.held); await delay(30);
	assert(!latest.state.activeRun && !latest.state.pendingPrompt && latest.state.messages.length === 0 && intervals.size === 0, "Late response modified the new chat");
	record("确认前退出、切换与旧响应均清理临时行和计时器");
	holdPrompts = false;
	emit({ type: "agent_start" });
	await until(() => rail() === "0s", "Missing duration before first assistant");
	assert(intervals.size === 1, "Expected exactly one clock interval");
	begin();
	await until(() => header()?.includes("耗时0s"), "Initial header missing");
	// Let the initial message-follow animation frame finish before watching clock-only updates.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	const messages = latest.state.messages;
	const body = document.querySelector(".thinking pre");
	let mutations = 0;
	const observer = new MutationObserver(() => mutations++);
	observer.observe(body, { subtree: true, childList: true, characterData: true });
	const scroller = document.querySelector(".messages");
	let scrollCalls = 0;
	const originalScroll = scroller.scrollTo;
	scroller.scrollTo = () => scrollCalls++;
	await advance(3100);
	assert(rail() === "3s" && header()?.includes("耗时3s"), "Quiet reasoning clock did not advance in both views");
	assert(latest.state.messages === messages && mutations === 0 && scrollCalls === 0, `Clock mutated transcript, body or scroll: messages=${latest.state.messages === messages}, mutations=${mutations}, scroll=${scrollCalls}`);
	observer.disconnect(); scroller.scrollTo = originalScroll;
	record("无消息事件时，两处耗时增长；正文、消息数组和滚动不变");
	emit({ type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "继续处理" }, { type: "toolCall", id: "read", name: "read", arguments: { path: "README.md" } }] } });
	await until(() => !latest.state.messages.at(-1).streaming, "Message did not finalize");
	await advance(2000);
	assert(rail() === "5s" && header()?.includes("耗时5s"), "Tool wait stopped the clock");
	emit({ type: "message_start", message: { role: "assistant" } });
	emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "最终回复" } });
	await advance(1000);
	assert(rail() === "6s" && header()?.includes("耗时6s"), "New assistant step reset the clock");
	record("工具等待和下一条流式回复沿用同一个起点");
	emit({ type: "agent_end" });
	await until(() => !latest.state.isStreaming && intervals.size === 0, "Completion did not stop the interval");
	assert(latest.state.messages.at(-1).durationMs === 6100 && latest.elapsedMs === 6100, "Final duration mismatch");
	await advance(2000);
	emit({ type: "agent_settled" });
	await delay(30);
	assert(rail() === "6s" && header()?.includes("耗时6s") && latest.elapsedMs === 6100, "Settled duration changed or accumulated twice");
	record("结束后固定实测耗时，重复结束事件不重复累计");
	const oldHeader = header();
	emit({ type: "agent_start" });
	await advance(1000);
	assert(header() === oldHeader && rail() === "1s", "New run changed the previous turn");
	emit({ type: "agent_end" });
	await until(() => intervals.size === 0, "Empty run did not stop");
	assert(latest.state.messages.at(-1).durationMs === 6100, "Empty run overwrote history");
	record("新 run 尚无消息时，上一轮徽章和最终耗时不变");
	begin();
	await advance(2400);
	await latest.actions.abort();
	await until(() => intervals.size === 0, "Abort did not stop the clock");
	assert(rail() === "2s" && header()?.includes("耗时2s"), "Abort duration missing");
	record("中止后计时停止并固定读数");
	begin();
	await advance(1200);
	emit({ type: "bridge_exit", message: "simulated pi exit" });
	await until(() => intervals.size === 0 && !latest.connected, "Bridge exit did not stop");
	assert(rail() === "1s" && header()?.includes("耗时1s") && !latest.state.messages.at(-1).streaming, "Bridge exit did not settle the current turn");
	record("进程退出也结算当前轮并清理流式状态");
	latest.reconnect();
	await until(() => latest.connected, "Reconnect failed");
	begin();
	await advance(1000);
	target = { id: "other", cwd: "D:\\workspace\\demo" }; render();
	await until(() => latest.loadedId === "other", "Chat switch failed");
	assert(intervals.size === 0 && latest.state.activeRun === undefined && rail() === "—", "Chat switch retained the old clock");
	for (const withTimestamp of [true, false]) {
		const startedAt = withTimestamp ? now - 4500 : now;
		restoration = { isStreaming: true, messages: [
			{ role: "user", content: "恢复运行中的会话", ...(withTimestamp ? { timestamp: startedAt } : {}) },
			{ role: "assistant", content: [{ type: "thinking", thinking: "恢复后继续思考" }] },
		] };
		target = { id: `restore-${withTimestamp}`, cwd: "D:\\workspace\\demo" }; render();
		await until(() => latest.loadedId === target.id && latest.state.activeRun, "Running session did not restore");
		await delay(150);
		assert(latest.state.activeRun.startedAt === startedAt, "Restoration chose the wrong start time");
		await advance(1000);
		const seconds = withTimestamp ? "5s" : "1s";
		assert(rail() === seconds && header()?.includes(`耗时${seconds}`), "Restored clock did not advance in both views");
		emit({ type: "agent_end" });
		await until(() => intervals.size === 0, "Restored run did not stop");
		assert(latest.state.messages.at(-1).durationMs === now - startedAt, "Restored final duration used a different origin");
		record(withTimestamp ? "恢复运行中会话时，沿用用户时间戳并正确结算" : "缺少时间戳时，从恢复时刻计时并正确结算");
	}
	begin();
	await until(() => intervals.size === 1, "Clock not restarted");
	root.unmount();
	await delay(30);
	assert(intervals.size === 0, "Unmount leaked clock interval");
	record("重连、切换聊天、StrictMode 和卸载无遗留计时器");
	output.dataset.status = "passed";
} catch (error) {
	output.textContent += `\nFAIL ${error.stack}`;
	output.dataset.status = "failed";
} finally {
	Date.now = realNow;
	window.setInterval = originalInterval;
	window.clearInterval = originalClear;
}
