// Test-only Tauri bridge. Never imported by the application entry point.
export function installMockPi(target, storage) {
	const callbacks = new Map();
	const listeners = new Map();
	const processes = new Map();
	const saved = JSON.parse(storage?.getItem("skiff.test.sessions") ?? "{}");
	const commands = [];
	let sequence = 0;
	let failSend = false;
	const providerKey = (familyId, id) => `skiff-${familyId}-${id}`;
	// Families ship with two DeepSeek channels so QA can exercise the switcher.
	const families = [
		{ id: "deepseek", displayName: "DeepSeek", defaultProviderId: "p1", providers: [
			{ id: "p1", displayName: "官方直连", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-mock-0000abcd", models: [{ modelId: "deepseek-chat", inputCost: 0.3, outputCost: 1.2, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }], streaming: true, tools: true, vision: false, reasoning: true, timeoutSeconds: 60, enabled: true },
			{ id: "p2", displayName: "硅基低价", baseUrl: "https://api.siliconflow.cn/v1", apiKey: "sk-mock-1111efgh", models: [{ modelId: "deepseek-ai/DeepSeek-V3", inputCost: 0.14, outputCost: 0.28, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }], streaming: true, tools: true, vision: false, reasoning: false, timeoutSeconds: 60, enabled: true },
		] },
		{ id: "kimi", displayName: "Kimi", defaultProviderId: "k1", providers: [
			{ id: "k1", displayName: "官方", baseUrl: "https://api.moonshot.cn/v1", apiKey: "sk-mock-2222ijkl", models: [{ modelId: "kimi-k2", inputCost: 0.6, outputCost: 2.4, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }], streaming: true, tools: true, vision: false, reasoning: true, timeoutSeconds: 60, enabled: true },
		] },
		{ id: "glm", displayName: "GLM", defaultProviderId: null, providers: [] },
	];
	families[0].providers[0].models.unshift({ modelId: "deepseek-flash", inputCost: 1, outputCost: 4, currency: "CNY", maxTokens: 4096, contextWindow: 32000 });
	families[0].providers[0].models.push({ modelId: "deepseek-reasoner", inputCost: 5, outputCost: 20, currency: "USD", maxTokens: 16384, contextWindow: 256000 });
	const familyModels = () => families.flatMap((family) => family.providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.map((model) => ({
		provider: providerKey(family.id, provider.id), id: model.modelId, name: model.modelId,
		contextWindow: model.contextWindow, maxTokens: model.maxTokens, currency: model.currency, cost: { input: model.inputCost, output: model.outputCost },
		reasoning: provider.reasoning, input: provider.vision ? ["text", "image"] : ["text"],
	}))));
	const models = familyModels();
	let autoFailover = false;
	const familiesConfig = () => ({ version: 2, autoFailover, families: structuredClone(families) });
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
			// Model discovery credentials must never enter the preview command log.
			commands.push({ command, args: command === "discover_openai_models" ? { baseUrl: args.baseUrl } : args });
			if (command === "plugin:event|listen") { const id = ++sequence; listeners.set(id, args); return id; }
			if (command === "plugin:event|unlisten") return;
			if (command === "get_workspace_directory") return { name: "Skiff", path: "D:\\workspace\\Skiff" };
			if (command === "list_openai_providers") return structuredClone(providers);
			if (command === "migrate_provider_config") return false;
			if (command === "list_model_families") return familiesConfig();
			if (command === "list_model_runtime") return families.flatMap((family) => family.providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.map((model) => ({ familyId: family.id, familyName: family.displayName, providerId: provider.id, displayName: provider.displayName, providerKey: providerKey(family.id, provider.id), ...model }))));
			if (command === "test_provider_connection") {
				if (String(args.baseUrl).includes("fail")) return { ok: false, latencyMs: 42, status: 401, error: "Invalid API key" };
				return { ok: true, latencyMs: 137, status: 200, error: null };
			}
			if (command === "set_family_auto_failover") { autoFailover = !!args.autoFailover; return familiesConfig(); }
			if (command === "set_family_provider_enabled") {
				const family = families.find((item) => item.id === args.familyId);
				const provider = family.providers.find((item) => item.id === args.providerId);
				provider.enabled = !!args.enabled;
				if (!provider.enabled && family.defaultProviderId === provider.id) family.defaultProviderId = family.providers.find((item) => item.enabled)?.id ?? null;
				if (provider.enabled && !family.defaultProviderId) family.defaultProviderId = provider.id;
				return familiesConfig();
			}
			if (command === "set_family_default_provider") {
				const family = families.find((item) => item.id === args.familyId);
				family.defaultProviderId = args.providerId ?? null;
				return familiesConfig();
			}
			if (command === "reorder_family_providers") {
				const family = families.find((item) => item.id === args.familyId);
				family.providers = args.providerIds.map((id) => family.providers.find((provider) => provider.id === id));
				return familiesConfig();
			}
			if (command === "delete_family_provider") {
				const family = families.find((item) => item.id === args.familyId);
				if (family.providers.length <= 1) throw new Error("每个家族至少保留一个提供商");
				family.providers = family.providers.filter((provider) => provider.id !== args.providerId);
				if (family.defaultProviderId === args.providerId) family.defaultProviderId = family.providers.find((item) => item.enabled)?.id ?? null;
				return familiesConfig();
			}
			if (command === "save_family_provider") {
				const family = families.find((item) => item.id === args.familyId);
				const incoming = args.provider;
				if (!incoming.displayName?.trim()) throw new Error("显示名需为 1–32 个字符");
				if (!/^https?:\/\//.test(incoming.baseUrl ?? "")) throw new Error("Base URL 必须以 http:// 或 https:// 开头");
				if (incoming.models.some((model) => !model.modelId?.trim())) throw new Error("模型 ID 不能为空");
				const duplicate = family.providers.some((provider) => provider.id !== incoming.id && provider.displayName === incoming.displayName.trim());
				if (duplicate) throw new Error("同家族内显示名不能重复");
				if (!incoming.id) incoming.id = `p${family.providers.length + 1}`;
				if (!incoming.apiKey) incoming.apiKey = family.providers.find((provider) => provider.id === incoming.id)?.apiKey ?? "";
				const index = family.providers.findIndex((provider) => provider.id === incoming.id);
				if (index < 0) family.providers.push(incoming); else family.providers[index] = incoming;
				if (!family.defaultProviderId) family.defaultProviderId = incoming.id;
				return familiesConfig();
			}
			if (command === "set_model_max_tokens") {
				const model = models.find((m) => m.provider === args.provider && m.id === args.modelId);
				if (!model) throw new Error(`没有找到模型 ${args.modelId}`);
				if (args.maxTokens == null) { delete model.maxTokens; return null; }
				if (model.contextWindow && args.maxTokens > model.contextWindow) throw new Error("最大输出 Token 不能超过上下文窗口");
				model.maxTokens = args.maxTokens;
				return args.maxTokens;
			}
			if (command === "discover_openai_models") {
				await new Promise((resolve) => target.setTimeout(resolve, 350));
				if (args.apiKey === "invalid") throw new Error("密钥无效或未授权");
				if (String(args.baseUrl).includes("missing")) throw new Error("该地址不支持 /models 接口，请手动填写");
				return ["deepseek-chat", "deepseek-flash", "deepseek-reasoner", "Kimi-K2", "moonshot-v1", "glm-4.6", "chatglm-6b", ...Array.from({ length: 22 }, (_, i) => `a-model-${String(i).padStart(2, "0")}`)];
			}
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
					if (String(request.message ?? "").includes("触发失败")) {
						session.isStreaming = false;
						emit(args.instanceId, { type: "agent_start" });
						emit(args.instanceId, { type: "error", errorMessage: "401 Unauthorized：提供商拒绝了这次请求" });
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
					const text = "我会先梳理项目结构，再检查核心模块之间的关系。\n\n项目采用 **React + TypeScript** 构建界面，通过 Tauri 与本地 pi 会话连接。\n\n接下来可以从 `src/chat/` 的会话管理入手。";
					let offset = 0;
					const stream = () => {
						if (!processes.has(args.instanceId) || !session.isStreaming) return;
						emit(args.instanceId, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text.slice(offset, offset + 8) } });
						offset += 8;
						if (offset < text.length) { session.timer = target.setTimeout(stream, 80); return; }
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
	return { commands, processes, listeners, emit, failNextSend: () => { failSend = true; } };
}
