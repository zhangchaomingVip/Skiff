// Loaded explicitly by Skiff. Runtime configuration and decrypted keys are
// inherited from the native parent process; this module never writes secrets.
import { readFileSync } from "node:fs";
import {
	anthropicMessagesApi, createAssistantMessageEventStream,
	googleGenerativeAIApi, googleVertexApi, openAICompletionsApi, openAIResponsesApi,
} from "@mariozechner/pi-ai";
import { trimPayload } from "./payload-budget.js";

/** Present a non-streaming completion to pi's normal streaming parser. */
export async function adaptResponse(response, api = "openai-completions") {
	if (!response.ok) return response;
	const completion = await response.json();
	const events = [];
	if (api === "openai-responses") {
		events.push({ type: "response.created", response: completion });
		for (const [index, item] of (completion.output ?? []).entries()) events.push({ type: "response.output_item.done", output_index: index, item });
		events.push({ type: `response.${completion.status ?? "completed"}`, response: completion });
	} else if (api === "anthropic-messages") {
		events.push({ type: "message_start", message: { ...completion, content: [] } });
		for (const [index, block] of (completion.content ?? []).entries()) {
			const tool = block.type === "tool_use";
			events.push({ type: "content_block_start", index, content_block: tool ? { ...block, input: {} } : block });
			if (tool) events.push({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) } });
			events.push({ type: "content_block_stop", index });
		}
		events.push({ type: "message_delta", delta: { stop_reason: completion.stop_reason, stop_sequence: completion.stop_sequence }, usage: completion.usage });
		events.push({ type: "message_stop" });
	} else if (api === "google-generative-ai" || api === "google-vertex") {
		events.push(completion);
	}
	if (events.length) return new Response(events.map((event) => `${event.type ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200, headers: { "content-type": "text/event-stream" },
	});
	const choices = (completion.choices ?? []).map((choice) => ({
		index: choice.index ?? 0,
		delta: {
			...choice.message,
			...(choice.message?.tool_calls ? { tool_calls: choice.message.tool_calls.map((call, index) => ({ ...call, index })) } : {}),
		},
		finish_reason: choice.finish_reason,
	}));
	const chunk = { ...completion, object: "chat.completion.chunk", choices };
	return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
		status: 200, headers: { "content-type": "text/event-stream" },
	});
}

/** Each relay protocol is served by pi's matching adapter. */
const ADAPTERS = {
	"openai-completions": () => openAICompletionsApi(),
	"openai-responses": () => openAIResponsesApi(),
	"anthropic-messages": () => anthropicMessagesApi(),
	"google-generative-ai": () => googleGenerativeAIApi(),
	"google-vertex": () => googleVertexApi(),
};

const GOOGLE_APIS = new Set(["google-generative-ai", "google-vertex"]);

/** Google's SDK does not accept a custom fetch option. A private header scopes
 * this bridge to its non-streaming requests; it is removed before transmission.
 * All unrelated requests keep their original fetch behavior. */
function googleNonStreamingBridge() {
	const marker = crypto.randomUUID();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
		if (headers.get("x-skiff-response-mode") !== marker) return originalFetch(input, init);
		headers.delete("x-skiff-response-mode");
		const request = new Request(input, { ...init, headers });
		const url = new URL(request.url);
		if (!url.pathname.endsWith(":streamGenerateContent")) throw new Error("Google 非流式请求端点无效");
		url.pathname = url.pathname.replace(/:streamGenerateContent$/, ":generateContent");
		url.searchParams.delete("alt");
		return adaptResponse(await originalFetch(new Request(url, request)), "google-generative-ai");
	};
	return marker;
}

/** Bound silence, not the lifetime of a healthy streaming response. */
function idleTimeout(timeoutMs, parentSignal) {
	const controller = new AbortController();
	let timer;
	const clear = () => clearTimeout(timer);
	const reset = () => {
		clear();
		if (!controller.signal.aborted && !parentSignal?.aborted) {
			timer = setTimeout(() => controller.abort(), timeoutMs);
			timer.unref?.();
		}
	};
	parentSignal?.addEventListener("abort", clear, { once: true });
	reset();
	return {
		signal: controller.signal,
		reset,
		dispose() { clear(); parentSignal?.removeEventListener("abort", clear); },
	};
}

export default function modelFamilies(pi) {
	const runtimeFile = process.env.SKIFF_FAMILY_RUNTIME_FILE;
	let runtime = process.env.SKIFF_FAMILY_RUNTIME ?? "[]";
	if (runtimeFile) {
		try { runtime = readFileSync(runtimeFile, "utf8"); } catch { /* fall back to the small environment form */ }
	}
	const routes = JSON.parse(runtime);
	const googleMarker = routes.some((route) => GOOGLE_APIS.has(route.api) && route.models.some((model) => model.streaming === false)) ? googleNonStreamingBridge() : undefined;
	const lookup = new Map(routes.map((route) => [route.providerKey, route]));
	const streamSimple = (model, context, options = {}) => {
		const route = lookup.get(model.provider);
		if (!route) throw new Error("找不到该提供商的请求配置");
		const settings = route.models.find((entry) => entry.id === model.id);
		if (!settings) throw new Error("模型配置不存在");
		const api = route.api ?? "openai-completions";
		// Family routes serve arbitrary relays: pi cannot infer their protocol,
		// tool support or capability profile from our provider key or URL.
		const base = { ...model, api, compat: api === "openai-completions" ? { ...model.compat, supportsDeveloperRole: false } : model.compat };
		const timeout = idleTimeout(route.timeoutSeconds * 1000, options.signal);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
		const optionsForUpstream = {
			...options, maxTokens: options.maxTokens ?? model.maxTokens, signal,
			timeoutMs: route.timeoutSeconds * 1000, apiKey: process.env[route.keyEnv],
			onPayload: async (payload, current) => {
				payload = await options.onPayload?.(payload, current) ?? payload;
				if (settings.tools === false) {
					delete payload.tools; delete payload.tool_choice; delete payload.parallel_tool_calls;
					if (payload.config) { delete payload.config.tools; delete payload.config.toolConfig; }
				}
				if (GOOGLE_APIS.has(api) && settings.streaming === false) {
					payload.config ??= {};
					const http = payload.config.httpOptions ?? {};
					payload.config.httpOptions = { ...http, headers: { ...http.headers, "x-skiff-response-mode": googleMarker } };
				}
				return trimPayload(payload, api);
			},
		};
		if (!GOOGLE_APIS.has(api) && settings.streaming === false) {
			// Keep the SDK in stream parsing mode, but send a normal JSON request
			// upstream for channels with streaming disabled.
			const doFetch = options.fetch ?? globalThis.fetch;
			optionsForUpstream.fetch = async (input, init) => {
				if (typeof init?.body === "string") {
					const payload = JSON.parse(init.body);
					payload.stream = false; delete payload.stream_options;
					init = { ...init, body: JSON.stringify(payload) };
				}
				return adaptResponse(await doFetch(input, init), api);
			};
		}
		let upstream;
		try { upstream = ADAPTERS[api]().streamSimple(base, context, optionsForUpstream); }
		catch (error) { timeout.dispose(); throw error; }
		const stream = createAssistantMessageEventStream();
		(async () => {
			try {
				for await (const event of upstream) {
					// Text, thinking and tool arguments all count as model progress.
					// Local start/end events must not extend the response deadline.
					if (event.type.endsWith("_delta") && event.delta?.length) timeout.reset();
					if (event.type === "error") {
						const key = process.env[route.keyEnv];
						if (key && event.error.errorMessage) event.error.errorMessage = event.error.errorMessage.replaceAll(key, "[密钥已隐藏]");
						if (timeout.signal.aborted && !options.signal?.aborted) {
							event.error.stopReason = "error";
							// Keep the transport marker so pi recognises this translated error as retryable.
							event.error.errorMessage = `提供商请求超时（连续 ${route.timeoutSeconds} 秒无输出） · request timeout`;
							event.reason = "error";
						}
					}
					stream.push(event);
				}
			} finally {
				timeout.dispose();
				stream.end();
			}
		})();
		return stream;
	};
	for (const route of routes) {
		const api = route.api ?? "openai-completions";
		// `api` here names Skiff's dispatch, not a pi built-in, so its own
		// adapters are never consulted for these routes.
		const providerApi = `skiff-${api}`;
		pi.registerProvider(route.providerKey, {
			baseUrl: route.baseUrl, api: providerApi, apiKey: `$${route.keyEnv}`,
			models: route.models.map((model) => ({ ...model, api: providerApi })), streamSimple,
		});
	}
}
