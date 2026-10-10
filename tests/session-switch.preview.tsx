import { Profiler, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { preparePreview } from "./uiFixture.mjs";
import { installMockPi } from "./mockPi.mjs";
import { usePiSession, type SessionTarget } from "../src/chat/usePiSession";
import "../src/tokens.css";
import "../src/index.css";
import "../src/voyage.css";
import "../src/components/ui.css";

const params = new URLSearchParams(location.search);
if (params.get("restore") !== "1") preparePreview(window);
const messageCount = Number(params.get("messages") ?? 100);
const chatCount = Number(params.get("chats") ?? 30);
const kind = params.get("kind") ?? "text";
const model = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
const projects = [{ id: "p", name: "Project A", path: "D:\\workspace\\Skiff" }, { id: "q", name: "Project B", path: "D:\\workspace\\demo" }];
const chats = Array.from({ length: chatCount }, (_, index) => ({
	id: `s${index}`, projectId: index === 2 ? "q" : "p", title: `Session ${index}`, customTitle: true, hasMessages: true, sessionFile: `s${index}.jsonl`, selectedModel: model, elapsedMs: index * 100, updatedAt: 1700000000000 - index,
	routeSnapshots: [{ providerKey: model.provider, familyId: "deepseek", familyName: "DeepSeek", modelId: model.id, relayId: "r1", relayName: `fixture-s${index}`, currency: "CNY", inputCost: 1, outputCost: 4 }],
	routeEvents: [{ timestamp: 1700000000000, sessionId: `s${index}`, requestId: `fixture-s${index}`, crossAccount: false, authorization: "none", automatic: false, retried: false, result: "switched" }],
}));
const canvas = document.createElement("canvas");
canvas.width = 320; canvas.height = 240;
const context = canvas.getContext("2d")!;
context.fillStyle = "skyblue"; context.fillRect(0, 0, canvas.width, canvas.height);
const image = { type: "image", mimeType: "image/png", data: canvas.toDataURL("image/png").split(",")[1] };
function contentFor(id: string, row: number) {
	const text = { type: "text", text: `${id} fixture message ${row}` };
	if (kind === "image") return [text, image];
	if (kind === "code") return [text, { type: "text", text: `\n\`\`\`ts\n${"const sample = 123;\n".repeat(80)}\`\`\`` }];
	if (kind === "tool" && row % 2) return [text, { type: "toolCall", id: `t${row}`, name: "read", arguments: { path: "sample.ts" } }];
	return [text];
}
const sessions = Object.fromEntries(chats.map((chat, index) => [chat.sessionFile, Array.from({ length: index === 0 ? messageCount : 2 }, (_, row) => ({
	entryId: `${chat.id}-${row}`, role: row % 2 ? "assistant" : "user", provider: model.provider, model: model.id,
	content: contentFor(chat.id, row),
})).flatMap((message, row) => kind === "tool" && row % 2 ? [message, { role: "toolResult", toolCallId: `t${row}`, toolName: "read", content: [{ type: "text", text: "fixture tool result\n".repeat(30) }] }] : [message])]));
if (params.get("empty") === "1") sessions["s1.jsonl"] = [];
if (params.get("restore") !== "1") {
	localStorage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects, chats, activeId: "s0" }));
	// Large synthetic corpora exceed browser storage quotas. Keep them in the
	// mock bridge; ordinary regression fixtures still test disk-index reloads.
	if (messageCount <= 100) localStorage.setItem("skiff.test.sessions", JSON.stringify(sessions));
	localStorage.setItem("skiff.sidebar.collapsed", JSON.stringify(params.get("expanded") === "1" ? [] : ["p", "q"]));
}
const mock = installMockPi(window, localStorage, "sidebar", params.get("restore") === "1" ? undefined : sessions);
const bridge = (window as any).__TAURI_INTERNALS__;
const originalInvoke = bridge.invoke;
const spans: Array<{ type: string; instance?: string; start: number; end?: number }> = [];
const renders: Array<Record<string, unknown>> = [];
const commits: Array<{ phase: string; duration: number; time: number }> = [];
const tasks: Array<{ start: number; duration: number }> = [];
const clicks: Array<{ title: string; disabled: boolean; trusted: boolean; time: number }> = [];
const timings: Array<{ type: string; start: number; duration: number; size: number }> = [];
let gate: { type: string; release?: (error?: string) => void } | undefined;
let historyDelay = Number(params.get("delay") ?? 150);
new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration }); }).observe({ type: "longtask", buffered: true });
document.addEventListener("click", (event) => {
	const button = (event.target as Element)?.closest<HTMLButtonElement>(".chat-link");
	if (button) clicks.push({ title: button.title, disabled: button.disabled, trusted: event.isTrusted, time: performance.now() });
}, true);
bridge.invoke = async (command: string, args: any) => {
	const type = command === "rpc_send" ? JSON.parse(args.message).type : command;
	const span = { type, instance: args?.instanceId ?? args?.options?.instanceId, start: performance.now(), end: undefined as number | undefined };
	spans.push(span);
	try {
		if (gate && gate.type === type && !gate.release) {
			const held = gate;
			await new Promise<void>((resolve, reject) => { held.release = (error) => error ? reject(new Error(error)) : resolve(); });
			if (gate === held) gate = undefined;
		}
		if (type === "get_messages" && historyDelay) await new Promise((resolve) => setTimeout(resolve, historyDelay));
		return await originalInvoke(command, args);
	} finally { span.end = performance.now(); }
};
const root = createRoot(document.getElementById("root")!);
const fixture = {
	mock, spans, renders, commits, tasks, clicks, timings,
	currentSession: undefined as ReturnType<typeof usePiSession> | undefined,
	probe: undefined as ReturnType<typeof usePiSession> | undefined,
	setTarget: undefined as ((target: SessionTarget) => void) | undefined,
	derivedState: undefined as any,
	scale: { messageCount, entryCount: sessions["s0.jsonl"].length, chatCount, kind, bytes: new TextEncoder().encode(JSON.stringify(sessions["s0.jsonl"])).length, codeLines: kind === "code" ? messageCount * 80 : 0, imageSize: kind === "image" ? [320, 240] : undefined },
	hold(type: string) { gate = { type }; },
	held() { return !!gate?.release; },
	release(error?: string) { const held = gate; gate = undefined; held?.release?.(error); },
	setDelay(value: number) { historyDelay = value; },
	timing(type: string, start: number, size: number) { timings.push({ type, start, duration: performance.now() - start, size }); },
	derived(value: any) { fixture.derivedState = value; },
	render(value: any) {
		fixture.currentSession = value.session;
		const foreignMessages = value.state.messages.filter((m: any) => !m.blocks.some((block: any) => block.kind === "text" && block.text.startsWith(`${value.id} fixture message`))).length;
		renders.push({ id: value.id, owner: value.owner, connected: value.connected, pending: value.pending, messageCount: value.state.messages.length, foreignMessages, sendable: value.connected && !value.pending && !!value.state.model && !!value.state.availableModels.length, model: value.state.model?.id, error: value.state.lastError, logs: value.rawLines.length, file: value.sessionFile, elapsedMs: value.elapsedMs, time: performance.now() });
	},
	mountProbe(target: SessionTarget) { root.render(<Probe initial={target} />); },
	unmount() { root.unmount(); },
};
function Probe({ initial }: { initial: SessionTarget }) {
	const [target, setTarget] = useState(initial);
	const session = usePiSession(target);
	fixture.probe = session;
	fixture.setTarget = setTarget;
	return <p>{session.phase}</p>;
}
(window as any).switchFixture = fixture;
root.render(<Profiler id="App" onRender={(_id, phase, duration, _base, _start, time) => commits.push({ phase, duration, time })}><App /></Profiler>);
