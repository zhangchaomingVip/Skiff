import test from "node:test";
import assert from "node:assert/strict";
import { candidateApiUrls, importPricedModels, parseHtmlTables, parseJsonModels, type FetchedPage } from "../src/chat/pricingPage.ts";

const tokenrhythmEntry = (overrides: Record<string, unknown>) => ({
	id: "glm-5.1",
	name: "GLM-5.1",
	type: "chat",
	status: "online",
	contextWindow: 200000,
	maxOutputTokens: 128000,
	capabilities: { stream: true, tools: true, vision: false, reasoning: true },
	modalities: ["text"],
	inputPrice: "8.00000000",
	outputPrice: "28.00000000",
	billingMode: "per_1m_tokens",
	billingUnit: 1000000,
	currency: "CNY",
	...overrides,
});

const htmlPage = (url: string, body: string): FetchedPage => ({ url, contentType: "text/html", body });
const jsonPage = (url: string, value: unknown): FetchedPage => ({ url, contentType: "application/json", body: JSON.stringify(value) });

test("tokenrhythm-shaped JSON parses into priced models", () => {
	const payload = {
		code: 0, message: "ok",
		data: [
			tokenrhythmEntry({}),
			tokenrhythmEntry({ id: "kimi-k3", inputPrice: "3.50000000", outputPrice: "12.00000000", status: "testing", contextWindow: 256000, maxOutputTokens: 96000 }),
			tokenrhythmEntry({ id: "text-embedding-3", type: "embedding", modalities: ["text"] }),
			tokenrhythmEntry({ id: "video-gen-1", type: "video", modalities: ["video"] }),
		],
	};
	const models = parseJsonModels(JSON.stringify(payload));
	assert.equal(models.length, 2);
	const glm = models[0];
	assert.equal(glm.modelId, "glm-5.1");
	assert.equal(glm.inputCost, 8);
	assert.equal(glm.outputCost, 28);
	assert.equal(glm.currency, "CNY");
	assert.equal(glm.contextWindow, 200000);
	assert.equal(glm.maxTokens, 128000);
	assert.equal(glm.streaming, true);
	assert.equal(glm.tools, true);
	assert.equal(glm.vision, false);
	assert.equal(glm.reasoning, true);
	assert.equal(glm.note, null);
	assert.equal(models[1].note, "测试中");
});

test("per-token pricing (OpenRouter style) scales to per-1M costs", () => {
	const payload = {
		data: [
			{ id: "vendor/deepseek-chat", pricing: { prompt: "0.0000021", completion: "0.0000084" }, currency: "USD", context_length: 64000, max_tokens: 8000 },
		],
	};
	const models = parseJsonModels(JSON.stringify(payload));
	assert.equal(models.length, 1);
	assert.equal(models[0].inputCost, 2.1);
	assert.equal(models[0].outputCost, 8.4);
	assert.equal(models[0].currency, "USD");
	assert.equal(models[0].contextWindow, 64000);
	assert.equal(models[0].maxTokens, 8000);
});

test("K/M suffixed context strings expand to token counts", () => {
	const payload = { data: [{ id: "mimo-v2.6-flash", inputPrice: 1, outputPrice: 2, currency: "CNY", context: "1049K" }] };
	const models = parseJsonModels(JSON.stringify(payload));
	assert.equal(models[0].contextWindow, 1049000);
});

test("static HTML pricing tables parse id and price columns", () => {
	const html = `<html><body><table>
		<tr><th>模型 ID</th><th>输入价格（¥/百万token）</th><th>输出价格（¥/百万token）</th></tr>
		<tr><td>deepseek-chat</td><td>¥2.00</td><td>¥8.00</td></tr>
		<tr><td>glm-4.6</td><td>￥4.00</td><td>￥12.00</td></tr>
		<tr><td>not a model</td><td>1</td><td>2</td></tr>
	</table></body></html>`;
	const models = parseHtmlTables(html);
	assert.deepEqual(models.map((model) => model.modelId), ["deepseek-chat", "glm-4.6"]);
	assert.equal(models[0].inputCost, 2);
	assert.equal(models[0].outputCost, 8);
	assert.equal(models[0].currency, "CNY");
});

test("SPA pages fall back to derived JSON endpoints", async () => {
	const calls: string[] = [];
	const fetchPage = async (url: string): Promise<FetchedPage> => {
		calls.push(url);
		if (url === "https://tokenrhythm.studio/models") {
			return htmlPage(url, `<html><body><div id="root">加载中...</div><script src="/assets/index.js"></script></body></html>`);
		}
		if (url === "https://tokenrhythm.studio/api/models") {
			return jsonPage(url, { code: 0, data: [tokenrhythmEntry({})] });
		}
		throw new Error(`unexpected ${url}`);
	};
	const models = await importPricedModels("https://tokenrhythm.studio/models", fetchPage);
	assert.equal(models.length, 1);
	assert.equal(models[0].modelId, "glm-5.1");
	assert.deepEqual(calls, ["https://tokenrhythm.studio/models", "https://tokenrhythm.studio/models.json", "https://tokenrhythm.studio/api/models"]);
});

test("candidate API urls stay sane", () => {
	assert.deepEqual(candidateApiUrls("https://x.com/models"), ["https://x.com/models.json", "https://x.com/api/models", "https://x.com/api/v1/models"]);
	assert.deepEqual(candidateApiUrls("https://x.com/api/models"), ["https://x.com/api/models.json"]);
	assert.deepEqual(candidateApiUrls("https://x.com/"), []);
	assert.deepEqual(candidateApiUrls("https://x.com/a b"), []);
});

test("unparseable pages throw a friendly error", async () => {
	const fetchPage = async (url: string): Promise<FetchedPage> => htmlPage(url, "<html><body>hello</body></html>");
	await assert.rejects(() => importPricedModels("https://example.com/models", fetchPage), /未能从该页面识别/);
});
