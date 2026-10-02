// Test-only Tauri bridge. Never imported by the application entry point.
export function installMockPi(target, storage) {
	const callbacks = new Map();
	const listeners = new Map();
	const processes = new Map();
	const saved = JSON.parse(storage?.getItem("skiff.test.sessions") ?? "{}");
	const commands = [];
	let sequence = 0;
	let failSend = false;
	const models = [{ provider: "configured-provider", id: "configured-model", name: "Vision model", reasoning: true, input: ["text", "image"] }, { provider: "custom-provider", id: "custom-model", name: "Text model", reasoning: false, input: ["text"] }];
	const providers = [];
	const persist = () => storage?.setItem("skiff.test.sessions", JSON.stringify(saved));
	const emit = (instanceId, event) => {
		for (const listener of listeners.values()) {
			if (listener.event === `rpc://${instanceId}`) callbacks.get(listener.handler)?.({ payload: JSON.stringify(event) });
		}
	};
	target.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => listeners.delete(id) };
	target.__TAURI_INTERNALS__ = {
		transformCallback(callback) { const id = ++sequence; callbacks.set(id, callback); return id; },
		async invoke(command, args) {
			commands.push({ command, args });
			if (command === "plugin:event|listen") { const id = ++sequence; listeners.set(id, args); return id; }
			if (command === "plugin:event|unlisten") return;
			if (command === "get_workspace_directory") return { name: "Skiff", path: "D:\\workspace\\Skiff" };
			if (command === "list_openai_providers") return structuredClone(providers);
			if (command === "discover_openai_models") return ["mock-vision", "mock-text"];
			if (command === "save_openai_provider") {
				const { apiKey, ...provider } = args.input;
				provider.hasKey = !!apiKey || providers.some((p) => p.name === provider.name && p.hasKey);
				if (!provider.modelIds.length) provider.modelIds = ["mock-vision", "mock-text"];
				const index = providers.findIndex((p) => p.name === provider.name);
				if (index < 0) providers.push(provider); else providers[index] = provider;
				for (const id of provider.modelIds) {
					const model = { provider: provider.name, id, reasoning: provider.reasoning, input: provider.vision ? ["text", "image"] : ["text"], maxThinking: provider.maxThinking };
					const found = models.findIndex((m) => m.provider === provider.name && m.id === id);
					if (found < 0) models.push(model); else models[found] = model;
				}
				return provider;
			}
			if (command === "validate_project_directory") {
				if (!/^D:\\workspace\\[\w-]+$/.test(args.path)) throw new Error("请输入存在的文件夹的绝对路径");
				return { name: args.path.split("\\").at(-1), path: args.path };
			}
			if (command === "rpc_start") {
				const file = `mock-session-${crypto.randomUUID()}.jsonl`;
				processes.set(args.options.instanceId, { file, messages: [], model: models[0], thinkingLevel: "high", isStreaming: false });
				return;
			}
			if (command === "rpc_stop") { processes.delete(args.instanceId); return; }
			if (command !== "rpc_send") throw new Error(`Unknown mock command: ${command}`);
			if (failSend) { failSend = false; throw new Error("Simulated transport failure"); }
			const request = JSON.parse(args.message);
			const session = processes.get(args.instanceId);
			if (!session) throw new Error("No active process");
			const respond = (data, success = true) => emit(args.instanceId, { type: "response", id: request.id, success, data, error: success ? undefined : data });
			switch (request.type) {
				case "never_reply": break;
				case "get_state": respond({ model: session.model, thinkingLevel: session.thinkingLevel, sessionFile: session.file, isStreaming: session.isStreaming }); break;
				case "get_available_thinking_levels": respond({ levels: session.model.reasoning ? ["off", "minimal", "low", "medium", "high", ...(session.model.maxThinking === "max" ? ["xhigh", "max"] : session.model.maxThinking === "xhigh" ? ["xhigh"] : [])] : ["off"] }); break;
				case "set_thinking_level": session.thinkingLevel = session.model.reasoning ? request.level : "off"; respond({}); break;
				case "get_available_models": respond({ models }); break;
				case "get_messages": respond({ messages: session.messages }); break;
				case "switch_session": {
					if (request.sessionPath === "cancelled.jsonl") { respond({ cancelled: true }); break; }
					if (!saved[request.sessionPath]) { respond("Session file missing", false); break; }
					session.file = request.sessionPath;
					session.messages = structuredClone(saved[session.file]);
					respond({ cancelled: false });
					break;
				}
				case "set_model": session.model = models.find((m) => m.id === request.modelId && m.provider === request.provider); if (!session.model.reasoning) session.thinkingLevel = "off"; respond(session.model); break;
				case "prompt": {
					const user = { role: "user", content: request.images?.length ? [...(request.message ? [{ type: "text", text: request.message }] : []), ...request.images] : request.message };
					session.messages.push(user);
					saved[session.file] = session.messages;
					persist();
					session.isStreaming = true;
					emit(args.instanceId, { type: "agent_start" });
					emit(args.instanceId, { type: "message_start", message: user });
					emit(args.instanceId, { type: "message_end", message: user });
					emit(args.instanceId, { type: "message_start", message: { role: "assistant", model: session.model.id } });
					emit(args.instanceId, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
					respond({ disposition: "started" });
					const text = "我会先梳理项目结构，再检查核心模块之间的关系。\n\n项目采用 **React + TypeScript** 构建界面，通过 Tauri 与本地 pi 会话连接。\n\n接下来可以从 `src/chat/` 的会话管理入手。";
					session.timer = target.setTimeout(() => {
						if (!processes.has(args.instanceId) || !session.isStreaming) return;
						const assistant = { role: "assistant", model: session.model.id, content: [{ type: "text", text }], usage: { input: 77984, cacheRead: 715968, cacheWrite: 0, output: 12249, reasoning: 8035, totalTokens: 806201 } };
						emit(args.instanceId, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });
						emit(args.instanceId, { type: "message_end", message: assistant });
						session.messages.push(assistant);
						persist();
						session.isStreaming = false;
						emit(args.instanceId, { type: "agent_end" });
					}, 1500);
					break;
				}
				case "abort": target.clearTimeout(session.timer); session.isStreaming = false; emit(args.instanceId, { type: "agent_end" }); respond({}); break;
				default: respond("Unsupported command", false);
			}
		},
	};
	return { commands, processes, listeners, emit, failNextSend: () => { failSend = true; } };
}
