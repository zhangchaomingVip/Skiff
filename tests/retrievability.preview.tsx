import { createRoot } from "react-dom/client";
import App from "../src/App";
import { installMockPi } from "./mockPi.mjs";
import { drafts, DraftStore } from "../src/chat/drafts";
import { HistorySearch, type HistoryProjection } from "../src/chat/historySearch";
import type { Conversation } from "../src/chat/workspace";
import "../src/tokens.css";
import "../src/index.css";
import "../src/voyage.css";
import "../src/components/ui.css";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = "light";
localStorage.setItem("skiff.theme", "light");
const model = { provider: "skiff-relay-r1-deepseek", id: "deepseek-chat", modelId: "deepseek-chat", routeId: "route-deepseek-r1", offerId: "route-deepseek-r1/deepseek-chat" };
const chats: Conversation[] = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, projectId: "p", title: `Session ${i}`, customTitle: true, sessionFile: `s${i}.jsonl`, hasMessages: true, selectedModel: model, updatedAt: Date.now() - i * 86400000, pinned: i === 1 }));
const sessions = Object.fromEntries(chats.map((chat) => [chat.sessionFile!, Array.from({ length: 100 }, (_, i) => ({ entryId: `${chat.id}-${i}`, role: i % 2 ? "assistant" : "user", provider: model.provider, model: model.id, timestamp: 1700000000000 + i, content: [{ type: "text", text: i === 99 ? `unique conclusion ${chat.id}` : `${chat.id} message ${i} 普通正文` }] }))]));
if (params.get("restore") !== "1") {
	localStorage.clear();
	localStorage.setItem("skiff.theme", "light");
	localStorage.setItem("skiff.workspace.v1", JSON.stringify({ version: 1, projects: [{ id: "p", name: "Skiff", path: "D:\\workspace\\Skiff" }], chats, activeId: "s0" }));
	localStorage.setItem("skiff.sidebar.open", "true");
	localStorage.setItem("skiff.test.sessions", JSON.stringify(sessions));
}
const mock = installMockPi(window, localStorage, "authorization", params.get("restore") === "1" ? undefined : sessions);
mock.histories.set("s2.jsonl", [{ entryId: "compacted", role: "assistant", timestamp: 1690000000000, content: "压缩前的专属结论" }, ...sessions["s2.jsonl"]]);
mock.histories.set("s3.jsonl", new Error("unreadable"));
const bridge = (window as any).__TAURI_INTERNALS__;
const invoke = bridge.invoke;
let delay = 0;
let reads = 0, active = 0, peak = 0, firstRead = 0;
bridge.invoke = async (command: string, args: any) => {
	if (command !== "read_session_history") return invoke(command, args);
	if (!firstRead) firstRead = performance.now();
	reads++; active++; peak = Math.max(peak, active);
	try { if (delay) await new Promise((resolve) => setTimeout(resolve, delay)); return await invoke(command, args); }
	finally { active--; }
};
const fixture = {
	mock, drafts, DraftStore, chats,
	setDelay(value: number) { delay = value; },
	beginScan() { firstRead = 0; return reads; },
	stats() { return { reads, active, peak, firstRead }; },
	async performance() {
		const projections = new Map(chats.map((chat) => [chat.id, { version: "v", messages: sessions[chat.sessionFile!].map((message) => ({ entryId: message.entryId, role: message.role as "user" | "assistant", text: message.content[0].text, timestamp: message.timestamp })) }]));
		const engine = new HistorySearch(async (chat, known) => known === "v" ? { version: "v", unchanged: true, messages: [] } : structuredClone(projections.get(chat.id)!));
		engine.prune(chats);
		const run = async () => { const start = performance.now(); await engine.search(chats, "unique conclusion s99", new Map(), () => {}); return performance.now() - start; };
		const cold = await run(), samples = [];
		for (let i = 0; i < 20; i++) samples.push(await run());
		return { cold, samples, bytes: new TextEncoder().encode(JSON.stringify([...projections.values()])).byteLength, cache: engine.cacheSize, messages: 10000 };
	},
	async read(file: string): Promise<HistoryProjection> { return bridge.invoke("read_session_history", { chatId: file.replace(".jsonl", ""), sessionFile: file }); },
};
(window as any).retrievalFixture = fixture;
void invoke("set_family_auto_failover", { autoFailover: true }).then(() => createRoot(document.getElementById("root")!).render(<App />));
