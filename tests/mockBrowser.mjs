// Test-only browser service and JPEG stream. Never imported by production sources.
export function installMockBrowser(target) {
	const entries = new Map();
	const sockets = new Set();
	const calls = [];
	const sent = [];
	let enabled = false;
	let ready = true;
	let cliPath = null;
	let findDelay;
	let controlDelay;
	let controlFailure;
	let lifecycleFailure;
	let lifecycleDelay;
	const retired = new Set();
	const dependencies = () => ({ enabled, ready, supported: true, cliPath: cliPath ?? "C:/mock/agent-browser.exe", configuredCliPath: cliPath, version: "0.41.2", browserInstalled: ready, message: ready ? "浏览器已就绪" : "未检测到 Chrome for Testing，请执行 agent-browser install 后重新检测", installCommands: ["npm install -g agent-browser@0.41.2", "agent-browser install"] });
	const frame = (chatId, sequence) => {
		const canvas = target.document.createElement("canvas"); canvas.width = 1000; canvas.height = 700;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = chatId.endsWith("b") ? "#e9f0ff" : "#faf6ed"; ctx.fillRect(0, 0, 1000, 700);
		ctx.fillStyle = "#ffffff"; ctx.fillRect(90, 70, 820, 540);
		ctx.fillStyle = "#283d53"; ctx.font = "32px system-ui"; ctx.fillText(chatId.endsWith("b") ? "另一个聊天的页面" : "Skiff 浏览器演示", 130, 135);
		ctx.font = "22px system-ui"; ctx.fillText(`当前页面：${chatId}`, 130, 195);
		ctx.fillText("姓名", 130, 270); ctx.strokeStyle = "#71829a"; ctx.strokeRect(130, 290, 600, 60);
		ctx.fillText("实时查看 AI 的浏览操作", 150, 330);
		ctx.fillStyle = "#286bce"; ctx.fillRect(130, 390, 150, 55); ctx.fillStyle = "#fff"; ctx.fillText("提交", 180, 425);
		ctx.fillStyle = "#53657a"; ctx.fillText(`页面更新 ${sequence}`, 130, 525);
		return canvas.toDataURL("image/jpeg", .75).split(",")[1];
	};
	const NativeSocket = target.WebSocket;
	class MockSocket extends EventTarget {
		static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
		readyState = 0;
		onopen = null; onmessage = null; onclose = null; onerror = null;
		seq = 0;
		constructor(url) {
			super();
			this.url = String(url);
			const query = new URL(url).searchParams;
			this.chatId = query.get("chatId"); this.generation = query.get("generation");
			sockets.add(this);
			this.timer = target.setTimeout(() => { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.({}); this.frame(); }, 30);
		}
		frame() {
			if (this.readyState !== 1) return;
			this.emit({ type: "frame", seq: ++this.seq, data: frame(this.chatId, this.seq) });
		}
		emit(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
		send(data) {
			const message = JSON.parse(data); sent.push({ chatId: this.chatId, ...message });
			if (message.type === "ack") { target.clearTimeout(this.timer); this.timer = target.setTimeout(() => this.frame(), 100); }
			if (message.type === "input_flush") this.emit({ type: "input_ack", inputId: message.inputId });
		}
		close() { if (this.readyState === 3) return; this.readyState = 3; target.clearTimeout(this.timer); sockets.delete(this); this.onclose?.({}); }
	}
	target.WebSocket = class extends NativeSocket {
		constructor(url, protocols) { if (String(url).startsWith("ws://127.0.0.1:1/skiff-preview")) return new MockSocket(url); super(url, protocols); }
	};
	const api = {
		entries, sockets, calls, sent,
		setReady(value) { ready = value; },
		setEnabled(value) { enabled = value; },
		failControl(value) { controlFailure = value; },
		failLifecycle(value) { lifecycleFailure = value; },
		deferLifecycle() { let resolve; lifecycleDelay = new Promise((done) => { resolve = done; }); return resolve; },
		deferControl() { let resolve; const promise = new Promise((done) => { resolve = done; }); controlDelay = promise; return resolve; },
		deferFind(chatId) { let resolve; const promise = new Promise((done) => { resolve = done; }); findDelay = { chatId, promise }; return resolve; },
		set(chatId, patch = {}) {
			const status = { chatId, generation: `mock-${chatId}-1`, control: "ai", controlVersion: 1, url: `https://example.test/${chatId}`, error: null, ...entries.get(chatId), ...patch };
			entries.set(chatId, status);
			for (const socket of sockets) if (socket.chatId === chatId && socket.generation === status.generation) socket.emit({ type: "control", status });
			return status;
		},
		disconnect(chatId) { for (const socket of [...sockets]) if (socket.chatId === chatId) socket.close(); },
		async invoke(command, args = {}) {
			calls.push({ command, args });
			if (command === "browser_dependencies") return dependencies();
			if (command === "browser_retire_chat" || command === "browser_restore_chat") {
				if (lifecycleFailure) { const failure = lifecycleFailure; lifecycleFailure = undefined; throw new Error(failure); }
				if (lifecycleDelay) { const delay = lifecycleDelay; lifecycleDelay = undefined; await delay; }
				if (command === "browser_retire_chat") { retired.add(args.chatId); api.disconnect(args.chatId); entries.delete(args.chatId); }
				else retired.delete(args.chatId);
				return;
			}
			if (command === "browser_set_enabled") { enabled = args.enabled; return dependencies(); }
			if (command === "browser_configure") { cliPath = args.settings.cliPath; return dependencies(); }
			if (command === "browser_find") {
				const value = structuredClone(entries.get(args.chatId) ?? null);
				if (findDelay?.chatId === args.chatId) { const delay = findDelay; findDelay = undefined; await delay.promise; }
				return value;
			}
			if (command === "browser_status") return structuredClone(entries.get(args.target.chatId) ?? null);
			if (["browser_begin_control", "browser_complete_control", "browser_control"].includes(command)) {
				const status = entries.get(args.target.chatId);
				if (!status || status.generation !== args.target.generation) throw new Error("Browser owner changed");
				if (controlFailure) { const failure = controlFailure; controlFailure = undefined; throw new Error(failure); }
				if (command === "browser_begin_control") return api.set(status.chatId, { control: { takeOver: "takingOver", return: "returning", stop: "stopping" }[args.operation], controlVersion: status.controlVersion + 1 });
				if (controlDelay) { const delay = controlDelay; controlDelay = undefined; await delay; }
				return api.set(status.chatId, { control: { takeOver: "human", return: "ai", stop: "stopped" }[args.operation], requiresSnapshot: args.operation === "return" });
			}
			if (command === "browser_connection") {
				const status = entries.get(args.target.chatId);
				if (!status || status.generation !== args.target.generation) throw new Error("Browser owner changed");
				return { status: structuredClone(status), streamUrl: `ws://127.0.0.1:1/skiff-preview?chatId=${status.chatId}&generation=${status.generation}`, bridgeUrl: "", agentToken: "" };
			}
			if (command === "browser_close") { api.disconnect(args.target.chatId); return api.set(args.target.chatId, { control: "closed", controlVersion: (entries.get(args.target.chatId)?.controlVersion ?? 0) + 1 }); }
			throw new Error(`Unsupported mock browser command: ${command}`);
		},
	};
	return api;
}
