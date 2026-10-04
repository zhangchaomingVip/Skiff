// Loaded explicitly by Skiff. Runtime configuration and decrypted keys are
// inherited from the native parent process; this module never writes secrets.
import { createAssistantMessageEventStream, streamSimpleOpenAICompletions } from "@mariozechner/pi-ai";

/** Present a non-streaming completion to pi's normal streaming parser. */
export async function adaptResponse(response) {
	if (!response.ok) return response;
	const completion = await response.json();
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

export default function modelFamilies(pi) {
	const routes = JSON.parse(process.env.SKIFF_FAMILY_RUNTIME ?? "[]");
	const lookup = new Map(routes.map((route) => [route.providerKey, route]));
	const streamSimple = (model, context, options = {}) => {
		const route = lookup.get(model.provider);
		if (!route) throw new Error("找不到该提供商的请求配置");
		const timeout = AbortSignal.timeout(route.timeoutSeconds * 1000);
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
		const doFetch = options.fetch ?? globalThis.fetch;
		const upstream = streamSimpleOpenAICompletions({ ...model, api: "openai-completions" }, context, {
			...options, maxTokens: options.maxTokens ?? model.maxTokens, signal, timeoutMs: route.timeoutSeconds * 1000,
			apiKey: process.env[route.keyEnv],
			onPayload: async (payload, current) => {
				payload = await options.onPayload?.(payload, current) ?? payload;
				if (!route.tools) { delete payload.tools; delete payload.tool_choice; delete payload.parallel_tool_calls; }
				return payload;
			},
			fetch: async (input, init) => {
				// Keep the SDK in stream parsing mode, but send a normal JSON
				// request upstream for channels with streaming disabled.
				if (!route.streaming && typeof init?.body === "string") {
					const payload = JSON.parse(init.body);
					payload.stream = false; delete payload.stream_options;
					init = { ...init, body: JSON.stringify(payload) };
				}
				const response = await doFetch(input, init);
				return route.streaming ? response : adaptResponse(response);
			},
		});
		const stream = createAssistantMessageEventStream();
		(async () => {
			for await (const event of upstream) {
				if (event.type === "error") {
					const key = process.env[route.keyEnv];
					if (key && event.error.errorMessage) event.error.errorMessage = event.error.errorMessage.replaceAll(key, "[密钥已隐藏]");
					if (timeout.aborted && !options.signal?.aborted) {
						event.error.stopReason = "error";
						event.error.errorMessage = `提供商请求超时（${route.timeoutSeconds} 秒）`;
						event.reason = "error";
					}
				}
				stream.push(event);
			}
			stream.end();
		})();
		return stream;
	};
	for (const route of routes) {
		pi.registerProvider(route.providerKey, {
			baseUrl: route.baseUrl, api: "skiff-openai-completions", apiKey: `$${route.keyEnv}`,
			models: route.models.map((model) => ({ ...model, api: "skiff-openai-completions" })), streamSimple,
		});
	}
}
