// Test-only Tauri bridge. Never imported by the application entry point.
export function installMockPi(target, storage, fixture, sessionOverrides) {
	const callbacks = new Map();
	const listeners = new Map();
	const processes = new Map();
	const saved = sessionOverrides ?? JSON.parse(storage?.getItem("skiff.test.sessions") ?? "{}");
	const commands = [];
	let sequence = 0;
	let failSend = false;
	const providerKey = (familyId, relayId) => `skiff-relay-${relayId}-${familyId}`;
	// Families ship with two DeepSeek routes (over two relays) so QA can exercise the switcher.
	const relays = [
		{ id: "r1", name: "官方直连", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-mock-0000abcd", timeoutSeconds: 60, enabled: true, billingAccountId: "wallet-a" },
		{ id: "r2", name: "硅基低价", baseUrl: "https://api.siliconflow.cn/v1", apiKey: "sk-mock-1111efgh", timeoutSeconds: 60, enabled: true, billingAccountId: "wallet-b" },
		{ id: "r3", name: "官方", baseUrl: "https://api.moonshot.cn/v1", apiKey: "sk-mock-2222ijkl", timeoutSeconds: 60, enabled: true, billingAccountId: "wallet-a" },
	];
	const route = (familyId, relayId, models, capabilities = {}) => ({ id: `route-${familyId}-${relayId}`, relayId, enabled: true, models, streaming: true, tools: true, vision: false, reasoning: false, ...capabilities });
	const families = [
		{ id: "deepseek", displayName: "DeepSeek", defaultRouteId: "route-deepseek-r1", routes: [
			route("deepseek", "r1", [
				{ modelId: "deepseek-flash", alias: "", inputCost: 1, outputCost: 4, cacheReadCost: 1, cacheWriteCost: 1, currency: "CNY", maxTokens: 4096, contextWindow: 32000 },
				{ modelId: "deepseek-chat", alias: "", inputCost: 0.3, outputCost: 1.2, cacheReadCost: 0.3, cacheWriteCost: 0.3, currency: "CNY", maxTokens: 8192, contextWindow: 128000 },
				{ modelId: "deepseek-reasoner", alias: "", inputCost: 5, outputCost: 20, cacheReadCost: 5, cacheWriteCost: 5, currency: "USD", maxTokens: 16384, contextWindow: 256000 },
			], { reasoning: true }),
			route("deepseek", "r2", [{ modelId: "deepseek-ai/DeepSeek-V3", alias: "", inputCost: 0.14, outputCost: 0.28, cacheReadCost: 0.14, cacheWriteCost: 0.14, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }]),
		] },
		{ id: "kimi", displayName: "Kimi", defaultRouteId: "route-kimi-r3", routes: [
			route("kimi", "r3", [{ modelId: "kimi-k2", alias: "", inputCost: 0.6, outputCost: 2.4, cacheReadCost: 0.6, cacheWriteCost: 0.6, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }], { reasoning: true }),
		] },
		{ id: "glm", displayName: "GLM", defaultRouteId: null, routes: [] },
	];
	if (fixture) {
		families[0].routes[1].models.push({ ...families[0].routes[0].models[1], inputCost: .14, outputCost: .28 });
		delete relays[2].billingAccountId;
		if (fixture === "authorization") families[0].routes[1].reasoning = true;
		if (fixture === "empty") families.forEach((family) => { family.routes = []; });
		if (fixture === "single" || fixture === "multi") {
			const modelId = fixture === "single" ? "deepseek-flash" : "deepseek-chat";
			families[0].routes.forEach((item) => { item.models = item.models.filter((model) => model.modelId === modelId); });
			families.slice(1).forEach((family) => { family.routes = []; });
		}
		if (fixture === "unknown") families.filter((family) => family.id !== "kimi").forEach((family) => { family.routes = []; });
	}
	const relayOf = (relayId) => relays.find((relay) => relay.id === relayId);
	const familyRoutes = () => families.flatMap((family) => family.routes.map((route) => ({ family, route })));
	const familyModels = () => familyRoutes().flatMap(({ family, route }) => {
		const relay = relayOf(route.relayId);
		if (!relay?.enabled || !route.enabled) return [];
		return route.models.filter((model) => !relay.excludedModelIds?.includes(model.modelId)).map((model) => ({
			provider: providerKey(family.id, relay.id), id: model.modelId, name: model.modelId,
			contextWindow: model.contextWindow, maxTokens: model.maxTokens, currency: model.currency, cost: { input: model.inputCost, output: model.outputCost },
			reasoning: route.reasoning, input: (model.vision ?? route.vision) ? ["text", "image"] : ["text"],
		}));
	});
	const models = familyModels();
	let autoFailover = false;
	let autoRetry = false;
	const familiesConfig = () => ({ version: 4, relays: structuredClone(relays), autoFailover, autoRetry, families: structuredClone(families) });
	const offers = () => familyRoutes().flatMap(({ family, route }, routeOrder) => {
		const relay = relayOf(route.relayId);
		if (!relay?.enabled || !route.enabled) return [];
		return route.models.filter((model) => !relay.excludedModelIds?.includes(model.modelId)).map((model) => ({ offerId: `${route.id}/${model.modelId}`, routeId: route.id, familyId: family.id, familyName: family.displayName, relayId: relay.id, relayName: relay.name, providerKey: providerKey(family.id, relay.id), modelId: model.modelId, alias: model.alias, billingAccountId: relay.billingAccountId, routeOrder, streaming: route.streaming, tools: route.tools, vision: model.vision ?? route.vision, reasoning: route.reasoning, inputCost: model.inputCost, outputCost: model.outputCost, cacheReadCost: model.cacheReadCost, cacheWriteCost: model.cacheWriteCost, currency: model.currency, maxTokens: model.maxTokens, contextWindow: model.contextWindow }));
	});
	const persist = () => storage?.setItem("skiff.test.sessions", JSON.stringify(saved));
	const emit = (instanceId, event) => {
		for (const listener of listeners.values()) {
			if (listener.event === `rpc://${instanceId}`) callbacks.get(listener.handler)?.({ payload: JSON.stringify(event) });
		}
	};
	target.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, id) => {
		callbacks.delete(listeners.get(id)?.handler);
		listeners.delete(id);
	} };
	target.__TAURI_INTERNALS__ = {
		transformCallback(callback) { const id = ++sequence; callbacks.set(id, callback); return id; },
		async invoke(command, args) {
			// Model discovery credentials must never enter the preview command log.
			commands.push({ command, args: command === "discover_relay_models" ? { baseUrl: args.baseUrl } : args });
			if (command === "plugin:event|listen") { const id = ++sequence; listeners.set(id, args); return id; }
			if (command === "plugin:event|unlisten") return;
			if (command === "get_workspace_directory") return { name: "Skiff", path: "D:\\workspace\\Skiff" };
			if (command === "list_model_families") {
				if (fixture === "loading") await new Promise(() => {});
				if (fixture === "error") throw new Error("预览：模型目录暂时不可用，请重试");
				return familiesConfig();
			}
			if (command === "list_model_runtime") return offers();
			if (command === "cancel_provider_test") return;
			if (command === "test_provider_connection") {
				if (String(args.baseUrl).includes("fail")) return { ok: false, latencyMs: 42, status: 401, error: "Invalid API key" };
				return { ok: true, latencyMs: 137, status: 200, error: null };
			}
			if (command === "set_family_auto_failover") { autoFailover = !!args.autoFailover; return familiesConfig(); }
			if (command === "set_family_auto_retry") { autoRetry = !!args.autoRetry; return familiesConfig(); }
			if (command === "save_relay") {
				const incoming = args.relay;
				if (!incoming.name?.trim() || incoming.name.trim().length > 32) throw new Error("显示名需为 1–32 个字符");
				if (!/^https?:\/\//.test(incoming.baseUrl ?? "")) throw new Error("Base URL 必须以 http:// 或 https:// 开头");
				if (relays.some((relay) => relay.id !== incoming.id && relay.name === incoming.name.trim())) throw new Error("中转名称不能重复");
				if (!incoming.id) {
					if (!incoming.apiKey?.trim()) throw new Error("新中转需要 API Key");
					incoming.id = `r${relays.length + 1}`;
				} else if (!incoming.apiKey) {
					incoming.apiKey = relayOf(incoming.id)?.apiKey ?? "";
				}
				incoming.timeoutSeconds = Math.min(600, Math.max(5, incoming.timeoutSeconds ?? 60));
				const index = relays.findIndex((relay) => relay.id === incoming.id);
				if (index < 0) relays.push(incoming); else relays[index] = incoming;
				return familiesConfig();
			}
			if (command === "delete_relay") {
				const index = relays.findIndex((relay) => relay.id === args.relayId);
				if (index < 0) throw new Error("找不到要删除的中转");
				relays.splice(index, 1);
				for (const family of families) {
					family.routes = family.routes.filter((route) => route.relayId !== args.relayId);
					if (!family.routes.some((route) => route.id === family.defaultRouteId)) family.defaultRouteId = null;
				}
				return familiesConfig();
			}
			if (command === "set_relay_enabled") {
				const relay = relayOf(args.relayId);
				if (!relay) throw new Error("找不到该中转");
				relay.enabled = !!args.enabled;
				return familiesConfig();
			}
			if (command === "save_route") {
				const family = families.find((item) => item.id === args.familyId);
				if (!family) throw new Error(`未知模型家族：${args.familyId}`);
				const incoming = args.route;
				if (!relayOf(incoming.relayId)) throw new Error("线路的中转不存在，请先添加中转");
				if (!incoming.models?.length) throw new Error("请至少添加一个模型，补全线路配置");
				const ids = new Set(incoming.models.map((model) => model.modelId?.trim()));
				if (ids.has("")) throw new Error("模型 ID 不能为空");
				if (ids.size !== incoming.models.length) throw new Error("同一线路内模型 ID 不能重复");
				incoming.id ||= `route-${args.familyId}-${incoming.relayId}`;
				incoming.enabled ??= true;
				const index = family.routes.findIndex((route) => route.id === incoming.id || route.relayId === incoming.relayId);
				if (index < 0) family.routes.push(incoming); else family.routes[index] = incoming;
				if (!family.defaultRouteId) family.defaultRouteId = incoming.id;
				return familiesConfig();
			}
			if (command === "delete_route") {
				const family = families.find((item) => item.id === args.familyId);
				const before = family?.routes.length ?? 0;
			if (family) family.routes = family.routes.filter((route) => route.id !== args.relayId && route.relayId !== args.relayId);
				if (!family || family.routes.length === before) throw new Error("找不到要删除的线路");
				if (family && !family.routes.some((route) => route.id === family.defaultRouteId)) family.defaultRouteId = null;
				return familiesConfig();
			}
			if (command === "reorder_routes") {
				const family = families.find((item) => item.id === args.familyId);
				if (!family || args.relayIds.length !== family.routes.length) throw new Error("排序请求与现有线路数量不一致");
				family.routes = args.relayIds.map((id) => family.routes.find((route) => route.id === id || route.relayId === id));
				return familiesConfig();
			}
			if (command === "set_default_route") {
				const family = families.find((item) => item.id === args.familyId);
				if (!family) throw new Error(`未知模型家族：${args.familyId}`);
				if (args.relayId == null) { family.defaultRouteId = null; return familiesConfig(); }
				const route = family.routes.find((item) => item.id === args.relayId || item.relayId === args.relayId);
				const relay = route && relayOf(route.relayId);
				if (!route || !route.enabled || !route.models.length || !relay?.enabled) throw new Error("默认线路必须是该家族内已启用中转上的线路");
				family.defaultRouteId = route.id;
				return familiesConfig();
			}
			if (command === "discover_relay_models") {
				await new Promise((resolve) => target.setTimeout(resolve, 350));
				if (args.apiKey === "invalid") throw new Error("密钥无效或未授权");
				if (String(args.baseUrl).includes("missing")) throw new Error("该地址不支持 /models 接口，请手动填写");
				return ["deepseek-chat", "deepseek-flash", "deepseek-reasoner", "Kimi-K2", "moonshot-v1", "glm-4.6", "chatglm-6b", ...Array.from({ length: 22 }, (_, i) => `a-model-${String(i).padStart(2, "0")}`)];
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
			if (command === "rpc_stop") { target.clearTimeout(processes.get(args.instanceId)?.timer); processes.delete(args.instanceId); return; }
			if (command !== "rpc_send") throw new Error(`Unknown mock command: ${command}`);
			if (failSend) { failSend = false; throw new Error("Simulated transport failure"); }
			const request = JSON.parse(args.message);
			const session = processes.get(args.instanceId);
			if (!session) throw new Error("No active process");
			const respond = (data, success = true) => emit(args.instanceId, { type: "response", id: request.id, success, data, error: success ? undefined : data });
			switch (request.type) {
				case "get_entries": {
					const entries = session.messages.map((message, index) => {
						message.entryId ??= crypto.randomUUID();
						return { id: message.entryId, parentId: index ? session.messages[index - 1].entryId : null, type: "message", message };
					});
					respond({ entries, leafId: entries.at(-1)?.id ?? null }); break;
				}
				case "get_commands": respond({ commands: [{ name: "review", description: "检查当前项目的代码" }, { name: "plan", description: "制定实现计划" }] }); break;
				case "get_fork_messages": respond({ messages: session.messages.filter((message) => message.role === "user").map((message) => { message.entryId ??= crypto.randomUUID(); return { entryId: message.entryId, text: message.content }; }) }); break;
				case "fork": {
					if (request.entryId === "cancelled") { respond({ cancelled: true }); break; }
					const index = session.messages.findIndex((message) => message.entryId === request.entryId);
					if (index < 0) { respond("Unknown entry", false); break; }
					const text = session.messages[index].content;
					session.messages = structuredClone(session.messages.slice(0, index));
					session.file = `mock-session-${crypto.randomUUID()}.jsonl`;
					saved[session.file] = session.messages; persist();
					respond({ text, cancelled: false }); break;
				}
				case "never_reply": break;
				case "get_state": respond({ model: session.model, thinkingLevel: session.thinkingLevel, sessionFile: session.file, isStreaming: session.isStreaming }); break;
				case "get_available_thinking_levels": respond({ levels: session.model.reasoning ? ["off", "minimal", "low", "medium", "high", ...(session.model.maxThinking === "max" ? ["xhigh", "max"] : session.model.maxThinking === "xhigh" ? ["xhigh"] : [])] : ["off"] }); break;
				case "set_thinking_level": session.thinkingLevel = session.model.reasoning ? request.level : "off"; respond({}); break;
				case "get_available_models": respond({ models: familyModels() }); break;
				case "get_messages": respond({ messages: session.messages }); break;
				case "switch_session": {
					if (request.sessionPath === "cancelled.jsonl") { respond({ cancelled: true }); break; }
					if (!saved[request.sessionPath]) { respond("Session file missing", false); break; }
					session.file = request.sessionPath;
					session.messages = structuredClone(saved[session.file]);
					respond({ cancelled: false });
					break;
				}
				case "set_model": session.model = familyModels().find((m) => m.id === request.modelId && m.provider === request.provider) ?? { provider: request.provider, id: request.modelId, name: request.modelId }; if (!session.model.reasoning) session.thinkingLevel = "off"; respond(session.model); break;
				case "prompt": {
					const user = { role: "user", content: request.images?.length ? [...(request.message ? [{ type: "text", text: request.message }] : []), ...request.images] : request.message };
					session.messages.push(user);
					saved[session.file] = session.messages;
					persist();
					if (String(request.message ?? "").includes("触发失败") || String(request.message ?? "").includes("触发跨账户")) {
						session.isStreaming = false;
						emit(args.instanceId, { type: "agent_start" });
						emit(args.instanceId, { type: "error", errorMessage: String(request.message).includes("触发跨账户") ? "503 Service Unavailable：提供商暂时不可用" : "401 Unauthorized：提供商拒绝了这次请求" });
						emit(args.instanceId, { type: "agent_end" });
						respond({ disposition: "started" });
						break;
					}
					session.isStreaming = true;
					emit(args.instanceId, { type: "agent_start" });
					emit(args.instanceId, { type: "message_start", message: user });
					emit(args.instanceId, { type: "message_end", message: user });
					emit(args.instanceId, { type: "message_start", message: { role: "assistant", provider: session.model.provider, model: session.model.id } });
					emit(args.instanceId, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
					respond({ disposition: "started" });
					if (fixture === "voyage-fishing") break;
					if (fixture === "voyage-tool") {
						emit(args.instanceId, { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "voyage-call", name: "read", arguments: { path: "README.md" } }] } });
						break;
					}
					const thinking = fixture === "voyage-thinking";
					if (thinking) emit(args.instanceId, { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
					const text = "我会先梳理项目结构，再检查核心模块之间的关系。\n\n项目采用 **React + TypeScript** 构建界面，通过 Tauri 与本地 pi 会话连接。\n\n接下来可以从 `src/chat/` 的会话管理入手。";
					let offset = 0;
					const stream = () => {
						if (!processes.has(args.instanceId) || !session.isStreaming) return;
						emit(args.instanceId, { type: "message_update", assistantMessageEvent: { type: thinking ? "thinking_delta" : "text_delta", contentIndex: 0, delta: text.slice(offset, offset + 8) } });
						offset += 8;
						if (offset < text.length) { session.timer = target.setTimeout(stream, fixture?.startsWith("voyage-") ? 250 : 80); return; }
						const assistant = { role: "assistant", provider: session.model.provider, model: session.model.id, content: [{ type: "text", text }], usage: { input: 77984, cacheRead: 715968, cacheWrite: 0, output: 12249, reasoning: 8035, totalTokens: 806201 } };
						emit(args.instanceId, { type: "message_end", message: assistant });
						session.messages.push(assistant);
						persist();
						session.isStreaming = false;
						emit(args.instanceId, { type: "agent_end" });
					};
					session.timer = target.setTimeout(stream, 100);
					break;
				}
				case "abort": target.clearTimeout(session.timer); session.isStreaming = false; emit(args.instanceId, { type: "agent_end" }); respond({}); break;
				default: respond("Unsupported command", false);
			}
		},
	};
	return { commands, processes, listeners, callbacks, emit, failNextSend: () => { failSend = true; } };
}
