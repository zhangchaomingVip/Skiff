// Run on the isolated preview port: /tests/project-switch.html?fixture=sidebar
// Uses real React effects and a local pi mock; never starts native pi or calls an API.
import React from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { SidebarCollapse } from "../src/components/Sidebar";
import { usePiSession } from "../src/chat/usePiSession";
import { installMockPi } from "./mockPi.mjs";
import { preparePreview } from "./uiFixture.mjs";
import "../src/tokens.css";
import "../src/index.css";
import "../src/voyage.css";
import "../src/components/ui.css";

preparePreview(window);
const workspace = JSON.parse(localStorage.getItem("skiff.workspace.v1"));
for (const chat of workspace.chats) chat.selectedModel = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
localStorage.setItem("skiff.workspace.v1", JSON.stringify(workspace));
const mock = installMockPi(window, localStorage, "sidebar");
const invoke = window.__TAURI_INTERNALS__.invoke;
let releaseSpawn;
let holdSpawn = false;
let holdRestore = false;
window.__TAURI_INTERNALS__.invoke = async (command, args) => {
	if (command === "rpc_start" && holdSpawn) {
		holdSpawn = false;
		await new Promise((resolve) => { releaseSpawn = resolve; });
	}
	if (command === "rpc_send" && holdRestore && JSON.parse(args.message).type === "switch_session") {
		holdRestore = false;
		return; // No reply: navigation must cancel this request without waiting 35s.
	}
	if (command === "list_model_families" || command === "list_model_runtime") await delay(80);
	return invoke(command, args);
};
const root = createRoot(document.getElementById("root"));
const results = [];
const output = document.getElementById("results");
function assert(value, message) { if (!value) throw new Error(message); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function until(check, message, timeout = 3000) {
	const deadline = Date.now() + timeout;
	while (!check()) { if (Date.now() > deadline) throw new Error(message); await delay(10); }
}
function record(message) { results.push(`PASS ${message}`); output.textContent = results.join("\n"); }
function count(type) { return mock.commands.filter((item) => item.command === type || (item.command === "rpc_send" && JSON.parse(item.args.message).type === type)).length; }
function counters() { return ["rpc_start", "rpc_stop", "switch_session", "get_messages"].map(count); }
function click(selector) { const button = document.querySelector(selector); assert(button, `Missing ${selector}`); button.click(); }
const ready = () => document.querySelector(".sidebar-footer")?.textContent.includes("pi 已连接");

try {
	root.render(React.createElement(App));
	await delay(40);
	assert(count("rpc_start") === 0, "pi started before initial configuration migration finished");
	await until(ready, "Initial session not connected");
	await delay(60);
	assert(count("rpc_start") === 1, "Initial session restarted redundantly");
	record("初始化等待配置完成，只启动 1 次 pi");
	assert(document.querySelectorAll(".project-chats .chat-row").length === 0, "Collapsed chats still mounted");
	assert(document.querySelectorAll(".sidebar-recent .chat-row").length === 28, "Recent list changed");
	record("初始折叠项目聊天 0 行，最近列表保留 28 行");
	for (const project of ["aiagent", "Skiff"]) {
		const before = counters();
		const button = [...document.querySelectorAll(".project-select")].find((item) => item.textContent.startsWith(project));
		assert(button, `Missing project ${project}`); button.click();
		await until(() => count("rpc_start") > before[0] && ready(), `${project} not connected`);
		await delay(60);
		const delta = counters().map((value, index) => value - before[index]);
		assert(delta.every((value) => value === 1), `Duplicate work: ${delta}`);
		assert(document.querySelector('[aria-label="你的消息"]')?.textContent && document.querySelector('[aria-label="Skiff 的消息"]')?.textContent.includes("预览任务已完成"), "History missing");
		assert(document.querySelector(".header-model")?.textContent.includes("deepseek-chat"), "Selected model changed");
		record(`切换到 ${project}：启动/停止/恢复/读取历史各 1 次`);
	}
	click('[aria-label="展开Skiff"]');
	await until(() => document.querySelectorAll(".project-chats .chat-row").length === 22, "Project did not expand");
	await delay(250);
	const expandedHeight = document.querySelector(".project-chats").parentElement.parentElement.getBoundingClientRect().height;
	click('[aria-label="收起Skiff"]');
	await delay(80);
	assert(document.querySelectorAll(".project-chats .chat-row").length === 22, "Closing animation lost its content");
	const closingHeight = document.querySelector(".project-chats").parentElement.parentElement.getBoundingClientRect().height;
	assert(closingHeight > 0 && closingHeight < expandedHeight, "Collapse height did not animate");
	await until(() => document.querySelectorAll(".project-chats .chat-row").length === 0, "Closed content not unmounted");
	assert(document.querySelectorAll(".sidebar-recent .chat-row").length === 28, "Collapse affected recent tasks");
	record("关闭动画保留内容，结束后卸载，最近列表保持独立");
	click('[aria-label="展开Skiff"]');
	await delay(10);
	click('[aria-label="收起Skiff"]');
	await delay(10);
	click('[aria-label="展开Skiff"]');
	await delay(350);
	assert(document.querySelectorAll(".project-chats .chat-row").length === 22, "Rapid reopen was unmounted");
	record("快速折叠再展开不误卸载");
	click(".section-name");
	await until(() => document.querySelectorAll(".project-group").length === 0, "Parent group not unmounted");
	assert(document.querySelectorAll(".sidebar-recent .chat-row").length === 28, "Parent collapse affected recent tasks");
	click(".section-name");
	await until(() => document.querySelectorAll(".project-chats .chat-row").length === 22, "Nested expansion state lost");
	record("项目总折叠卸载子树，重新展开保留各项目折叠状态");
	const reducedMotion = document.createElement("style");
	reducedMotion.textContent = ".sidebar-collapse { transition: none !important; }";
	document.head.append(reducedMotion);
	click('[aria-label="收起Skiff"]');
	await until(() => document.querySelectorAll(".project-chats .chat-row").length === 0, "No-transition close not unmounted");
	reducedMotion.remove();
	record("禁用动画时也能卸载隐藏内容");
	const beforeConfig = count("rpc_start");
	click('[aria-label="配置提供商"]');
	await until(() => document.querySelector('dialog[open]'), "Settings not open");
	const modelTab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.includes("模型选择"));
	assert(modelTab, "Model tab missing"); modelTab.click();
	await until(() => [...document.querySelectorAll("label")].some((item) => item.textContent.includes("失败时自动切换")), "Model settings not shown");
	[...document.querySelectorAll("label")].find((item) => item.textContent.includes("失败时自动切换")).querySelector("input").click();
	await until(() => count("rpc_start") > beforeConfig && ready(), "Config edit not applied");
	await delay(80);
	assert(count("rpc_start") === beforeConfig + 1, "Config edit restarted more than once");
	record("配置修改仍刷新会话，且只重启 1 次");
	const relayTab = [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent.includes("供应商"));
	relayTab.click();
	await until(() => document.querySelector('[aria-label="停用 官方直连"]'), "Relay toggle missing");
	const beforeRemoval = count("rpc_start");
	click('[aria-label="停用 官方直连"]');
	await until(() => count("rpc_start") > beforeRemoval && ready(), "Disabled route not refreshed");
	assert(document.querySelector(".header-model")?.textContent.includes("硅基低价") && document.querySelector(".header-model")?.textContent.includes("deepseek-chat"), "Invalid model did not fall back within family");
	assert(document.querySelector('[aria-label="Skiff 的消息"]')?.textContent.includes("预览任务已完成"), "Fallback lost history");
	record("停用当前供应商后保留历史，并回退到同家族可用线路");
	root.render(null);
	await until(() => mock.processes.size === 0, "App process leaked on unmount");

	let probe;
	function Probe({ target, config }) {
		probe = usePiSession(target, [], config);
		return React.createElement("p", null, probe.connected ? "Connected" : "Connecting");
	}
	const targetA = { id: "a", cwd: "D:/workspace/Skiff", sessionFile: "sidebar-skiff-chat-0.jsonl" };
	const targetB = { id: "b", cwd: "D:/workspace/aiagent", sessionFile: "sidebar-aiagent-chat-0.jsonl" };
	holdSpawn = true;
	root.render(React.createElement(Probe, { target: targetA }));
	await until(() => releaseSpawn, "Spawn barrier not reached");
	root.render(React.createElement(Probe, { target: targetB }));
	await delay(20); releaseSpawn();
	await until(() => probe?.connected && probe.loadedId === "b", "Late spawn blocked next chat");
	assert(mock.processes.size === 1, "Late spawn leaked a process");
	record("启动中切项目：迟到进程已清理，仅目标会话存活");
	root.render(null);
	await until(() => mock.processes.size === 0, "Probe leaked process");
	holdRestore = true;
	root.render(React.createElement(Probe, { target: targetA }));
	await until(() => !holdRestore, "Restore barrier not reached");
	root.render(React.createElement(Probe, { target: targetB }));
	await until(() => probe?.connected && probe.loadedId === "b", "Stalled restore waited for timeout", 1500);
	assert(mock.processes.size === 1, "Stalled restore leaked a process");
	record("恢复请求不响应时，切项目无需等待 RPC 超时");
	root.render(null);
	await until(() => mock.processes.size === 0 && mock.listeners.size === 0, "Resources leaked");
	let mounts = 0;
	function Content() { React.useEffect(() => { mounts++; }, []); return React.createElement("span", null, "content"); }
	root.render(React.createElement(SidebarCollapse, { open: false }, () => React.createElement(Content)));
	await delay(30);
	assert(mounts === 0, "Initial closed collapse mounted children");
	root.render(null);
	record("初始隐藏内容不挂载；所有会话及监听器清理完成");
	output.dataset.status = "passed";
	output.textContent += `\n${results.length} checks passed`;
} catch (error) {
	output.dataset.status = "failed";
	output.textContent += `\nFAIL ${error.stack}`;
}
