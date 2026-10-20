// Test-only Tauri bridge. Never imported by the application entry point.
export function installMockPi(target, storage, fixture, sessionOverrides) {
	const callbacks = new Map();
	const listeners = new Map();
	const processes = new Map();
	const saved = sessionOverrides ?? JSON.parse(storage?.getItem("skiff.test.sessions") ?? "{}");
	const commands = [];
	const testRequests = [];
	const pendingTests = [];
	let deferTests = false;
	let metadata; try { metadata = JSON.parse(storage?.getItem("skiff.test.metadata.v1") ?? "null"); } catch { /* corrupt cache */ }
	metadata ??= { version: 1, tests: [], usage: [], connections: {} };
	let testOrder = Date.now() * 1000;
	const tickets = new Map(); const latestTests = new Map(); const cancelledTests = new Set();
	let failBatch = false; let failOrder = false;
	const connection = (relay) => JSON.stringify([relay.baseUrl.replace(/\/+$/, ""), relay.apiKey, relay.protocol ?? "openai", relay.timeoutSeconds]);
	const persistMetadata = () => storage?.setItem("skiff.test.metadata.v1", JSON.stringify({ ...metadata, connections: Object.fromEntries(Object.entries(metadata.connections).map(([id, entry]) => [id, { version: entry.version }])) }));
	const syncMetadata = () => {
		for (const relay of relays) {
			// Test fixtures keep a non-secret connection signature only in memory.
			const old = metadata.connections[relay.id];
			if (!old || old.signature && old.signature !== connection(relay)) metadata.connections[relay.id] = { signature: connection(relay), version: crypto.randomUUID() };
			metadata.connections[relay.id].signature = connection(relay);
		}
		metadata.tests = metadata.tests.filter((test) => families.some((family) => family.routes.some((route) => route.relayId === test.relayId && route.models.some((model) => model.modelId === test.modelId))));
		for (const test of metadata.tests) test.configChanged = test.configVersion !== metadata.connections[test.relayId]?.version;
	};
	const recordTest = (ticket, relayId) => {
		syncMetadata(); const entry = metadata.connections[relayId];
		if (entry?.signature !== ticket.signature || latestTests.get(`${ticket.relay.id}\0${ticket.modelId}`) !== ticket.order || cancelledTests.has(ticket.requestId)) return;
		if (!families.some((family) => family.routes.some((route) => route.relayId === relayId && route.models.some((model) => model.modelId === ticket.modelId)))) return;
		metadata.tests = metadata.tests.filter((item) => item.relayId !== relayId || item.modelId !== ticket.modelId);
		metadata.tests.push({ relayId, modelId: ticket.modelId, configVersion: entry.version, completedAt: ticket.completedAt, ok: ticket.result.ok, latencyMs: ticket.result.latencyMs, status: ticket.result.status, errorCategory: ticket.result.ok ? null : "HTTP 请求失败", configChanged: false }); persistMetadata();
	};
	let historyTargets = [];
	const histories = new Map();
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
		{ id: "deepseek", displayName: "DeepSeek", routes: [
			route("deepseek", "r1", [
				{ modelId: "deepseek-flash", alias: "", inputCost: 1, outputCost: 4, cacheReadCost: 1, cacheWriteCost: 1, currency: "CNY", maxTokens: 4096, contextWindow: 32000 },
				{ modelId: "deepseek-chat", alias: "", inputCost: 0.3, outputCost: 1.2, cacheReadCost: 0.3, cacheWriteCost: 0.3, currency: "CNY", maxTokens: 8192, contextWindow: 128000 },
				{ modelId: "deepseek-reasoner", alias: "", inputCost: 5, outputCost: 20, cacheReadCost: 5, cacheWriteCost: 5, currency: "USD", maxTokens: 16384, contextWindow: 256000, thinkingLevels: ["minimal", "low", "medium", "high", "xhigh", "max"] },
			], { reasoning: true }),
			route("deepseek", "r2", [{ modelId: "deepseek-ai/DeepSeek-V3", alias: "", inputCost: 0.14, outputCost: 0.28, cacheReadCost: 0.14, cacheWriteCost: 0.14, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }]),
		] },
		{ id: "kimi", displayName: "Kimi", routes: [
			route("kimi", "r3", [{ modelId: "kimi-k2", alias: "", inputCost: 0.6, outputCost: 2.4, cacheReadCost: 0.6, cacheWriteCost: 0.6, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }], { reasoning: true }),
		] },
		{ id: "glm", displayName: "GLM", routes: [
			route("glm", "r2", [{ modelId: "glm-5.2", alias: "", inputCost: 1, outputCost: 4, cacheReadCost: 1, cacheWriteCost: 1, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }, { modelId: "glm-5.1", alias: "", inputCost: 0.8, outputCost: 3, cacheReadCost: 0.8, cacheWriteCost: 0.8, currency: "CNY", maxTokens: 8192, contextWindow: 128000 }]),
		] },
		{ id: "auto", displayName: "Auto", routes: [] },
	];
	if (fixture) {
		families[0].routes[1].models.push({ ...families[0].routes[0].models[1], inputCost: .14, outputCost: .28 });
		if (fixture === "archive") families[0].routes[0].models.find((model) => model.modelId === "deepseek-chat").alias = "Skiff Long Model Alias For Layout Testing";
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
	if (fixture === "settings-info") {
		relays[1].protocol = "anthropic";
		relays[1].timeoutSeconds = 123;
		relays[1].excludedModelIds = ["excluded/deepseek-flash"];
		families[0].routes[0].models = [families[0].routes[0].models[1]];
		families[0].routes[1].models = ["excluded/deepseek-flash", "first/deepseek-v4.1-flash", "second/deepseek-v4.1-flash", "manual-history"].map((modelId, index) => ({ ...families[0].routes[0].models[0], modelId, alias: index === 3 ? "历史手动模型" : "", inputCost: index, outputCost: index * 2, currency: index % 2 ? "USD" : "CNY" }));
		relays.push({ ...relays[0], id: "local", name: "本机服务", baseUrl: "http://localhost:11434/v1", apiKey: "", enabled: false });
		relays.push({ ...relays[0], id: "custom", name: "自定义端点", baseUrl: "https://unknown.example.com/v1", enabled: false });
		families[0].routes.push(route("deepseek", "custom", [{ ...families[0].routes[0].models[0], modelId: "deepseek-flash" }]));
		families[1].routes.push(route("kimi", "local", []));
		families[3].routes = [route("auto", "r2", [{ ...families[0].routes[0].models[0], modelId: "excluded/deepseek-flash" }])];
	}
	if (fixture === "picker") {
		const sample = families[0].routes[0].models[0];
		families[0].routes[0].models.push({ ...sample, modelId: "deepseek-v4-pro" });
		families[0].routes[1].models.push(...["deepseek-v4-pro", "deepseek-flash", "deepseek-flash-1017"].map((modelId) => ({ ...sample, modelId })));
		families[1].routes[0].models.push(...["kimi-k3", "kimi-k2.7-code"].map((modelId) => ({ ...sample, modelId })));
		families[2].routes[0].models.push(...["glm-5.3", "glm-5.3-flash"].map((modelId) => ({ ...sample, modelId })));
	}
	const relayOf = (relayId) => relays.find((relay) => relay.id === relayId);
	// Same ladder pi uses: a level exists only when thinkingLevelMap declares it.
	const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"];
	const thinkingMap = (levels) => Object.fromEntries(THINKING_LEVELS.map((level) => [level, levels?.includes(level) ? level : null]));
	const thinkingLevelsOf = (route, model) => route.reasoning ? ["off", ...THINKING_LEVELS.filter((level) => (model.thinkingLevels ?? route.thinkingLevels ?? THINKING_LEVELS.slice(0, 4)).includes(level))] : ["off"];
	const familyRoutes = () => families.flatMap((family) => family.routes.map((route) => ({ family, route })));
	const familyModels = () => familyRoutes().flatMap(({ family, route }) => {
		const relay = relayOf(route.relayId);
		if (!relay?.enabled || !route.enabled) return [];
		return route.models.filter((model) => !relay.excludedModelIds?.includes(model.modelId)).map((model) => ({
			provider: providerKey(family.id, relay.id), id: model.modelId, name: model.modelId,
			contextWindow: model.contextWindow, maxTokens: model.maxTokens, currency: model.currency, cost: { input: model.inputCost * (relay.priceMultiplier ?? 1), output: model.outputCost * (relay.priceMultiplier ?? 1) },
			reasoning: route.reasoning, input: (model.vision ?? route.vision) ? ["text", "image"] : ["text"],
			thinkingLevels: thinkingLevelsOf(route, model),
			thinkingLevelMap: route.reasoning ? thinkingMap(model.thinkingLevels ?? route.thinkingLevels ?? THINKING_LEVELS.slice(0, 4)) : null,
		}));
	});
	const models = familyModels();
	let autoFailover = false;
	let autoRetry = false;
	const familiesConfig = () => ({ version: 5, relays: structuredClone(relays), autoFailover, autoRetry, families: structuredClone(families) });
	const offers = () => familyRoutes().flatMap(({ family, route }, routeOrder) => {
		const relay = relayOf(route.relayId);
		if (!relay?.enabled || !route.enabled) return [];
		return route.models.filter((model) => !relay.excludedModelIds?.includes(model.modelId)).map((model) => ({ offerId: `${route.id}/${model.modelId}`, routeId: route.id, familyId: family.id, familyName: family.displayName, relayId: relay.id, relayName: relay.name, providerKey: providerKey(family.id, relay.id), modelId: model.modelId, alias: model.alias, billingAccountId: relay.billingAccountId, priceMultiplier: relay.priceMultiplier, routeOrder, streaming: route.streaming, tools: route.tools, vision: model.vision ?? route.vision, reasoning: route.reasoning, thinkingLevels: thinkingLevelsOf(route, model), inputCost: model.inputCost * (relay.priceMultiplier ?? 1), outputCost: model.outputCost * (relay.priceMultiplier ?? 1), cacheReadCost: model.cacheReadCost * (relay.priceMultiplier ?? 1), cacheWriteCost: model.cacheWriteCost * (relay.priceMultiplier ?? 1), currency: model.currency, maxTokens: model.maxTokens, contextWindow: model.contextWindow }));
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
			commands.push({ command, args: command === "discover_relay_models" ? { baseUrl: args.baseUrl } : command === "test_settings_connection" ? { ...args, relay: { ...args.relay, apiKey: "[redacted]" } } : command === "test_provider_connection" || command === "probe_relay_endpoint" ? { ...args, apiKey: "[redacted]" } : args });
			if (command === "plugin:event|listen") { const id = ++sequence; listeners.set(id, args); return id; }
			if (command === "plugin:event|unlisten") return;
			if (command === "set_history_workspace") { historyTargets = args.targets; return; }
			if (command === "read_session_history") {
				if (!historyTargets.some((item) => item.chatId === args.chatId && item.sessionFile === args.sessionFile)) throw new Error("Not indexed");
				const messages = histories.get(args.sessionFile) ?? saved[args.sessionFile];
				if (!messages || messages instanceof Error) throw new Error("Unreadable history");
				const projection = messages.filter((message) => message.role === "user" || message.role === "assistant").map((message, index) => ({ entryId: message.entryId ?? `mock:${index}`, role: message.role, timestamp: message.timestamp, text: typeof message.content === "string" ? message.content : (message.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n\n") }));
				const version = JSON.stringify(projection);
				return { version, unchanged: args.knownVersion === version, messages: args.knownVersion === version ? [] : projection };
			}
			if (command === "get_workspace_directory") return { name: "Skiff", path: "D:\\workspace\\Skiff" };
			if (command === "list_model_families") {
				if (fixture === "loading") await new Promise(() => {});
				if (fixture === "error") throw new Error("预览：模型目录暂时不可用，请重试");
				return familiesConfig();
			}
			if (command === "list_model_runtime") return offers();
			if (command === "fetch_public_catalog") return { models: fixture === "settings-info" ? [{ modelId: "deepseek-flash", name: "DeepSeek V4.1 Flash 1017", provider: "deepseek" }] : [], stale: false, fetchedAt: 0 };
			// Mock latest-model sources: official pages aligned with the families
			// fixture so the models family view can exercise offline trimming.
			if (command === "fetch_official_pages") return {
				pages: [
					{ familyId: "glm", url: "https://mock/glm", body: "<table><tr><th>模型</th><th>状态</th></tr><tr><td>GLM-5.2</td><td></td></tr></table>", fetchedAt: 0 },
					{ familyId: "deepseek", url: "https://mock/deepseek", body: "<table><tr><th>模型</th><th>deepseek-flash</th><th>deepseek-chat</th><th>deepseek-reasoner</th></tr><tr><td>BASE URL</td><td>https://api.deepseek.com</td><td></td><td></td></tr></table>", fetchedAt: 0 },
					{ familyId: "kimi", url: "https://mock/kimi", body: "const t = _jsx(T, {cols:[],rows:[[`kimi-k2`],[`kimi-k2-air`]]})", fetchedAt: 0 },
				],
				stale: false,
			};
			if (command === "list_settings_metadata") { syncMetadata(); return structuredClone({ version: 1, tests: metadata.tests, usage: metadata.usage }); }
			if (command === "preview_relay_batch" || command === "batch_relays") {
				if (!args.relayIds.length || new Set(args.relayIds).size !== args.relayIds.length || args.relayIds.some((id) => !relayOf(id))) throw new Error("所选供应商已不存在，请重新加载预览");
				const config = familiesConfig(); const token = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(config))))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
				const impact = { token, names: args.relayIds.map((id) => relayOf(id).name), routeCount: families.flatMap((f) => f.routes).filter((r) => args.relayIds.includes(r.relayId)).length };
				if (command === "preview_relay_batch") return impact;
				if (failBatch) { failBatch = false; throw new Error("模拟保存失败，整批未提交"); }
				if (token !== args.expectedToken) throw new Error("配置已变化，操作未提交，请重新确认影响预览");
				if (args.operation === "delete") { for (let i = relays.length - 1; i >= 0; i--) if (args.relayIds.includes(relays[i].id)) relays.splice(i, 1); for (const family of families) family.routes = family.routes.filter((r) => !args.relayIds.includes(r.relayId)); }
				else { for (const relay of relays) if (args.relayIds.includes(relay.id)) relay.enabled = args.operation === "enable"; }
				return familiesConfig();
			}
			if (command === "cancel_provider_test") { cancelledTests.add(args.requestId); return; }
			if (command === "test_settings_connection") {
				syncMetadata(); const ticket = { ...args, order: ++testOrder, signature: connection(args.relay) };
				latestTests.set(`${args.relay.id}\0${args.modelId}`, ticket.order);
				const result = await target.__TAURI_INTERNALS__.invoke("test_provider_connection", { ...args.relay, modelId: args.modelId, requestId: args.requestId });
				ticket.result = result; ticket.completedAt = Date.now();
				if (!cancelledTests.has(args.requestId)) { if (args.draft) tickets.set(args.requestId, ticket); else recordTest(ticket, args.relay.id); }
				return result;
			}
			if (command === "test_provider_connection") {
				const { apiKey: _key, ...request } = args;
				testRequests.push(request);
				if (deferTests) return new Promise((resolve, reject) => pendingTests.push({ requestId: args.requestId, resolve, reject }));
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
				for (const item of args.routes ?? []) {
					const family = families.find((family) => family.id === item.familyId);
					if (!family) continue;
					const existingIndex = family.routes.findIndex((route) => route.id === item.route.id && route.relayId === incoming.id);
					if (existingIndex >= 0) {
						family.routes[existingIndex] = { ...item.route, relayId: incoming.id };
						continue;
					}
					if (family.routes.some((route) => route.relayId === incoming.id)) continue;
					const models = item.route.models.filter((model) => !incoming.excludedModelIds?.includes(model.modelId));
					if (models.length) family.routes.push({ ...item.route, id: `route-${item.familyId}-${incoming.id}`, relayId: incoming.id, models });
				}
				for (const id of args.testRequestIds ?? []) { const ticket = tickets.get(id); if (ticket) { recordTest(ticket, incoming.id); tickets.delete(id); } }
				return familiesConfig();
			}
			if (command === "delete_relay") {
				const index = relays.findIndex((relay) => relay.id === args.relayId);
				if (index < 0) throw new Error("找不到要删除的中转");
				relays.splice(index, 1);
				for (const family of families) family.routes = family.routes.filter((route) => route.relayId !== args.relayId);
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
				return familiesConfig();
			}
			if (command === "delete_route") {
				const family = families.find((item) => item.id === args.familyId);
				const before = family?.routes.length ?? 0;
			if (family) family.routes = family.routes.filter((route) => route.id !== args.relayId && route.relayId !== args.relayId);
				if (!family || family.routes.length === before) throw new Error("找不到要删除的线路");
				return familiesConfig();
			}
			if (command === "reorder_routes") {
				if (failOrder) { failOrder = false; throw new Error("模拟顺序保存失败"); }
				const family = families.find((item) => item.id === args.familyId);
				if (!family || args.relayIds.length !== family.routes.length) throw new Error("排序请求与现有线路数量不一致");
				if (new Set(args.relayIds).size !== family.routes.length || args.relayIds.some((id) => !family.routes.some((r) => r.id === id))) throw new Error("路线集合已变化，请重新加载");
				family.routes = args.relayIds.map((id) => family.routes.find((route) => route.id === id));
				return familiesConfig();
			}
			if (command === "probe_relay_endpoint") {
				await new Promise((resolve) => target.setTimeout(resolve, 350));
				if (args.apiKey === "invalid" || String(args.baseUrl).includes("fail")) return { ok: false, latencyMs: 25, status: 401, error: "密钥无效" };
				if (String(args.baseUrl).includes("timeout")) return { ok: false, latencyMs: 10000, status: null, error: "连接超时" };
				if (String(args.baseUrl).includes("missing")) return { ok: false, latencyMs: 25, status: 404, error: "端点不支持模型列表接口" };
				return { ok: true, latencyMs: 132, status: 200, error: null };
			}
			if (command === "discover_relay_models") {
				await new Promise((resolve) => target.setTimeout(resolve, 350));
				if (args.apiKey === "invalid") throw new Error("密钥无效或未授权");
				if (String(args.baseUrl).includes("missing")) throw new Error("该地址不支持 /models 接口，请手动填写");
				const ids = ["deepseek-chat", "deepseek-flash", "deepseek-reasoner", "Kimi-K2", "moonshot-v1", "glm-4.6", "chatglm-6b", "glm-5.4", "glm-5.4-flash", ...Array.from({ length: 22 }, (_, i) => `a-model-${String(i).padStart(2, "0")}`)];
				return ids.map((id) => ({ id, reasoning: false, vision: false, tools: false }));
			}
			if (command === "validate_project_directory") {
				if (!/^D:\\workspace\\[\w-]+$/.test(args.path)) throw new Error("请输入存在的文件夹的绝对路径");
				return { name: args.path.split("\\").at(-1), path: args.path };
			}
			if (command === "rpc_start") {
				const file = `mock-session-${crypto.randomUUID()}.jsonl`;
				processes.set(args.options.instanceId, { file, queue: { steering: [], followUp: [] }, messages: [], model: models[0], thinkingLevel: "high", isStreaming: false });
				return;
			}
			if (command === "rpc_stop") { target.clearTimeout(processes.get(args.instanceId)?.timer); processes.delete(args.instanceId); return; }
			if (command === "get_web_search_status") return { agentDir: "D:\\mock\\pi", configured: false, extensionInstalled: false, enabled: false, validated: null };
			if (command === "validate_web_search") return { agentDir: "D:\\mock\\pi", configured: false, extensionInstalled: false, enabled: false, validated: null };
			if (command === "save_web_search_key" || command === "clear_web_search_key") return;
			if (command === "install_web_search_extension") return false;
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
				case "get_commands": respond({ commands: [{ name: "review", source: "extension", description: "检查当前项目的代码" }, { name: "plan", source: "prompt", description: "制定实现计划" }] }); break;
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
				case "get_state": respond({ model: session.model, thinkingLevel: session.thinkingLevel, sessionFile: session.file, isStreaming: session.isStreaming, isCompacting: false, steeringMode: "all", followUpMode: "one-at-a-time", pendingMessageCount: session.queue.steering.length + session.queue.followUp.length }); break;
				case "get_session_stats": {
					const latest = [...session.messages].reverse().find((message) => message.role === "assistant" && message.usage);
					const usage = latest?.usage;
					respond({ contextUsage: { tokens: usage ? usage.input + usage.cacheRead + usage.cacheWrite + usage.output : null, contextWindow: session.model.contextWindow ?? 128000, percent: usage ? (usage.input + usage.cacheRead + usage.cacheWrite + usage.output) / (session.model.contextWindow ?? 128000) * 100 : null } });
					break;
				}
				case "get_available_thinking_levels": respond({ levels: session.model.thinkingLevels ?? (session.model.reasoning ? ["off", "minimal", "low", "medium", "high"] : ["off"]) }); break;
				// Like pi, an unsupported level is clamped rather than rejected.
				case "set_thinking_level": { const levels = session.model.thinkingLevels ?? (session.model.reasoning ? ["off", "minimal", "low", "medium", "high"] : ["off"]); session.thinkingLevel = levels.includes(request.level) ? request.level : levels.filter((level) => level !== "off").at(-1) ?? "off"; respond({}); break; }
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
				case "extension_ui_response": break;
				case "clear_queue": { const removed = session.queue; session.queue = { steering: [], followUp: [] }; emit(args.instanceId, { type: "queue_update", ...session.queue }); respond(removed); break; }
				case "steer":
				case "follow_up": {
					if (String(request.message).startsWith("/review")) { respond("Extension command cannot be queued", false); break; }
					session.queue[request.type === "steer" ? "steering" : "followUp"].push(request.message);
					emit(args.instanceId, { type: "queue_update", ...session.queue }); respond({ disposition: "queued" }); break;
				}
				case "prompt": {
					if (String(request.message).startsWith("/review")) { emit(args.instanceId, { type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message: "Review handled" }); respond({ disposition: "handled" }); break; }
					const user = { role: "user", content: request.images?.length ? [...(request.message ? [{ type: "text", text: request.message }] : []), ...request.images] : request.message };
					session.messages.push(user);
					saved[session.file] = session.messages;
					persist();
					if (String(request.message ?? "").includes("触发失败") || String(request.message ?? "").includes("触发跨账户")) {
						session.isStreaming = false;
						emit(args.instanceId, { type: "agent_start" });
						emit(args.instanceId, { type: "error", errorMessage: String(request.message).includes("触发跨账户") ? "503 Service Unavailable：提供商暂时不可用" : "401 Unauthorized：提供商拒绝了这次请求" });
						emit(args.instanceId, { type: "agent_end" }); emit(args.instanceId, { type: "agent_settled" });
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
						const assistant = { role: "assistant", timestamp: Date.now(), provider: session.model.provider, model: session.model.id, content: [{ type: "text", text }], usage: { input: 77984, cacheRead: 715968, cacheWrite: 0, output: 12249, reasoning: 8035, totalTokens: 806201 } };
						const offer = offers().find((offer) => offer.providerKey === assistant.provider && offer.modelId === assistant.model);
						if (offer) { metadata.usage = metadata.usage.filter((item) => item.routeId !== offer.routeId); metadata.usage.push({ relayId: offer.relayId, routeId: offer.routeId, usedAt: Date.now() }); persistMetadata(); for (const listener of listeners.values()) if (listener.event === "settings-metadata-changed") callbacks.get(listener.handler)?.({ payload: null }); }
						emit(args.instanceId, { type: "message_end", message: assistant });
						session.messages.push(assistant);
						persist();
						session.isStreaming = false;
						emit(args.instanceId, { type: "agent_end" }); emit(args.instanceId, { type: "agent_settled" });
					};
					session.timer = target.setTimeout(stream, 100);
					break;
				}
				case "abort": target.clearTimeout(session.timer); session.isStreaming = false; emit(args.instanceId, { type: "agent_end" }); emit(args.instanceId, { type: "agent_settled" }); respond({}); break;
				default: respond("Unsupported command", false);
			}
		},
	};
	return { relays, families, metadata, failNextOrder: () => { failOrder = true; }, failNextBatch: () => { failBatch = true; }, histories, saved, commands, processes, listeners, callbacks, emit, testRequests, pendingTests, deferTests: (value) => { deferTests = value; }, failNextSend: () => { failSend = true; } };
}
